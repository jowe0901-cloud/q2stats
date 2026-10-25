import {ensureSchemaWithClient} from "./rating-schema.mjs";
import {calculateMatchElo,newRating} from './elo-engine.mjs';
import {calculateMatchElo as legacyCalculate} from './elo-legacy-engine.mjs';
import {versionsFor} from './rating-model.mjs';
const MATCH_SQL=`SELECT id,match_id,game_type,home_score,away_score,winner,saved_at,created_at FROM matches`;
const PLAYER_SQL=`SELECT mp.match_id,mp.name AS historical_name,COALESCE(pp.primary_name,mp.name) AS name,
 mp.team,mp.frags,mp.deaths,mp.damage,mp.suicides,mp.teamkills,mp.damage_received,mp.team_damage
 FROM match_players mp LEFT JOIN player_profiles pp ON pp.id=mp.profile_id`;
const KEY=62107;
function cache(){const maps={team:new Map(),'1v1':new Map()};return {maps,get(type,name){if(!maps[type].has(name))maps[type].set(name,newRating());return maps[type].get(name)}};}
function calc(model,m,rows,c){const r=(model==='glicko'?calculateMatchElo:legacyCalculate)(m,rows,c.get);return !r||r.skipped?{skipped:r?.skipped||'invalid_teams_or_winner'}:r;}
async function writeRows(client,table,rows,columns,types,conflict=''){
 for(let i=0;i<rows.length;i+=500){const batch=rows.slice(i,i+500);await client.query(`INSERT INTO ${table} (${columns.join(',')}) SELECT ${columns.join(',')} FROM jsonb_to_recordset($1::jsonb) AS x(${columns.map((k,j)=>k+' '+types[j]).join(',')}) ${conflict}`,[JSON.stringify(batch)]);}
}
async function persist(client,model,c,history){
 const versions=versionsFor(model),ratingRows=[];
 for(const [type,map] of Object.entries(c.maps))for(const [name,r] of map){if(!history.some(h=>h[1]===name&&h[2]===type))continue;ratingRows.push({player_name:name,elo_type:type,rating:r.rating,matches:r.matches,wins:r.wins,losses:r.losses,rd:model==='glicko'?r.rd:null,rating_period:model==='glicko'?r.period:null,algorithm_version:versions[type]});}
 await writeRows(client,'elo_ratings',ratingRows,['player_name','elo_type','rating','matches','wins','losses','rd','rating_period','algorithm_version'],['text','text','float8','int','int','int','float8','int','text'],`ON CONFLICT(player_name,elo_type,algorithm_version) DO UPDATE SET rating=EXCLUDED.rating,matches=EXCLUDED.matches,wins=EXCLUDED.wins,losses=EXCLUDED.losses,rd=EXCLUDED.rd,rating_period=EXCLUDED.rating_period,updated_at=NOW()`);
 const hs=history.map(h=>({match_id:h[0],player_name:h[1],elo_type:h[2],team:h[3],old_elo:h[4],elo_change:h[5],new_elo:h[6],algorithm_version:versions[h[2]],...h[7]}));
 await writeRows(client,'elo_history',hs,['match_id','player_name','elo_type','team','old_elo','elo_change','new_elo','algorithm_version','rd_before','rd_after','performance','contribution_bonus','raw_delta','win_floor_adjustment'],['text','text','text','text','float8','float8','float8','text','float8','float8','float8','float8','float8','float8']);
 return ratingRows.length;
}
export async function rebuildWithClient(client,model){
 const matches=(await client.query(MATCH_SQL+' ORDER BY COALESCE(saved_at,created_at) ASC,id ASC')).rows;
 const players=(await client.query(PLAYER_SQL+' ORDER BY mp.id ASC')).rows;
 const by=new Map();for(const p of players){if(!by.has(p.match_id))by.set(p.match_id,[]);by.get(p.match_id).push(p)}
 const c=cache(),history=[],processed=[],skips=[],counts={team:0,'1v1':0};
 for(const m of matches){const r=calc(model,m,by.get(m.match_id)||[],c);processed.push({model,match_id:m.match_id,skipped_reason:r.skipped||null});if(r.skipped){skips.push({match_id:m.match_id,reason:r.skipped});continue;}counts[r.type]++;history.push(...r.changes);}
 const v=versionsFor(model);
 await client.query('DELETE FROM elo_history WHERE (elo_type=$1 AND algorithm_version=$2) OR (elo_type=$3 AND algorithm_version=$4)',['team',v.team,'1v1',v['1v1']]);
 await client.query('DELETE FROM elo_ratings WHERE (elo_type=$1 AND algorithm_version=$2) OR (elo_type=$3 AND algorithm_version=$4)',['team',v.team,'1v1',v['1v1']]);
 await client.query('DELETE FROM q2stats_rating_processed WHERE model=$1',[model]);
 const written=await persist(client,model,c,history);
 await writeRows(client,'q2stats_rating_processed',processed,['model','match_id','skipped_reason'],['text','text','text']);
 await client.query('UPDATE q2stats_rating_state SET active_model=$1,updated_at=NOW() WHERE id=1',[model]);
 return {status:'ok',model,team_algorithm_version:v.team,one_v_one_algorithm_version:v['1v1'],matches_read:matches.length,matches_used:counts.team+counts['1v1'],team_matches_used:counts.team,one_v_one_matches_used:counts['1v1'],skipped:skips.length,skip_examples:skips.slice(0,30),ratings_written:written,history_written:history.length};
}
export async function rebuildRatings(db,model){const client=await db.pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock($1,2)',[KEY]);await ensureSchemaWithClient(client);const out=await rebuildWithClient(client,model);await client.query('COMMIT');return out;}catch(e){try{await client.query('ROLLBACK')}catch{}throw e;}finally{client.release()}}
export async function updateEloForMatch(db,matchId){
 const client=await db.pool.connect();try{
 await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock($1,2)',[KEY]);await ensureSchemaWithClient(client);
 const state=(await client.query('SELECT active_model FROM q2stats_rating_state WHERE id=1')).rows[0];if(!state)throw Error('Automatic rating setup did not create its state row');
 const model=state.active_model,v=versionsFor(model);
 const m=(await client.query(MATCH_SQL+' WHERE match_id=$1',[matchId])).rows[0];if(!m){await client.query('COMMIT');return {status:'skipped',reason:'match_not_found'}}
 const processed=(await client.query('SELECT skipped_reason FROM q2stats_rating_processed WHERE model=$1 AND match_id=$2',[model,matchId])).rows;
 const existing=(await client.query('SELECT 1 FROM elo_history WHERE match_id=$1 AND algorithm_version=ANY($2::text[]) LIMIT 1',[matchId,[v.team,v['1v1']]])).rows;
 if(processed.length&&processed[0].skipped_reason){const out=await rebuildWithClient(client,model);await client.query('COMMIT');return {...out,status:'rebuilt_for_repaired_match',match_id:matchId};}
 if(processed.length||existing.length){await client.query('COMMIT');return {status:'already_calculated',match_id:matchId};}
 // Replay if imported out of chronological order. A full replay also refreshes all affected opponents.
 const later=(await client.query(`SELECT 1 FROM elo_history h JOIN matches x ON x.match_id=h.match_id WHERE h.algorithm_version=ANY($1::text[]) AND (COALESCE(x.saved_at,x.created_at)>$2::timestamptz OR (COALESCE(x.saved_at,x.created_at)=$2::timestamptz AND x.id>$3)) LIMIT 1`,[[v.team,v['1v1']],m.saved_at||m.created_at,m.id])).rows;
 if(later.length){const out=await rebuildWithClient(client,model);await client.query('COMMIT');return {...out,status:'rebuilt_for_late_match',match_id:matchId};}
 const players=(await client.query(PLAYER_SQL+' WHERE mp.match_id=$1 ORDER BY mp.id ASC',[matchId])).rows;
 const c=cache(),names=[...new Set(players.map(p=>p.name))];
 const saved=(await client.query('SELECT * FROM elo_ratings WHERE player_name=ANY($1::text[]) AND algorithm_version=ANY($2::text[])',[names,[v.team,v['1v1']]])).rows;
 for(const r of saved)c.maps[r.elo_type].set(r.player_name,{rating:Number(r.rating),rd:r.rd==null?100:Number(r.rd),period:r.rating_period==null?null:Number(r.rating_period),matches:Number(r.matches),wins:Number(r.wins),losses:Number(r.losses)});
 const result=calc(model,m,players,c);
 if(!result.skipped)await persist(client,model,c,result.changes);
 await client.query('INSERT INTO q2stats_rating_processed(model,match_id,skipped_reason) VALUES($1,$2,$3)',[model,matchId,result.skipped||null]);
 await client.query('COMMIT');return {status:result.skipped?'skipped':'updated',reason:result.skipped,match_id:matchId,model,players:result.changes?.length||0};
 }catch(e){try{await client.query('ROLLBACK')}catch{}throw e;}finally{client.release()}
}

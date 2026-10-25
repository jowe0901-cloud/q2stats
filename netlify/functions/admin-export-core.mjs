import { gzipSync } from 'node:zlib';
const TABLES=['matches','match_players','match_player_weapons','player_profiles','player_aliases','player_identities','player_setups','elo_ratings','elo_history','opentdm_identity_observations','player_profile_views','player_nickname_views'];
const REQUIRED=['matches','match_players','player_profiles','player_aliases'];
const json=(status,body)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export function createExportHandler(getDatabase,getKey=()=>process.env.Q2STATS_ADMIN_KEY){return async req=>{
 const key=getKey();if(!key||req.headers.get('x-q2stats-admin-key')!==key)return json(401,{error:'Unauthorized'});
 if(req.method!=='GET')return json(405,{error:'Method not allowed'});
 let client;
 try{
 client=await getDatabase().pool.connect();
 await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query("SET LOCAL statement_timeout = '45000'");
 const available=await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
 const present=new Set(available.rows.map(r=>r.table_name));
 for(const t of REQUIRED)if(!present.has(t))throw Error('Required export table missing: '+t);
 const tables={},counts={},missing=[];
 for(const t of TABLES){if(!present.has(t)){missing.push(t);continue;}
 // Names come exclusively from the fixed allowlist, never from request data.
 const r=await client.query(`SELECT * FROM public."${t}"`);tables[t]=r.rows;counts[t]=r.rows.length;}
 const players=new Map();for(const p of tables.match_players)(players.get(p.match_id)||players.set(p.match_id,[]).get(p.match_id)).push({...p});
 const weapons=new Map();for(const w of tables.match_player_weapons||[]){const k=JSON.stringify([w.match_id,w.player_name]);if(!weapons.has(k))weapons.set(k,{});weapons.get(k)[w.weapon]={...w};}
 const matches=[...tables.matches].sort((a,b)=>{const ta=Date.parse(a.saved_at||a.created_at),tb=Date.parse(b.saved_at||b.created_at);return (Number.isFinite(ta)&&Number.isFinite(tb)?ta-tb:0)||Number(a.id)-Number(b.id)}).map(m=>({...m,hostname:m.server,mapname:m.map,players:(players.get(m.match_id)||[]).sort((a,b)=>Number(a.id)-Number(b.id)).map(p=>({...p,kills:p.frags,weapons:weapons.get(JSON.stringify([m.match_id,p.name]))||{}}))}));
 const data={format:'q2stats-db-export',schema_version:1,exported_at:new Date().toISOString(),snapshot:'PostgreSQL REPEATABLE READ READ ONLY',counts,missing_optional_tables:missing,private_admin_data:true,matches,profiles:tables.player_profiles,aliases:tables.player_aliases,tables};
 const body=gzipSync(Buffer.from(JSON.stringify(data)),{level:6});
 // Netlify buffered responses have a payload limit; fail explicitly rather than return a truncated archive.
 if(body.length>4_300_000)throw Error('Export exceeds the safe response size. No partial file was created. Use a direct database export for this data volume.');
 await client.query('COMMIT');
 return new Response(body,{headers:{'content-type':'application/gzip','content-disposition':'attachment; filename="q2stats-db-export.json.gz"','cache-control':'no-store','x-content-type-options':'nosniff','x-q2stats-match-count':String(matches.length)}});
 }catch(e){if(client)try{await client.query('ROLLBACK')}catch{}console.error('Admin export failed',e);return json(500,{error:String(e?.message||e)});}finally{client?.release();}
};}

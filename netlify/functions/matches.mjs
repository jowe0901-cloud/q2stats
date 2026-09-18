import { getDatabase } from "@netlify/database";
import crypto from "node:crypto";

const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8"}});

function getMatchId(request){
 const url=new URL(request.url),prefix="/api/v1/matches/";
 if(!url.pathname.startsWith(prefix))return null;
 const value=url.pathname.slice(prefix.length).split("/")[0];
 return value?decodeURIComponent(value):null;
}

function nullableNumber(value){
 if(value===null||value===undefined||value==="")return null;
 const n=Number(value);
 return Number.isFinite(n)?n:null;
}

async function saveWeapons(db,matchId,players){
 let saved=0;
 for(const p of players||[]){
  if(!p||!p.name||!p.weapons||typeof p.weapons!=="object")continue;
  for(const [weapon,s] of Object.entries(p.weapons)){
   if(!weapon||!s||typeof s!=="object")continue;
   await db.sql`
    INSERT INTO match_player_weapons(
      match_id,player_name,weapon,accuracy,kills,deaths,dealt,received,pick,miss
    )
    VALUES(
      ${matchId},${p.name},${weapon},
      ${nullableNumber(s.accuracy??s.acc)},
      ${nullableNumber(s.kills)},
      ${nullableNumber(s.deaths)},
      ${nullableNumber(s.dealt)},
      ${nullableNumber(s.received)},
      ${nullableNumber(s.pick)},
      ${nullableNumber(s.miss)}
    )
    ON CONFLICT (match_id,player_name,weapon)
    DO UPDATE SET
      accuracy=EXCLUDED.accuracy,
      kills=EXCLUDED.kills,
      deaths=EXCLUDED.deaths,
      dealt=EXCLUDED.dealt,
      received=EXCLUDED.received,
      pick=EXCLUDED.pick,
      miss=EXCLUDED.miss
   `;
   saved++;
  }
 }
 return saved;
}

async function playersForMatch(db,matchId){
 return await db.sql`
  SELECT name, team, frags, deaths, damage, ping, suicides, teamkills,
         teleports, damage_received, team_damage, team_damage_received
  FROM match_players WHERE match_id=${matchId}
  ORDER BY frags DESC, name ASC
 `;
}

async function getOneMatch(db,matchId){
 const rows=await db.sql`
  SELECT id, match_id, server, map, game_type, home_score, away_score,
         winner, match_type, port, saved_at, created_at
  FROM matches WHERE match_id=${matchId} LIMIT 1
 `;
 if(!rows.length)return null;
 return {...rows[0],players:await playersForMatch(db,rows[0].match_id)};
}

async function listMatches(db,request){
 const url=new URL(request.url),rl=Number(url.searchParams.get("limit")||20),ro=Number(url.searchParams.get("offset")||0);
 const player=(url.searchParams.get("player")||"").trim();
 const limit=Math.max(1,Math.min(Number.isFinite(rl)?Math.trunc(rl):20,100));
 const offset=Math.max(0,Number.isFinite(ro)?Math.trunc(ro):0);

 let countRows,rows;

 if(player){
  countRows=await db.sql`
   SELECT COUNT(*)::int AS count
   FROM matches m
   WHERE EXISTS (
    SELECT 1 FROM match_players mp
    WHERE mp.match_id=m.match_id AND mp.name=${player}
   )
  `;
  rows=await db.sql`
   SELECT m.id, m.match_id, m.server, m.map, m.game_type, m.home_score, m.away_score,
          m.winner, m.match_type, m.port, m.saved_at, m.created_at
   FROM matches m
   WHERE EXISTS (
    SELECT 1 FROM match_players mp
    WHERE mp.match_id=m.match_id AND mp.name=${player}
   )
   ORDER BY COALESCE(m.saved_at,m.created_at) DESC,m.id DESC
   LIMIT ${limit} OFFSET ${offset}
  `;
 }else{
  countRows=await db.sql`SELECT COUNT(*)::int AS count FROM matches`;
  rows=await db.sql`
   SELECT id, match_id, server, map, game_type, home_score, away_score,
          winner, match_type, port, saved_at, created_at
   FROM matches
   ORDER BY COALESCE(saved_at,created_at) DESC,id DESC
   LIMIT ${limit} OFFSET ${offset}
  `;
 }

 const total=countRows[0]?.count||0;
 const matches=[];
 for(const match of rows)matches.push({...match,players:await playersForMatch(db,match.match_id)});
 return {status:"ok",count:matches.length,total,limit,offset,matches};
}

export default async(request)=>{
 const db=getDatabase();
 try{
  if(request.method==="GET"){
   const matchId=getMatchId(request);
   if(matchId){const match=await getOneMatch(db,matchId);return match?json(200,match):json(404,{status:"error",error:"Match not found"})}
   return json(200,await listMatches(db,request));
  }
  if(request.method!=="POST")return json(405,{status:"error",error:"Method not allowed"});
  const serverKey=request.headers.get("x-q2stats-server-key");
  if(!serverKey||!serverKey.startsWith("q2s_"))return json(401,{status:"error",error:"Unauthorized"});
  const hash=crypto.createHash("sha256").update(serverKey).digest("hex");
  const serverRows=await db.sql`SELECT id,name,enabled FROM servers WHERE server_key_hash=${hash} LIMIT 1`;
  if(!serverRows.length||!serverRows[0].enabled)return json(401,{status:"error",error:"Unauthorized"});
  const server=serverRows[0],body=await request.json();
  if(!body.match_id||!Array.isArray(body.players)||!body.players.length)return json(400,{status:"error",error:"match_id and players are required"});
  const existing=await db.sql`SELECT id FROM matches WHERE match_id=${body.match_id} LIMIT 1`;
  if(existing.length){
   const counts=await db.sql`SELECT COUNT(*)::int AS count FROM match_players WHERE match_id=${body.match_id}`;
   const playerCount=counts[0]?.count||0;

   if(playerCount>0){
    const weaponsSaved=await saveWeapons(db,body.match_id,body.players);
    await db.sql`UPDATE servers SET last_upload_at=NOW() WHERE id=${server.id}`;
    return json(200,{status:"duplicate",match_id:body.match_id,weapons_saved:weaponsSaved,server_id:server.id});
   }

   await db.sql`
    UPDATE matches
    SET server=${server.name},
        map=${body.map||"unknown"},
        game_type=${body.game_type||"team"},
        home_score=${Number(body.home_score||0)},
        away_score=${Number(body.away_score||0)},
        winner=${body.winner||null},
        match_type=${body.match_type||null},
        port=${body.port??null},
        saved_at=${body.saved_at||null}
    WHERE match_id=${body.match_id}
   `;

   for(const p of body.players)await db.sql`
    INSERT INTO match_players(match_id,name,team,frags,deaths,damage,ping,suicides,teamkills,teleports,damage_received,team_damage,team_damage_received)
    VALUES(${body.match_id},${p.name||""},${p.team||""},${Number(p.frags??p.kills??0)},${Number(p.deaths||0)},${Number(p.damage||0)},${Number(p.ping||0)},${Number(p.suicides||0)},${Number(p.teamkills||0)},${Number(p.teleports||0)},${Number(p.damage_received||0)},${Number(p.team_damage||0)},${Number(p.team_damage_received||0)})
   `;
   const weaponsSaved=await saveWeapons(db,body.match_id,body.players);

   await db.sql`UPDATE servers SET last_upload_at=NOW() WHERE id=${server.id}`;
   return json(200,{status:"repaired",match_id:body.match_id,players_saved:body.players.length,weapons_saved:weaponsSaved,server_id:server.id});
  }

  await db.sql`
   INSERT INTO matches(match_id,server,map,game_type,home_score,away_score,winner,match_type,port,saved_at)
   VALUES(${body.match_id},${server.name},${body.map||"unknown"},${body.game_type||"team"},${Number(body.home_score||0)},${Number(body.away_score||0)},${body.winner||null},${body.match_type||null},${body.port??null},${body.saved_at||null})
  `;
  for(const p of body.players)await db.sql`
   INSERT INTO match_players(match_id,name,team,frags,deaths,damage,ping,suicides,teamkills,teleports,damage_received,team_damage,team_damage_received)
   VALUES(${body.match_id},${p.name||""},${p.team||""},${Number(p.frags??p.kills??0)},${Number(p.deaths||0)},${Number(p.damage||0)},${Number(p.ping||0)},${Number(p.suicides||0)},${Number(p.teamkills||0)},${Number(p.teleports||0)},${Number(p.damage_received||0)},${Number(p.team_damage||0)},${Number(p.team_damage_received||0)})
  `;
  const weaponsSaved=await saveWeapons(db,body.match_id,body.players);
  await db.sql`UPDATE servers SET last_upload_at=NOW() WHERE id=${server.id}`;
  return json(200,{status:"saved",match_id:body.match_id,players_saved:body.players.length,weapons_saved:weaponsSaved,server_id:server.id});
 }catch(error){console.error(error);return json(500,{status:"error",error:error.message||"Internal server error"})}
};

export const config={path:["/api/v1/matches","/api/v1/matches/*"]};

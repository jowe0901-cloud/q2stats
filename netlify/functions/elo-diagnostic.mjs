import { getDatabase } from "@netlify/database";
import { VERSION, normalizePlayers, winner } from "./elo-engine.mjs";

const json=(status,body)=>new Response(JSON.stringify(body,null,2),{
  status,
  headers:{"content-type":"application/json; charset=utf-8"}
});

export default async(request)=>{
  if(request.method!=="GET") return json(405,{status:"error",error:"Method not allowed"});
  const url=new URL(request.url);
  const matchId=(url.searchParams.get("match_id")||"").trim();
  if(!matchId) return json(400,{status:"error",error:"match_id is required"});

  const db=getDatabase();
  const client=await db.pool.connect();
  try{
    const mr=await client.query(
      `SELECT id,match_id,home_score,away_score,winner,saved_at,created_at
       FROM matches WHERE match_id=$1 LIMIT 1`,[matchId]);
    if(!mr.rows.length) return json(404,{status:"error",error:"Match not found",match_id:matchId});

    const pr=await client.query(
      `SELECT id,match_id,name,team,frags,deaths,damage,suicides,teamkills,
              damage_received,team_damage
       FROM match_players WHERE match_id=$1 ORDER BY id ASC`,[matchId]);

    const normalized=normalizePlayers(pr.rows);
    const home=normalized.filter(p=>p.team==="Home");
    const away=normalized.filter(p=>p.team==="Away");
    const win=winner(mr.rows[0]);
    const type=(normalized.length===2&&home.length===1&&away.length===1)?"1v1":"team";

    const hr=await client.query(
      `SELECT id,match_id,player_name,elo_type,team,old_elo,elo_change,new_elo,algorithm_version,created_at
       FROM elo_history WHERE match_id=$1 ORDER BY id ASC`,[matchId]);

    const ratings=[];
    for(const p of normalized){
      const rr=await client.query(
        `SELECT player_name,elo_type,rating,matches,wins,losses,algorithm_version,updated_at
         FROM elo_ratings
         WHERE player_name=$1 AND elo_type=$2 AND algorithm_version=$3 LIMIT 1`,
        [p.name,type,VERSION]);
      ratings.push({player:p.name,current_rating:rr.rows[0]||null});
    }

    return json(200,{
      status:"ok",
      algorithm_version:VERSION,
      match:mr.rows[0],
      raw_players:pr.rows,
      normalized_players:normalized.map(p=>({
        name:p.name,team:p.team,frags:p.frags,deaths:p.deaths,damage:p.damage,
        damage_received:p.damage_received,suicides:p.suicides,teamkills:p.teamkills,
        team_damage:p.team_damage
      })),
      detected:{
        winner:win,
        elo_type:type,
        active_players:normalized.length,
        home_players:home.map(p=>p.name),
        away_players:away.map(p=>p.name),
        valid_for_elo:Boolean(home.length&&away.length&&win)
      },
      existing_history:hr.rows,
      current_ratings:ratings
    });
  }catch(e){
    console.error(e);
    return json(500,{status:"error",error:String(e?.message||e)});
  }finally{
    client.release();
  }
};

export const config={path:"/api/v1/elo-diagnostic"};

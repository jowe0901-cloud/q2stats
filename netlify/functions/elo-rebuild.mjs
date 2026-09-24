import { getDatabase } from "@netlify/database";
import { VERSION, START_ELO, calculateMatchElo } from "./elo-engine.mjs";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {"content-type":"application/json; charset=utf-8"}
  });

export default async (request) => {
  if(request.method!=="POST") return json(405,{status:"error",error:"Method not allowed"});
  const admin=request.headers.get("x-q2stats-admin-key");
  if(!admin || admin!==process.env.Q2STATS_ADMIN_KEY)
    return json(401,{status:"error",error:"Unauthorized"});

  const db=getDatabase();
  const client=await db.pool.connect();
  try{
    const mr=await client.query(`
      SELECT id,match_id,home_score,away_score,winner,saved_at,created_at
      FROM matches
      ORDER BY COALESCE(saved_at,created_at) ASC,id ASC
    `);

    // Preserve the historical nickname in match_players, but use the
    // profile's primary_name as the Elo identity when a profile exists.
    const pr=await client.query(`
      SELECT mp.match_id,
             mp.name AS historical_name,
             COALESCE(pp.primary_name, mp.name) AS name,
             mp.team,mp.frags,mp.deaths,mp.damage,mp.suicides,mp.teamkills,
             mp.damage_received,mp.team_damage
      FROM match_players mp
      LEFT JOIN player_profiles pp ON pp.id=mp.profile_id
      ORDER BY mp.id ASC
    `);

    const by=new Map();
    for(const p of pr.rows){
      if(!by.has(p.match_id)) by.set(p.match_id,[]);
      by.get(p.match_id).push(p);
    }

    const ratings={team:new Map(), "1v1":new Map()};
    const history=[];
    let skipped=0, used=0;
    const get=(type,name)=>{
      if(!ratings[type].has(name)) ratings[type].set(name,{rating:START_ELO,matches:0,wins:0,losses:0});
      return ratings[type].get(name);
    };

    for(const m of mr.rows){
      const result=calculateMatchElo(m,by.get(m.match_id)||[],get);
      if(!result){ skipped++; continue; }
      history.push(...result.changes);
      used++;
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM elo_history WHERE algorithm_version=$1",[VERSION]);
    await client.query("DELETE FROM elo_ratings WHERE algorithm_version=$1",[VERSION]);

    for(const [type,map] of Object.entries(ratings)){
      for(const [name,r] of map){
        await client.query(
          `INSERT INTO elo_ratings
           (player_name,elo_type,rating,matches,wins,losses,algorithm_version,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,NOW())`,
          [name,type,r.rating,r.matches,r.wins,r.losses,VERSION]
        );
      }
    }
    for(const h of history){
      await client.query(
        `INSERT INTO elo_history
         (match_id,player_name,elo_type,team,old_elo,elo_change,new_elo,algorithm_version)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [...h,VERSION]
      );
    }
    await client.query("COMMIT");

    return json(200,{
      status:"ok",algorithm_version:VERSION,
      matches_read:mr.rows.length,matches_used:used,skipped,
      ratings_written:ratings.team.size+ratings["1v1"].size,
      team_players:ratings.team.size,one_v_one_players:ratings["1v1"].size,
      history_written:history.length
    });
  }catch(e){
    try{await client.query("ROLLBACK")}catch{}
    console.error(e);
    return json(500,{status:"error",error:String(e?.message||e)});
  }finally{ client.release(); }
};

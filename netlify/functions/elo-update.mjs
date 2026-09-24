import { VERSION, START_ELO, calculateMatchElo } from "./elo-engine.mjs";

export async function updateEloForMatch(db, matchId){
  const client=await db.pool.connect();
  try{
    await client.query("BEGIN");

    const existing=await client.query(
      `SELECT 1 FROM elo_history WHERE match_id=$1 AND algorithm_version=$2 LIMIT 1`,
      [matchId,VERSION]
    );
    if(existing.rows.length){
      await client.query("COMMIT");
      return {status:"already_calculated",match_id:matchId};
    }

    const mr=await client.query(
      `SELECT id,match_id,home_score,away_score,winner,saved_at,created_at
       FROM matches WHERE match_id=$1 LIMIT 1`,
      [matchId]
    );
    if(!mr.rows.length){
      await client.query("ROLLBACK");
      return {status:"skipped",reason:"match_not_found",match_id:matchId};
    }

    // Historical match_players.name is never rewritten. For Elo, a linked
    // profile uses its primary_name; an unlinked player keeps the nickname.
    const pr=await client.query(
      `SELECT mp.match_id,
              mp.name AS historical_name,
              COALESCE(pp.primary_name, mp.name) AS name,
              mp.team,mp.frags,mp.deaths,mp.damage,mp.suicides,mp.teamkills,
              mp.damage_received,mp.team_damage
       FROM match_players mp
       LEFT JOIN player_profiles pp ON pp.id=mp.profile_id
       WHERE mp.match_id=$1
       ORDER BY mp.id ASC`,
      [matchId]
    );

    const cache={team:new Map(),"1v1":new Map()};
    const get=(type,name)=>{
      if(!cache[type].has(name)) cache[type].set(name,{rating:START_ELO,matches:0,wins:0,losses:0});
      return cache[type].get(name);
    };

    // Load current ratings for the resolved Elo identities.
    const names=[...new Set(pr.rows.map(p=>String(p.name||"").trim()).filter(Boolean))];
    for(const name of names){
      for(const type of ["team","1v1"]){
        const rr=await client.query(
          `SELECT rating,matches,wins,losses FROM elo_ratings
           WHERE player_name=$1 AND elo_type=$2 AND algorithm_version=$3 LIMIT 1`,
          [name,type,VERSION]
        );
        const row=rr.rows[0];
        cache[type].set(name,row
          ? {rating:Number(row.rating),matches:Number(row.matches),wins:Number(row.wins),losses:Number(row.losses)}
          : {rating:START_ELO,matches:0,wins:0,losses:0});
      }
    }

    const result=calculateMatchElo(mr.rows[0],pr.rows,get);
    if(!result){
      await client.query("ROLLBACK");
      return {status:"skipped",reason:"invalid_teams_or_winner",match_id:matchId};
    }

    for(const h of result.changes){
      await client.query(
        `INSERT INTO elo_history
         (match_id,player_name,elo_type,team,old_elo,elo_change,new_elo,algorithm_version)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [...h,VERSION]
      );
    }

    for(const [name,r] of cache[result.type]){
      // Only players changed by this match should be persisted.
      if(!result.changes.some(h=>h[1]===name)) continue;
      await client.query(
        `INSERT INTO elo_ratings
         (player_name,elo_type,rating,matches,wins,losses,algorithm_version,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (player_name,elo_type,algorithm_version)
         DO UPDATE SET rating=EXCLUDED.rating,matches=EXCLUDED.matches,
                       wins=EXCLUDED.wins,losses=EXCLUDED.losses,updated_at=NOW()`,
        [name,result.type,r.rating,r.matches,r.wins,r.losses,VERSION]
      );
    }

    await client.query("COMMIT");
    return {status:"updated",match_id:matchId,elo_type:result.type,players:result.changes.length};
  }catch(e){
    try{await client.query("ROLLBACK")}catch{}
    throw e;
  }finally{
    client.release();
  }
}

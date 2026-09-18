import { getDatabase } from "@netlify/database";

const json = (status, body) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: {"content-type":"application/json; charset=utf-8"}
});

export default async (request) => {
  if (request.method !== "GET") return json(405,{status:"error",error:"Method not allowed"});
  try {
    const db=getDatabase();

    const team=await db.sql`
      SELECT player_name, ROUND(rating)::int AS elo, matches, wins, losses
      FROM elo_ratings
      WHERE elo_type='team' AND algorithm_version='v1'
      ORDER BY rating DESC, player_name ASC
      LIMIT 10
    `;

    const one=await db.sql`
      SELECT player_name, ROUND(rating)::int AS elo, matches, wins, losses
      FROM elo_ratings
      WHERE elo_type='1v1' AND algorithm_version='v1'
      ORDER BY rating DESC, player_name ASC
      LIMIT 10
    `;

    const counts=await db.sql`
      SELECT elo_type, COUNT(*)::int AS players
      FROM elo_ratings
      WHERE algorithm_version='v1'
      GROUP BY elo_type
      ORDER BY elo_type
    `;

    const hist=await db.sql`
      SELECT COUNT(*)::int AS rows
      FROM elo_history
      WHERE algorithm_version='v1'
    `;

    return json(200,{
      status:"ok",
      algorithm_version:"v1",
      counts,
      history_rows:hist[0]?.rows ?? 0,
      top10_team:team,
      top10_1v1:one
    });
  } catch(e) {
    console.error(e);
    return json(500,{status:"error",error:String(e?.message||e)});
  }
};

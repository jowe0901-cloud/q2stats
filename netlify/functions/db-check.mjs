import { getDatabase } from "@netlify/database";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default async () => {
  const db = getDatabase();

  try {
    const matchRows = await db.sql`SELECT COUNT(*)::int AS count FROM matches`;
    const playerRows = await db.sql`SELECT COUNT(*)::int AS count FROM match_players`;
    const serverRows = await db.sql`SELECT COUNT(*)::int AS count FROM servers`;

    const match407 = await db.sql`
      SELECT id, match_id, map, home_score, away_score, saved_at
      FROM matches
      WHERE id = 407
      LIMIT 1
    `;

    const playersByNumericId = await db.sql`
      SELECT id, match_id, name, team, frags, deaths, ping
      FROM match_players
      WHERE match_id = 407
      ORDER BY id
      LIMIT 20
    `;

    const recentPlayerLinks = await db.sql`
      SELECT id, match_id, name, team
      FROM match_players
      ORDER BY id DESC
      LIMIT 12
    `;

    return json(200, {
      status: "ok",
      matches: matchRows[0]?.count ?? null,
      match_players: playerRows[0]?.count ?? null,
      servers: serverRows[0]?.count ?? null,
      diagnostic: {
        match_407: match407[0] ?? null,
        players_where_match_id_407: playersByNumericId,
        recent_match_player_links: recentPlayerLinks,
      },
    });
  } catch (error) {
    console.error(error);
    return json(500, {
      status: "error",
      error: error.message || "Database diagnostic failed",
    });
  }
};

export const config = {
  path: "/api/db-check",
};

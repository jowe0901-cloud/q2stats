import { getDatabase } from "@netlify/database";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default async () => {
  const db = getDatabase();

  try {
    const matchResult = await db.sql`SELECT COUNT(*)::int AS count FROM matches`;
    const playerResult = await db.sql`SELECT COUNT(*)::int AS count FROM match_players`;
    const serverResult = await db.sql`SELECT COUNT(*)::int AS count FROM servers`;

    return json(200, {
      status: "ok",
      matches: matchResult.rows?.[0]?.count ?? null,
      match_players: playerResult.rows?.[0]?.count ?? null,
      servers: serverResult.rows?.[0]?.count ?? null,
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

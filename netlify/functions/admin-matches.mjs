import { getDatabase } from "@netlify/database";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

const clean = value => String(value ?? "").trim();

export default async request => {
  if (!["GET", "DELETE"].includes(request.method)) return json(405, { status: "error", error: "Method not allowed" });

  const adminKey = request.headers.get("x-q2stats-admin-key");
  if (!process.env.Q2STATS_ADMIN_KEY || adminKey !== process.env.Q2STATS_ADMIN_KEY) {
    return json(401, { status: "error", error: "Unauthorized" });
  }

  if (request.method === "DELETE") {
    let body = {};
    try { body = await request.json(); } catch {}
    const matchId = clean(body.match_id);
    const confirmMatchId = clean(body.confirm_match_id);
    if (!matchId) return json(400, { status: "error", error: "match_id is required." });
    if (confirmMatchId !== matchId) return json(400, { status: "error", error: "Confirmation match ID does not match." });

    const db = getDatabase();
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT match_id, home_score, away_score FROM matches WHERE match_id=$1 FOR UPDATE", [matchId]);
      if (!existing.rowCount) {
        await client.query("ROLLBACK");
        return json(404, { status: "error", error: "Match not found." });
      }
      const history = await client.query("DELETE FROM elo_history WHERE match_id=$1", [matchId]);
      const deleted = await client.query("DELETE FROM matches WHERE match_id=$1 RETURNING match_id, home_score, away_score", [matchId]);
      await client.query("COMMIT");
      return json(200, { status: "ok", deleted: deleted.rows[0], elo_history_deleted: history.rowCount });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("Q2Stats admin match delete failed:", error);
      return json(500, { status: "error", error: String(error?.message || error) });
    } finally {
      client.release();
    }
  }

  const url = new URL(request.url);
  const ids = [...new Set((url.searchParams.get("ids") || "")
    .split(",")
    .map(clean)
    .filter(Boolean))];

  if (!ids.length) return json(400, { status: "error", error: "Provide one or more match IDs." });
  if (ids.length > 50) return json(400, { status: "error", error: "Maximum 50 match IDs per request." });

  const db = getDatabase();
  const client = await db.pool.connect();
  try {
    const mr = await client.query(`
      SELECT id, match_id, server, map, game_type, home_score, away_score,
             winner, match_type, port, saved_at, created_at
      FROM matches
      WHERE match_id = ANY($1::text[])
      ORDER BY COALESCE(saved_at, created_at) ASC, id ASC
    `, [ids]);

    const foundIds = mr.rows.map(r => r.match_id);
    let players = [];
    if (foundIds.length) {
      const pr = await client.query(`
        SELECT match_id, name, team, frags, deaths, damage, suicides, teamkills,
               damage_received, team_damage, team_damage_received
        FROM match_players
        WHERE match_id = ANY($1::text[])
        ORDER BY match_id, id ASC
      `, [foundIds]);
      players = pr.rows;
    }

    const byMatch = new Map();
    for (const p of players) {
      if (!byMatch.has(p.match_id)) byMatch.set(p.match_id, []);
      byMatch.get(p.match_id).push(p);
    }

    const matches = mr.rows.map(m => ({ ...m, players: byMatch.get(m.match_id) || [] }));
    const found = new Set(matches.map(m => m.match_id));
    const missing = ids.filter(id => !found.has(id));

    return json(200, { status: "ok", matches, missing });
  } catch (error) {
    console.error("Q2Stats admin match lookup failed:", error);
    return json(500, { status: "error", error: String(error?.message || error) });
  } finally {
    client.release();
  }
};

export const config = { path: "/api/admin/matches" };

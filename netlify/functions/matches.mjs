import { getDatabase } from "@netlify/database";
import crypto from "node:crypto";

const json = (statusCode, body) =>
  new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function getMatchId(event) {
  const path = event.path || "";
  const marker = "/api/v1/matches/";
  if (!path.includes(marker)) return null;
  const value = path.split(marker)[1]?.split("/")[0];
  return value ? decodeURIComponent(value) : null;
}

async function getOneMatch(db, matchId) {
  const rows = await db.sql`
    SELECT id, match_id, server, map, game_type, home_score, away_score,
           winner, match_type, port, saved_at, created_at
    FROM matches
    WHERE match_id = ${matchId}
    LIMIT 1
  `;

  if (!rows.rows?.length) return null;
  const match = rows.rows[0];

  const players = await db.sql`
    SELECT name, team, frags, deaths, damage, ping, suicides, teamkills,
           teleports, damage_received, team_damage, team_damage_received
    FROM match_players
    WHERE match_id = ${match.id}
    ORDER BY frags DESC, name ASC
  `;

  return { ...match, players: players.rows || [] };
}

async function listMatches(db, event) {
  const rawLimit = Number(event.queryStringParameters?.limit || 20);
  const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 20, 100));

  const rows = await db.sql`
    SELECT id, match_id, server, map, game_type, home_score, away_score,
           winner, match_type, port, saved_at, created_at
    FROM matches
    ORDER BY COALESCE(saved_at, created_at) DESC, id DESC
    LIMIT ${limit}
  `;

  return {
    status: "ok",
    count: rows.rows?.length || 0,
    matches: rows.rows || [],
  };
}

export default async (event) => {
  const db = getDatabase();

  try {
    if (event.httpMethod === "GET") {
      const matchId = getMatchId(event);

      if (matchId) {
        const match = await getOneMatch(db, matchId);
        return match
          ? json(200, match)
          : json(404, { status: "error", error: "Match not found" });
      }

      return json(200, await listMatches(db, event));
    }

    if (event.httpMethod !== "POST") {
      return json(405, { status: "error", error: "Method not allowed" });
    }

    const serverKey = event.headers?.["x-q2stats-server-key"] || event.headers?.["X-Q2Stats-Server-Key"];
    if (!serverKey || !serverKey.startsWith("q2s_")) {
      return json(401, { status: "error", error: "Unauthorized" });
    }

    const serverKeyHash = crypto.createHash("sha256").update(serverKey).digest("hex");

    const serverRows = await db.sql`
      SELECT id, name, enabled
      FROM servers
      WHERE server_key_hash = ${serverKeyHash}
      LIMIT 1
    `;

    if (!serverRows.rows?.length || !serverRows.rows[0].enabled) {
      return json(401, { status: "error", error: "Unauthorized" });
    }

    const server = serverRows.rows[0];
    const body = JSON.parse(event.body || "{}");

    if (!body.match_id || !Array.isArray(body.players) || body.players.length === 0) {
      return json(400, { status: "error", error: "match_id and players are required" });
    }

    const existing = await db.sql`
      SELECT id FROM matches WHERE match_id = ${body.match_id} LIMIT 1
    `;
    if (existing.rows?.length) {
      return json(200, { status: "duplicate", match_id: body.match_id, server_id: server.id });
    }

    const inserted = await db.sql`
      INSERT INTO matches (
        match_id, server, map, game_type, home_score, away_score,
        winner, match_type, port, saved_at
      )
      VALUES (
        ${body.match_id},
        ${server.name},
        ${body.map || "unknown"},
        ${body.game_type || "team"},
        ${Number(body.home_score || 0)},
        ${Number(body.away_score || 0)},
        ${body.winner || null},
        ${body.match_type || null},
        ${body.port ?? null},
        ${body.saved_at || null}
      )
      RETURNING id
    `;

    const dbMatchId = inserted.rows[0].id;

    for (const p of body.players) {
      await db.sql`
        INSERT INTO match_players (
          match_id, name, team, frags, deaths, damage, ping,
          suicides, teamkills, teleports, damage_received,
          team_damage, team_damage_received
        )
        VALUES (
          ${dbMatchId},
          ${p.name || ""},
          ${p.team || ""},
          ${Number(p.frags || 0)},
          ${Number(p.deaths || 0)},
          ${Number(p.damage || 0)},
          ${Number(p.ping || 0)},
          ${Number(p.suicides || 0)},
          ${Number(p.teamkills || 0)},
          ${Number(p.teleports || 0)},
          ${Number(p.damage_received || 0)},
          ${Number(p.team_damage || 0)},
          ${Number(p.team_damage_received || 0)}
        )
      `;
    }

    await db.sql`
      UPDATE servers SET last_upload_at = NOW() WHERE id = ${server.id}
    `;

    return json(200, {
      status: "saved",
      match_id: body.match_id,
      players_saved: body.players.length,
      server_id: server.id,
    });
  } catch (error) {
    console.error(error);
    return json(500, { status: "error", error: error.message || "Internal server error" });
  }
};

export const config = {
  path: ["/api/v1/matches", "/api/v1/matches/*"],
};

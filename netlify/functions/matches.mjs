import { getDatabase } from "@netlify/database";
import crypto from "node:crypto";

const json = (data, status = 200) =>
  Response.json(data, { status });

const number = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

export default async (req) => {
  const url = new URL(req.url);
  const basePath = "/api/v1/matches";
  const suffix = url.pathname.startsWith(basePath)
    ? url.pathname.slice(basePath.length).replace(/^\/+|\/+$/g, "")
    : "";

  const db = getDatabase();

  // GET /api/v1/matches/{match_id}
  // Public read access.
  if (req.method === "GET") {
    if (!suffix) {
      return json(
        { status: "error", error: "match_id is required" },
        400
      );
    }

    try {
      const matchResult = await db.sql`
        SELECT
          id,
          match_id,
          server,
          map,
          game_type,
          home_score,
          away_score,
          winner,
          match_type,
          port,
          saved_at,
          created_at
        FROM matches
        WHERE match_id = ${suffix}
        LIMIT 1
      `;

      if (matchResult.length === 0) {
        return json(
          { status: "not_found", match_id: suffix },
          404
        );
      }

      const playersResult = await db.sql`
        SELECT
          name,
          team,
          frags,
          deaths,
          damage,
          ping,
          suicides,
          teamkills,
          teleports,
          damage_received,
          team_damage,
          team_damage_received
        FROM match_players
        WHERE match_id = ${suffix}
        ORDER BY id
      `;

      return json({
        ...matchResult[0],
        players: playersResult
      });
    } catch (error) {
      console.error("Q2Stats match lookup failed:", error);

      return json(
        { status: "error", error: "Could not load match" },
        500
      );
    }
  }

  // POST /api/v1/matches
  if (req.method !== "POST") {
    return json(
      { status: "error", error: "Method not allowed" },
      405
    );
  }

  if (suffix) {
    return json(
      { status: "error", error: "Method not allowed" },
      405
    );
  }

  // Authenticate the OpenTDM server.
  // The uploader sends the secret q2s_... key in this header.
  const serverKey = req.headers.get("x-q2stats-server-key");

  if (!serverKey || !serverKey.startsWith("q2s_")) {
    return json(
      { status: "error", error: "Unauthorized" },
      401
    );
  }

  const serverKeyHash = sha256(serverKey);

  let registeredServer;

  try {
    const serverResult = await db.sql`
      SELECT id, name, enabled
      FROM servers
      WHERE server_key_hash = ${serverKeyHash}
      LIMIT 1
    `;

    if (serverResult.length === 0 || !serverResult[0].enabled) {
      return json(
        { status: "error", error: "Unauthorized" },
        401
      );
    }

    registeredServer = serverResult[0];
  } catch (error) {
    console.error("Q2Stats server authentication failed:", error);

    return json(
      { status: "error", error: "Could not authenticate server" },
      500
    );
  }

  let match;

  try {
    match = await req.json();
  } catch {
    return json(
      { status: "error", error: "Invalid JSON" },
      400
    );
  }

  if (!match?.match_id) {
    return json(
      { status: "error", error: "match_id is required" },
      400
    );
  }

  if (!Array.isArray(match.players) || match.players.length === 0) {
    return json(
      { status: "error", error: "players are required" },
      400
    );
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT match_id FROM matches WHERE match_id = $1",
      [String(match.match_id)]
    );

    if (existing.rowCount > 0) {
      await client.query("ROLLBACK");

      return json({
        status: "duplicate",
        match_id: String(match.match_id)
      });
    }

    await client.query(
      `INSERT INTO matches (
        match_id,
        server,
        map,
        game_type,
        home_score,
        away_score,
        winner,
        match_type,
        port,
        saved_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        String(match.match_id),
        String(registeredServer.name),
        String(match.map || "unknown"),
        String(match.game_type || "unknown"),
        number(match.home_score),
        number(match.away_score),
        match.winner ?? null,
        match.match_type ?? null,
        match.port == null ? null : number(match.port),
        match.saved_at ?? null
      ]
    );

    const seenPlayers = new Set();
    let playersSaved = 0;

    for (const player of match.players) {
      if (!player?.name || !player?.team) continue;

      const name = String(player.name);
      const team = String(player.team).toLowerCase();
      const key = `${name}\u0000${team}`;

      if (seenPlayers.has(key)) continue;
      seenPlayers.add(key);

      await client.query(
        `INSERT INTO match_players (
          match_id,
          name,
          team,
          frags,
          deaths,
          damage,
          ping,
          suicides,
          teamkills,
          teleports,
          damage_received,
          team_damage,
          team_damage_received
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          String(match.match_id),
          name,
          team,
          number(player.frags ?? player.kills),
          number(player.deaths),
          number(player.damage),
          number(player.ping),
          number(player.suicides),
          number(player.teamkills),
          number(player.teleports),
          number(player.damage_received),
          number(player.team_damage),
          number(player.team_damage_received)
        ]
      );

      playersSaved++;
    }

    if (playersSaved === 0) {
      throw new Error("No valid players supplied");
    }

    await client.query(
      "UPDATE servers SET last_upload_at = NOW() WHERE id = $1",
      [registeredServer.id]
    );

    await client.query("COMMIT");

    return json({
      status: "saved",
      match_id: String(match.match_id),
      players_saved: playersSaved,
      server_id: registeredServer.id
    });

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("Q2Stats match upload failed:", error);

    return json(
      { status: "error", error: "Could not save match" },
      500
    );

  } finally {
    client.release();
  }
};

export const config = {
  path: ["/api/v1/matches", "/api/v1/matches/*"]
};

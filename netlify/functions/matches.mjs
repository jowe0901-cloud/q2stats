import { getDatabase } from "@netlify/database";

const json = (data, status = 200) =>
  Response.json(data, { status });

const number = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

export default async (req) => {
  if (req.method !== "POST") {
    return json(
      { status: "error", error: "Method not allowed" },
      405
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

  const db = getDatabase();
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
        String(match.server || "Unknown OpenTDM server"),
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

      // Some older Q2Stats matches contain duplicate player rows.
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

    await client.query("COMMIT");

    return json({
      status: "saved",
      match_id: String(match.match_id),
      players_saved: playersSaved
    });

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("Q2Stats match upload failed:", error);

    return json(
      {
        status: "error",
        error: "Could not save match"
      },
      500
    );

  } finally {
    client.release();
  }
};

export const config = {
  path: "/api/v1/matches"
};
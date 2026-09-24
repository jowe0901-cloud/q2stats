import { getDatabase } from "@netlify/database";

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=30"
  }
});

const clean = v => String(v ?? "").trim();

function toPlayerRow(row) {
  return {
    name: row.name,
    player_id: row.player_id ?? null,
    profile_id: row.profile_id ?? null,
    team: row.team,
    frags: Number(row.frags ?? 0),
    kills: Number(row.frags ?? row.kills ?? 0),
    deaths: Number(row.deaths ?? 0),
    damage: Number(row.damage ?? 0),
    damage_received: Number(row.damage_received ?? 0),
    suicides: Number(row.suicides ?? 0),
    teamkills: Number(row.teamkills ?? 0),
    ping: row.ping ?? null
  };
}

export default async request => {
  if (request.method !== "GET") {
    return json(405, { status: "error", error: "Method not allowed" });
  }

  try {
    const url = new URL(request.url);
    const nickname = clean(url.searchParams.get("nickname"));
    const profileId = clean(url.searchParams.get("profile_id"));

    if (!nickname && !profileId) {
      return json(400, { status: "error", error: "nickname or profile_id is required" });
    }

    const db = getDatabase();

    let profiles;
    if (profileId) {
      profiles = await db.sql`
        SELECT id, primary_name, created_at, updated_at
        FROM player_profiles
        WHERE id = ${profileId}
        LIMIT 1
      `;
    } else {
      profiles = await db.sql`
        SELECT DISTINCT p.id, p.primary_name, p.created_at, p.updated_at
        FROM player_profiles p
        JOIN player_aliases a ON a.profile_id = p.id
        WHERE a.nickname = ${nickname}
        LIMIT 1
      `;
    }

    if (!profiles.length) {
      return json(404, { status: "not_found", error: "Public profile not found" });
    }

    const profile = profiles[0];

    const aliasRows = await db.sql`
      SELECT nickname
      FROM player_aliases
      WHERE profile_id = ${profile.id}
      ORDER BY CASE WHEN nickname = ${profile.primary_name} THEN 0 ELSE 1 END,
               LOWER(nickname), nickname
    `;

    const matchRows = await db.sql`
      SELECT
        m.id, m.match_id, m.server, m.map, m.game_type,
        m.home_score, m.away_score, m.winner, m.match_type,
        m.port, m.saved_at, m.created_at,
        mp.name, mp.player_id, mp.profile_id, mp.team,
        mp.frags, mp.deaths, mp.damage, mp.ping,
        mp.suicides, mp.teamkills, mp.teleports,
        mp.damage_received, mp.team_damage, mp.team_damage_received
      FROM matches m
      JOIN match_players mp ON mp.match_id = m.match_id
      WHERE mp.profile_id = ${profile.id}
      ORDER BY COALESCE(m.saved_at, m.created_at) DESC, m.id DESC
    `;

    const grouped = new Map();
    for (const row of matchRows) {
      let match = grouped.get(row.match_id);
      if (!match) {
        match = {
          id: row.id,
          match_id: row.match_id,
          server: row.server,
          map: row.map,
          game_type: row.game_type,
          home_score: row.home_score,
          away_score: row.away_score,
          winner: row.winner,
          match_type: row.match_type,
          port: row.port,
          saved_at: row.saved_at,
          created_at: row.created_at,
          players: []
        };
        grouped.set(row.match_id, match);
      }
      match.players.push(toPlayerRow(row));
    }

    const matches = [...grouped.values()];

    const weaponRows = await db.sql`
      SELECT
        w.weapon,
        AVG(w.accuracy) FILTER (WHERE w.accuracy IS NOT NULL) AS avg_accuracy,
        COALESCE(SUM(w.kills), 0)::int AS kills,
        COUNT(*)::int AS matches
      FROM match_player_weapons w
      JOIN match_players mp
        ON mp.match_id = w.match_id
       AND mp.name = w.player_name
      WHERE mp.profile_id = ${profile.id}
      GROUP BY w.weapon
      ORDER BY COALESCE(SUM(w.kills), 0) DESC, w.weapon ASC
    `;

    const weaponHistoryRows = await db.sql`
      SELECT
        w.match_id,
        w.weapon,
        w.accuracy,
        w.kills,
        w.deaths,
        w.dealt,
        w.received,
        w.pick,
        w.miss,
        COALESCE(m.saved_at, m.created_at) AS played_at
      FROM match_player_weapons w
      JOIN match_players mp
        ON mp.match_id = w.match_id
       AND mp.name = w.player_name
      JOIN matches m ON m.match_id = w.match_id
      WHERE mp.profile_id = ${profile.id}
      ORDER BY COALESCE(m.saved_at, m.created_at) ASC, m.id ASC, w.weapon ASC
    `;

    const byMatch = new Map();
    for (const row of weaponHistoryRows) {
      let item = byMatch.get(row.match_id);
      if (!item) {
        item = { match_id: row.match_id, played_at: row.played_at, weapons: {} };
        byMatch.set(row.match_id, item);
      }
      item.weapons[row.weapon] = {
        accuracy: row.accuracy == null ? null : Number(row.accuracy),
        kills: row.kills == null ? null : Number(row.kills),
        deaths: row.deaths == null ? null : Number(row.deaths),
        dealt: row.dealt == null ? null : Number(row.dealt),
        received: row.received == null ? null : Number(row.received),
        pick: row.pick == null ? null : Number(row.pick),
        miss: row.miss == null ? null : Number(row.miss)
      };
    }

    const weaponSummary = weaponRows.map(row => ({
      w: row.weapon,
      weapon: row.weapon,
      acc: row.avg_accuracy == null ? null : Number(row.avg_accuracy),
      accuracy: row.avg_accuracy == null ? null : Number(row.avg_accuracy),
      kills: Number(row.kills || 0),
      matches: Number(row.matches || 0)
    }));

    return json(200, {
      status: "ok",
      profile,
      aliases: aliasRows.map(r => r.nickname),
      total_matches: matches.length,
      matches,
      weapons: {
        summary: weaponSummary,
        history: [...byMatch.values()]
      }
    });
  } catch (error) {
    console.error("Q2Stats public profile failed:", error);
    return json(500, {
      status: "error",
      error: error.message || "Internal server error"
    });
  }
};

export const config = {
  path: "/api/v1/profiles"
};

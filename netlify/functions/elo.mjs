import { getDatabase } from "@netlify/database";

const VERSION = "v1";

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=30"
  }
});

export default async (request) => {
  if (request.method !== "GET") {
    return json(405, { status: "error", error: "Method not allowed" });
  }

  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "team";
    if (type !== "team" && type !== "1v1") {
      return json(400, {
        status: "error",
        error: "type must be team or 1v1"
      });
    }

    const rawLimit = Number(url.searchParams.get("limit") || 100);
    const rawOffset = Number(url.searchParams.get("offset") || 0);
    const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 100, 100));
    const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0);

    const db = getDatabase();

    // Player Elo history mode.
    // Example: /.netlify/functions/elo?type=team&player=qw
    const player = (url.searchParams.get("player") || "").trim();
    if (player) {
      const historyRows = await db.sql`
        SELECT
          match_id,
          player_name,
          elo_type,
          team,
          old_elo,
          elo_change,
          new_elo,
          created_at
        FROM elo_history
        WHERE player_name=${player}
          AND elo_type=${type}
          AND algorithm_version=${VERSION}
        ORDER BY id ASC
      `;

      const history = historyRows.map((r) => ({
        match_id: r.match_id,
        player: r.player_name,
        type: r.elo_type,
        team: r.team,
        elo_before: Number(r.old_elo),
        elo_change: Number(r.elo_change),
        elo_after: Number(r.new_elo),
        created_at: r.created_at
      }));

      return json(200, {
        status: "ok",
        algorithm_version: VERSION,
        type,
        player,
        count: history.length,
        history
      });
    }

    const countRows = await db.sql`
      SELECT COUNT(*)::int AS count
      FROM elo_ratings
      WHERE elo_type=${type}
        AND algorithm_version=${VERSION}
    `;
    const total = countRows[0]?.count || 0;

    const rows = await db.sql`
      SELECT
        player_name,
        ROUND(rating)::int AS elo,
        rating AS elo_exact,
        matches,
        wins,
        losses,
        CASE
          WHEN matches > 0 THEN ROUND((wins::numeric / matches::numeric) * 100, 1)
          ELSE 0
        END AS winrate
      FROM elo_ratings
      WHERE elo_type=${type}
        AND algorithm_version=${VERSION}
      ORDER BY rating DESC, player_name ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const rankings = rows.map((r, i) => ({
      rank: offset + i + 1,
      player: r.player_name,
      elo: Number(r.elo),
      matches: Number(r.matches),
      wins: Number(r.wins),
      losses: Number(r.losses),
      winrate: Number(r.winrate)
    }));

    return json(200, {
      status: "ok",
      algorithm_version: VERSION,
      type,
      total,
      count: rankings.length,
      limit,
      offset,
      rankings
    });
  } catch (e) {
    console.error(e);
    return json(500, {
      status: "error",
      error: String(e?.message || e)
    });
  }
};

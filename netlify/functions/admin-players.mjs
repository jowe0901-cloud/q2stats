import { getDatabase } from "@netlify/database";

const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: { "cache-control": "no-store" }
  });

const clean = (value) => String(value ?? "").trim();

export default async (req) => {
  const adminKey = req.headers.get("x-q2stats-admin-key");
  const expectedAdminKey = process.env.Q2STATS_ADMIN_KEY;

  if (!expectedAdminKey || adminKey !== expectedAdminKey) {
    return json({ status: "error", error: "Unauthorized" }, 401);
  }

  const db = getDatabase();

  try {
    // First version:
    // GET  /api/admin/players
    // POST /api/admin/players  { primary_name, aliases?: [] }
    //
    // No Elo rows are changed here. Elo recalculation will be a separate step.

    if (req.method === "GET") {
      const profiles = await db.sql`
        SELECT
          p.id,
          p.primary_name,
          p.created_at,
          p.updated_at,
          COALESCE(
            json_agg(
              DISTINCT a.nickname
            ) FILTER (WHERE a.nickname IS NOT NULL),
            '[]'::json
          ) AS aliases
        FROM player_profiles p
        LEFT JOIN player_aliases a ON a.profile_id = p.id
        GROUP BY p.id, p.primary_name, p.created_at, p.updated_at
        ORDER BY LOWER(p.primary_name), p.id
      `;

      // Inventory of historical/current nicknames.
      // player_id is returned only by this admin-protected endpoint.
      const players = await db.sql`
        SELECT
          mp.name,
          COUNT(*)::int AS matches,
          COUNT(DISTINCT mp.player_id)
            FILTER (WHERE mp.player_id IS NOT NULL)::int AS player_id_count,
          MIN(mp.player_id) FILTER (WHERE mp.player_id IS NOT NULL) AS player_id,
          MIN(mp.profile_id) FILTER (WHERE mp.profile_id IS NOT NULL) AS profile_id
        FROM match_players mp
        GROUP BY mp.name
        ORDER BY LOWER(mp.name), mp.name
      `;

      return json({
        status: "ok",
        profiles,
        players
      });
    }

    if (req.method !== "POST") {
      return json({ status: "error", error: "Method not allowed" }, 405);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ status: "error", error: "Invalid JSON" }, 400);
    }

    const primaryName = clean(body?.primary_name);
    const requestedAliases = Array.isArray(body?.aliases)
      ? body.aliases.map(clean).filter(Boolean)
      : [];

    if (!primaryName) {
      return json(
        { status: "error", error: "primary_name is required" },
        400
      );
    }

    const aliases = [...new Set([primaryName, ...requestedAliases])];

    // Do not silently steal a nickname from another profile.
    const conflicts = await db.sql`
      SELECT nickname, profile_id
      FROM player_aliases
      WHERE nickname = ANY(${aliases})
    `;

    if (conflicts.length) {
      return json(
        {
          status: "conflict",
          error: "One or more nicknames already belong to a profile",
          conflicts
        },
        409
      );
    }

    // Create the public profile.
    const created = await db.sql`
      INSERT INTO player_profiles (primary_name)
      VALUES (${primaryName})
      RETURNING id, primary_name, created_at, updated_at
    `;

    const profile = created[0];

    // Add aliases one by one. This deliberately preserves match_players.name.
    for (const nickname of aliases) {
      await db.sql`
        INSERT INTO player_aliases (profile_id, nickname)
        VALUES (${profile.id}, ${nickname})
      `;

      // Link all historical rows carrying this exact nickname.
      await db.sql`
        UPDATE match_players
        SET profile_id = ${profile.id}
        WHERE name = ${nickname}
          AND profile_id IS NULL
      `;
    }

    // Link known agent identities found on the newly linked match rows.
    // A player_id already assigned to another profile is never reassigned here.
    const identities = await db.sql`
      SELECT DISTINCT player_id
      FROM match_players
      WHERE profile_id = ${profile.id}
        AND player_id IS NOT NULL
        AND player_id <> ''
    `;

    for (const row of identities) {
      await db.sql`
        INSERT INTO player_identities (profile_id, player_id)
        VALUES (${profile.id}, ${row.player_id})
        ON CONFLICT (player_id) DO NOTHING
      `;
    }

    return json(
      {
        status: "created",
        profile,
        aliases,
        warning: "Elo has not been recalculated."
      },
      201
    );
  } catch (error) {
    console.error("Q2Stats admin players failed:", error);
    return json(
      { status: "error", error: error.message || "Internal server error" },
      500
    );
  }
};

export const config = {
  path: "/api/admin/players"
};

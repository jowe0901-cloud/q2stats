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
    // POST /api/admin/players
    //   create:    { primary_name, aliases?: [] }
    //   add_alias:    { action: "add_alias", profile_id, nickname }
    //   remove_alias: { action: "remove_alias", profile_id, nickname }
    //   set_primary:  { action: "set_primary", profile_id, nickname }
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

    const action = clean(body?.action);

    if (action === "set_primary") {
      const profileId = Number(body?.profile_id);
      const nickname = clean(body?.nickname);

      if (!Number.isSafeInteger(profileId) || profileId <= 0) {
        return json({ status: "error", error: "Valid profile_id is required" }, 400);
      }

      if (!nickname) {
        return json({ status: "error", error: "nickname is required" }, 400);
      }

      const client = await db.pool.connect();
      let transactionStarted = false;

      try {
        await client.query("BEGIN");
        transactionStarted = true;

        const profileResult = await client.query(
          `
            SELECT id, primary_name
            FROM player_profiles
            WHERE id = $1
            FOR UPDATE
          `,
          [profileId]
        );

        if (!profileResult.rows.length) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return json({ status: "error", error: "Profile not found" }, 404);
        }

        const aliasResult = await client.query(
          `
            SELECT nickname
            FROM player_aliases
            WHERE profile_id = $1
              AND nickname = $2
          `,
          [profileId, nickname]
        );

        if (!aliasResult.rows.length) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return json(
            {
              status: "conflict",
              error: "Primary nickname must already belong to this profile"
            },
            409
          );
        }

        const updatedResult = await client.query(
          `
            UPDATE player_profiles
            SET primary_name = $2,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, primary_name, created_at, updated_at
          `,
          [profileId, nickname]
        );

        await client.query("COMMIT");
        transactionStarted = false;

        return json({
          status: "primary_changed",
          profile: updatedResult.rows[0],
          warning: "Historical match names and Elo have not been changed."
        });
      } catch (error) {
        if (transactionStarted) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            console.error("Q2Stats set primary rollback failed:", rollbackError);
          }
        }
        throw error;
      } finally {
        client.release();
      }
    }

    if (action === "remove_alias") {
      const profileId = Number(body?.profile_id);
      const nickname = clean(body?.nickname);

      if (!Number.isSafeInteger(profileId) || profileId <= 0) {
        return json({ status: "error", error: "Valid profile_id is required" }, 400);
      }

      if (!nickname) {
        return json({ status: "error", error: "nickname is required" }, 400);
      }

      const client = await db.pool.connect();
      let transactionStarted = false;

      try {
        await client.query("BEGIN");
        transactionStarted = true;

        const profileResult = await client.query(
          `
            SELECT id, primary_name
            FROM player_profiles
            WHERE id = $1
            FOR UPDATE
          `,
          [profileId]
        );

        if (!profileResult.rows.length) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return json({ status: "error", error: "Profile not found" }, 404);
        }

        const profile = profileResult.rows[0];

        // The main nickname must remain attached to its profile.
        if (nickname === profile.primary_name) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return json(
            {
              status: "conflict",
              error: "Primary nickname cannot be removed. Change the primary nickname first."
            },
            409
          );
        }

        const aliasResult = await client.query(
          `
            SELECT id
            FROM player_aliases
            WHERE profile_id = $1
              AND nickname = $2
          `,
          [profileId, nickname]
        );

        if (!aliasResult.rows.length) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return json({ status: "error", error: "Alias not found on this profile" }, 404);
        }

        // Preserve historical nickname text; only detach profile ownership.
        const detachedResult = await client.query(
          `
            UPDATE match_players
            SET profile_id = NULL
            WHERE profile_id = $1
              AND name = $2
          `,
          [profileId, nickname]
        );

        await client.query(
          `
            DELETE FROM player_aliases
            WHERE profile_id = $1
              AND nickname = $2
          `,
          [profileId, nickname]
        );

        // Remove identities that are no longer represented by any match row
        // attached to this profile. Identities still used by another alias stay.
        await client.query(
          `
            DELETE FROM player_identities pi
            WHERE pi.profile_id = $1
              AND NOT EXISTS (
                SELECT 1
                FROM match_players mp
                WHERE mp.profile_id = $1
                  AND mp.player_id = pi.player_id
              )
          `,
          [profileId]
        );

        await client.query(
          `
            UPDATE player_profiles
            SET updated_at = NOW()
            WHERE id = $1
          `,
          [profileId]
        );

        await client.query("COMMIT");
        transactionStarted = false;

        return json({
          status: "alias_removed",
          profile,
          nickname,
          detached_matches: detachedResult.rowCount,
          warning: "Elo has not been recalculated."
        });
      } catch (error) {
        if (transactionStarted) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            console.error("Q2Stats remove alias rollback failed:", rollbackError);
          }
        }
        throw error;
      } finally {
        client.release();
      }
    }

    if (action === "add_alias") {
      const profileId = Number(body?.profile_id);
      const nickname = clean(body?.nickname);

      if (!Number.isSafeInteger(profileId) || profileId <= 0) {
        return json({ status: "error", error: "Valid profile_id is required" }, 400);
      }

      if (!nickname) {
        return json({ status: "error", error: "nickname is required" }, 400);
      }

      const client = await db.pool.connect();
      let transactionStarted = false;

      try {
        await client.query("BEGIN");
        transactionStarted = true;

        const profileResult = await client.query(
          `
            SELECT id, primary_name
            FROM player_profiles
            WHERE id = $1
            FOR UPDATE
          `,
          [profileId]
        );

        if (!profileResult.rows.length) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return json({ status: "error", error: "Profile not found" }, 404);
        }

        const aliasConflict = await client.query(
          `
            SELECT nickname, profile_id
            FROM player_aliases
            WHERE nickname = $1
          `,
          [nickname]
        );

        if (aliasConflict.rows.length) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return json(
            {
              status: "conflict",
              error: "Nickname already belongs to a profile",
              conflicts: aliasConflict.rows
            },
            409
          );
        }

        // Never steal historical rows already attached to another profile.
        const rowConflict = await client.query(
          `
            SELECT DISTINCT profile_id
            FROM match_players
            WHERE name = $1
              AND profile_id IS NOT NULL
              AND profile_id <> $2
          `,
          [nickname, profileId]
        );

        if (rowConflict.rows.length) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return json(
            {
              status: "conflict",
              error: "Nickname has historical rows linked to another profile"
            },
            409
          );
        }

        await client.query(
          `
            INSERT INTO player_aliases (profile_id, nickname)
            VALUES ($1, $2)
          `,
          [profileId, nickname]
        );

        const linkedResult = await client.query(
          `
            UPDATE match_players
            SET profile_id = $1
            WHERE name = $2
              AND profile_id IS NULL
            RETURNING player_id
          `,
          [profileId, nickname]
        );

        const playerIds = [
          ...new Set(
            linkedResult.rows
              .map((row) => clean(row.player_id))
              .filter(Boolean)
          )
        ];

        for (const playerId of playerIds) {
          await client.query(
            `
              INSERT INTO player_identities (profile_id, player_id)
              VALUES ($1, $2)
              ON CONFLICT (player_id) DO NOTHING
            `,
            [profileId, playerId]
          );
        }

        await client.query(
          `
            UPDATE player_profiles
            SET updated_at = NOW()
            WHERE id = $1
          `,
          [profileId]
        );

        await client.query("COMMIT");
        transactionStarted = false;

        return json(
          {
            status: "alias_added",
            profile: profileResult.rows[0],
            nickname,
            linked_matches: linkedResult.rowCount,
            warning: "Elo has not been recalculated."
          },
          200
        );
      } catch (error) {
        if (transactionStarted) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            console.error("Q2Stats add alias rollback failed:", rollbackError);
          }
        }
        throw error;
      } finally {
        client.release();
      }
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

    // All profile creation/linking writes run on one PostgreSQL connection.
    // If any step fails, the entire operation is rolled back.
    const client = await db.pool.connect();
    let profile;
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      // Do not silently steal a nickname from another profile.
      // This check is repeated inside the transaction so the following
      // writes are protected as one atomic operation.
      const conflictResult = await client.query(
        `
          SELECT nickname, profile_id
          FROM player_aliases
          WHERE nickname = ANY($1::text[])
        `,
        [aliases]
      );

      if (conflictResult.rows.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return json(
          {
            status: "conflict",
            error: "One or more nicknames already belong to a profile",
            conflicts: conflictResult.rows
          },
          409
        );
      }

      const createdResult = await client.query(
        `
          INSERT INTO player_profiles (primary_name)
          VALUES ($1)
          RETURNING id, primary_name, created_at, updated_at
        `,
        [primaryName]
      );

      profile = createdResult.rows[0];

      // Preserve match_players.name. Only attach the historical rows
      // to the new internal profile.
      for (const nickname of aliases) {
        await client.query(
          `
            INSERT INTO player_aliases (profile_id, nickname)
            VALUES ($1, $2)
          `,
          [profile.id, nickname]
        );

        await client.query(
          `
            UPDATE match_players
            SET profile_id = $1
            WHERE name = $2
              AND profile_id IS NULL
          `,
          [profile.id, nickname]
        );
      }

      // Link known agent identities found on the newly linked match rows.
      // Existing player_id ownership is never reassigned.
      const identityResult = await client.query(
        `
          SELECT DISTINCT player_id
          FROM match_players
          WHERE profile_id = $1
            AND player_id IS NOT NULL
            AND player_id <> ''
        `,
        [profile.id]
      );

      for (const row of identityResult.rows) {
        await client.query(
          `
            INSERT INTO player_identities (profile_id, player_id)
            VALUES ($1, $2)
            ON CONFLICT (player_id) DO NOTHING
          `,
          [profile.id, row.player_id]
        );
      }

      await client.query("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Q2Stats player profile rollback failed:", rollbackError);
        }
      }
      throw error;
    } finally {
      client.release();
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

import { getDatabase } from "@netlify/database";

export default async () => {
  try {
    const db = getDatabase();

    const ratings = await db.sql`
      SELECT COUNT(*)::int AS count
      FROM elo_ratings
    `;

    const history = await db.sql`
      SELECT COUNT(*)::int AS count
      FROM elo_history
    `;

    return new Response(
      JSON.stringify(
        {
          ok: true,
          elo_ratings: {
            exists: true,
            rows: Number(ratings[0]?.count ?? 0)
          },
          elo_history: {
            exists: true,
            rows: Number(history[0]?.count ?? 0)
          }
        },
        null,
        2
      ),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: error?.message ?? String(error)
        },
        null,
        2
      ),
      {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" }
      }
    );
  }
};

import { getDatabase } from "@netlify/database";

export default async () => {
  try {
    const db = getDatabase();

    const result = await db.sql`
      SELECT
        current_database() AS database_name,
        NOW() AS server_time
    `;

    return Response.json({
      status: "ok",
      database: "connected",
      database_name: result[0]?.database_name,
      server_time: result[0]?.server_time
    });
  } catch (error) {
    console.error("Database test failed:", error);

    return Response.json(
      {
        status: "error",
        database: "not connected",
        error: error.message
      },
      { status: 500 }
    );
  }
};

export const config = {
  path: "/api/test"
};
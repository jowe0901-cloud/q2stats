import { getDatabase } from "@netlify/database";
import crypto from "node:crypto";

const json = (data, status = 200) =>
  Response.json(data, { status });

export default async (req) => {
  const adminKey = req.headers.get("x-q2stats-admin-key");
  const expectedAdminKey = process.env.Q2STATS_ADMIN_KEY;

  if (!expectedAdminKey || adminKey !== expectedAdminKey) {
    return json(
      { status: "error", error: "Unauthorized" },
      401
    );
  }

  if (req.method !== "POST") {
    return json(
      { status: "error", error: "Method not allowed" },
      405
    );
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return json(
      { status: "error", error: "Invalid JSON" },
      400
    );
  }

  const name = String(body?.name || "").trim();

  if (!name) {
    return json(
      { status: "error", error: "Server name is required" },
      400
    );
  }

  // Generate a secret Q2Stats server key.
  const serverKey = "q2s_" + crypto.randomBytes(32).toString("hex");

  // Only the SHA-256 hash is stored in PostgreSQL.
  const serverKeyHash = crypto
    .createHash("sha256")
    .update(serverKey)
    .digest("hex");

  const db = getDatabase();

  try {
    const result = await db.sql`
      INSERT INTO servers (
        name,
        server_key_hash
      )
      VALUES (
        ${name},
        ${serverKeyHash}
      )
      RETURNING id, name, enabled, created_at
    `;

    return json({
      status: "registered",
      server: result[0],
      api_key: serverKey,
      warning: "Save this API key. Q2Stats stores only its SHA-256 hash."
    });

  } catch (error) {
    console.error("Q2Stats server registration failed:", error);

    return json(
      {
        status: "error",
        error: "Could not register server"
      },
      500
    );
  }
};

export const config = {
  path: "/api/admin/register-server"
};
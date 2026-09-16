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

  const serverId = Number(body?.server_id);

  if (!Number.isInteger(serverId) || serverId <= 0) {
    return json(
      { status: "error", error: "Valid server_id is required" },
      400
    );
  }

  const serverKey = "q2s_" + crypto.randomBytes(32).toString("hex");
  const serverKeyHash = crypto
    .createHash("sha256")
    .update(serverKey)
    .digest("hex");

  const db = getDatabase();

  try {
    const result = await db.sql`
      UPDATE servers
      SET server_key_hash = ${serverKeyHash}
      WHERE id = ${serverId}
      RETURNING id, name, enabled
    `;

    if (result.length === 0) {
      return json(
        { status: "not_found", error: "Server not found" },
        404
      );
    }

    return json({
      status: "key_reset",
      server: result[0],
      api_key: serverKey,
      warning: "Save this API key now. Only its SHA-256 hash is stored."
    });
  } catch (error) {
    console.error("Q2Stats server key reset failed:", error);

    return json(
      { status: "error", error: "Could not reset server key" },
      500
    );
  }
};

export const config = {
  path: "/api/admin/reset-server-key"
};

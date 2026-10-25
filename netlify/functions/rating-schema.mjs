// Automatic, additive schema setup. Existing match data is never modified.
export const SCHEMA_SQL="ALTER TABLE elo_ratings ADD COLUMN IF NOT EXISTS rd DOUBLE PRECISION;\nALTER TABLE elo_ratings ADD COLUMN IF NOT EXISTS rating_period INTEGER;\nALTER TABLE elo_history ADD COLUMN IF NOT EXISTS rd_before DOUBLE PRECISION;\nALTER TABLE elo_history ADD COLUMN IF NOT EXISTS rd_after DOUBLE PRECISION;\nALTER TABLE elo_history ADD COLUMN IF NOT EXISTS performance DOUBLE PRECISION;\nALTER TABLE elo_history ADD COLUMN IF NOT EXISTS contribution_bonus DOUBLE PRECISION;\nALTER TABLE elo_history ADD COLUMN IF NOT EXISTS raw_delta DOUBLE PRECISION;\nALTER TABLE elo_history ADD COLUMN IF NOT EXISTS win_floor_adjustment DOUBLE PRECISION;\nCREATE TABLE IF NOT EXISTS q2stats_rating_state (\n id INTEGER PRIMARY KEY CHECK(id=1),\n active_model TEXT NOT NULL CHECK(active_model IN ('legacy','glicko')),\n updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nINSERT INTO q2stats_rating_state(id,active_model) VALUES(1,'legacy') ON CONFLICT DO NOTHING;\nCREATE TABLE IF NOT EXISTS q2stats_rating_processed (\n model TEXT NOT NULL,match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,\n skipped_reason TEXT,PRIMARY KEY(model,match_id)\n);";
async function ready(client){const result=await client.query("SELECT to_regclass('public.q2stats_rating_state') AS table_name");return Boolean(result.rows[0]?.table_name);}
export async function ensureSchemaWithClient(client){if(!await ready(client))await client.query(SCHEMA_SQL);}
export async function ensureRatingSchema(db){
 const client=await db.pool.connect();let transaction=false;
 try{
  if(await ready(client))return;
  await client.query('BEGIN');transaction=true;
  await client.query('SELECT pg_advisory_xact_lock(62107,2)');
  await ensureSchemaWithClient(client);
  await client.query('COMMIT');transaction=false;
 }catch(e){if(transaction)try{await client.query('ROLLBACK')}catch{}throw e;}finally{client.release();}
}

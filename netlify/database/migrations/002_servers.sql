CREATE TABLE IF NOT EXISTS servers (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    server_key_hash TEXT NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_upload_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_servers_enabled
ON servers(enabled);
CREATE TABLE IF NOT EXISTS q2stats_polls (
 id TEXT PRIMARY KEY,
 is_open BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS q2stats_poll_votes (
 poll_id TEXT NOT NULL REFERENCES q2stats_polls(id),
 voter_id UUID NOT NULL,
 choice SMALLINT NOT NULL CHECK (choice BETWEEN 0 AND 3),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (poll_id, voter_id)
);
INSERT INTO q2stats_polls(id) VALUES ('rating-system-2026-10') ON CONFLICT DO NOTHING;

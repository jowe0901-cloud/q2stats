-- Run once in Netlify PostgreSQL before deploying the updated functions.
CREATE TABLE IF NOT EXISTS opentdm_identity_observations (
  stats_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_match_id TEXT,
  rejected_profile_id BIGINT,
  PRIMARY KEY (stats_id, nickname)
);
CREATE INDEX IF NOT EXISTS opentdm_identity_nickname_idx ON opentdm_identity_observations (nickname);

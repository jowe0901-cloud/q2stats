-- Profile view counters for players with match history but no player_profiles row.
-- Does not create profiles or modify match history, Elo or identities.
CREATE TABLE IF NOT EXISTS player_nickname_views (
  nickname TEXT PRIMARY KEY,
  view_count BIGINT NOT NULL DEFAULT 0 CHECK (view_count >= 0)
);

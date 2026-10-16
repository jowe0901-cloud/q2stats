-- Public profile visit counters; does not modify matches, Elo or player identities.
CREATE TABLE IF NOT EXISTS player_profile_views (
  profile_id BIGINT PRIMARY KEY REFERENCES player_profiles(id) ON DELETE CASCADE,
  view_count BIGINT NOT NULL DEFAULT 0 CHECK (view_count >= 0)
);

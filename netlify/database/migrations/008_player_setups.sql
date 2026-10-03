CREATE TABLE IF NOT EXISTS player_setups (
  profile_id BIGINT PRIMARY KEY REFERENCES player_profiles(id) ON DELETE CASCADE,
  mouse TEXT,
  mousepad TEXT,
  dpi TEXT,
  sensitivity TEXT,
  fov TEXT,
  resolution TEXT,
  refresh_rate TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

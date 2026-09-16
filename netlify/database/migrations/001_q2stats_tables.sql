CREATE TABLE IF NOT EXISTS matches (
    id BIGSERIAL PRIMARY KEY,
    match_id TEXT NOT NULL UNIQUE,
    server TEXT NOT NULL,
    map TEXT NOT NULL,
    game_type TEXT NOT NULL,
    home_score INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    winner TEXT,
    match_type TEXT,
    port INTEGER,
    saved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_players (
    id BIGSERIAL PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    team TEXT NOT NULL,
    frags INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    damage INTEGER NOT NULL DEFAULT 0,
    ping INTEGER NOT NULL DEFAULT 0,
    suicides INTEGER NOT NULL DEFAULT 0,
    teamkills INTEGER NOT NULL DEFAULT 0,
    teleports INTEGER NOT NULL DEFAULT 0,
    damage_received INTEGER NOT NULL DEFAULT 0,
    team_damage INTEGER NOT NULL DEFAULT 0,
    team_damage_received INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_match_players_match_id
ON match_players(match_id);

CREATE INDEX IF NOT EXISTS idx_match_players_name
ON match_players(name);
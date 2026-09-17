-- Q2Stats migration 003
-- Central Elo tables only.
-- Does NOT modify matches or match_players.



CREATE TABLE IF NOT EXISTS elo_ratings (
    id BIGSERIAL PRIMARY KEY,
    player_name TEXT NOT NULL,
    elo_type TEXT NOT NULL CHECK (elo_type IN ('team', '1v1')),
    rating DOUBLE PRECISION NOT NULL DEFAULT 1500,
    matches INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT elo_ratings_player_type_unique
        UNIQUE (player_name, elo_type)
);

CREATE INDEX IF NOT EXISTS idx_elo_ratings_type_rating
    ON elo_ratings (elo_type, rating DESC);

CREATE INDEX IF NOT EXISTS idx_elo_ratings_player
    ON elo_ratings (player_name);

BEGIN;

CREATE TABLE IF NOT EXISTS elo_history (
    id BIGSERIAL PRIMARY KEY,
    match_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    elo_type TEXT NOT NULL CHECK (elo_type IN ('team', '1v1')),
    team TEXT,
    old_elo DOUBLE PRECISION NOT NULL,
    elo_change DOUBLE PRECISION NOT NULL,
    new_elo DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT elo_history_match_player_type_unique
        UNIQUE (match_id, player_name, elo_type)
);

CREATE INDEX IF NOT EXISTS idx_elo_history_player_type
    ON elo_history (player_name, elo_type, id);

CREATE INDEX IF NOT EXISTS idx_elo_history_match
    ON elo_history (match_id);

COMMIT;


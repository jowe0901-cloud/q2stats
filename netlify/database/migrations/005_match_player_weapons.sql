-- Q2Stats migration 005
-- Central per-match weapon statistics.
-- Migrations 003 and 004 remain untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS match_player_weapons (
    id BIGSERIAL PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
    player_name TEXT NOT NULL,
    weapon TEXT NOT NULL,
    accuracy DOUBLE PRECISION,
    kills INTEGER,
    deaths INTEGER,
    dealt INTEGER,
    received INTEGER,
    pick INTEGER,
    miss INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT match_player_weapons_match_player_weapon_unique
        UNIQUE (match_id, player_name, weapon)
);

CREATE INDEX IF NOT EXISTS idx_match_player_weapons_player
    ON match_player_weapons (player_name);

CREATE INDEX IF NOT EXISTS idx_match_player_weapons_match
    ON match_player_weapons (match_id);

CREATE INDEX IF NOT EXISTS idx_match_player_weapons_player_weapon
    ON match_player_weapons (player_name, weapon);

COMMIT;

-- Q2Stats migration 004
-- Add algorithm versioning to the derived Elo tables.
-- Migration 003 remains untouched.

ALTER TABLE elo_ratings
    ADD COLUMN IF NOT EXISTS algorithm_version TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE elo_history
    ADD COLUMN IF NOT EXISTS algorithm_version TEXT NOT NULL DEFAULT 'v1';

-- Replace the old uniqueness rules so several Elo algorithms can coexist.
ALTER TABLE elo_ratings
    DROP CONSTRAINT IF EXISTS elo_ratings_player_type_unique;

ALTER TABLE elo_history
    DROP CONSTRAINT IF EXISTS elo_history_match_player_type_unique;

ALTER TABLE elo_ratings
    ADD CONSTRAINT elo_ratings_player_type_algorithm_unique
    UNIQUE (player_name, elo_type, algorithm_version);

ALTER TABLE elo_history
    ADD CONSTRAINT elo_history_match_player_type_algorithm_unique
    UNIQUE (match_id, player_name, elo_type, algorithm_version);

CREATE INDEX IF NOT EXISTS idx_elo_ratings_algorithm_type_rating
    ON elo_ratings (algorithm_version, elo_type, rating DESC);

CREATE INDEX IF NOT EXISTS idx_elo_history_algorithm_player_type
    ON elo_history (algorithm_version, player_name, elo_type, id);

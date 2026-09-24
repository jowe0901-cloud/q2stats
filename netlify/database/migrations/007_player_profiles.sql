-- Q2Stats migration 007
-- Public player profiles, private aliases and agent identities.
--
-- Important:
--   * Historical match_players.name values are never rewritten.
--   * Linking aliases does NOT merge existing Elo rows.
--   * Elo must be recalculated chronologically after profile links change.
--   * player_id is internal identity data and must not be exposed publicly.

BEGIN;

CREATE TABLE IF NOT EXISTS player_profiles (
    id BIGSERIAL PRIMARY KEY,
    primary_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_profiles_primary_name
    ON player_profiles (primary_name);


CREATE TABLE IF NOT EXISTS player_aliases (
    id BIGSERIAL PRIMARY KEY,
    profile_id BIGINT NOT NULL
        REFERENCES player_profiles(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT player_aliases_nickname_unique
        UNIQUE (nickname)
);

CREATE INDEX IF NOT EXISTS idx_player_aliases_profile_id
    ON player_aliases (profile_id);


CREATE TABLE IF NOT EXISTS player_identities (
    id BIGSERIAL PRIMARY KEY,
    profile_id BIGINT NOT NULL
        REFERENCES player_profiles(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT player_identities_player_id_unique
        UNIQUE (player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_identities_profile_id
    ON player_identities (profile_id);


-- profile_id was introduced in migration 006 without a foreign key.
-- Add the relationship now that player_profiles exists.
ALTER TABLE match_players
    DROP CONSTRAINT IF EXISTS match_players_profile_id_fkey;

ALTER TABLE match_players
    ADD CONSTRAINT match_players_profile_id_fkey
    FOREIGN KEY (profile_id)
    REFERENCES player_profiles(id)
    ON DELETE SET NULL;

COMMIT;

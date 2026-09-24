-- Q2Stats player identity foundation.
--
-- player_id:
--   SHA-256 identity supplied by the Q2Stats agent for new matches.
--
-- profile_id:
--   Internal Q2Stats profile identity.
--   Allows several historical nicknames / player_ids to belong to
--   one public player profile without changing match_players.name.

ALTER TABLE match_players
ADD COLUMN IF NOT EXISTS player_id TEXT;

ALTER TABLE match_players
ADD COLUMN IF NOT EXISTS profile_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_match_players_player_id
ON match_players(player_id);

CREATE INDEX IF NOT EXISTS idx_match_players_profile_id
ON match_players(profile_id);
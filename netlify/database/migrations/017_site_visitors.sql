CREATE TABLE IF NOT EXISTS q2stats_site_visitors (
  visitor_id UUID PRIMARY KEY,
  first_seen DATE NOT NULL,
  last_seen DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS q2stats_site_visitors_last_seen_idx
  ON q2stats_site_visitors(last_seen);
CREATE TABLE IF NOT EXISTS q2stats_visitor_snapshot (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  day DATE NOT NULL,
  today BIGINT NOT NULL,
  total BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

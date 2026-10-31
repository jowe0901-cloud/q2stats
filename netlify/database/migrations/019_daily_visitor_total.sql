CREATE TABLE IF NOT EXISTS q2stats_daily_visitors (
  visitor_id UUID NOT NULL,
  day DATE NOT NULL,
  PRIMARY KEY (visitor_id, day)
);
CREATE INDEX IF NOT EXISTS q2stats_daily_visitors_day_idx ON q2stats_daily_visitors(day);
INSERT INTO q2stats_daily_visitors(visitor_id, day)
  SELECT visitor_id, last_seen FROM q2stats_site_visitors
  ON CONFLICT (visitor_id, day) DO NOTHING;
DELETE FROM q2stats_visitor_snapshot;

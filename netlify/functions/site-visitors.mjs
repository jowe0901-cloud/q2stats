import { getDatabase } from '@netlify/database';

const HISTORICAL_USERS = 2381;
const HISTORICAL_PAGEVIEWS = 10378;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
const dayInSweden = now => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(now);

export function makeHandler(database, clock = () => new Date()) {
  return async request => {
    if (!['GET', 'POST'].includes(request.method)) return reply(405, { error: 'Method not allowed' });
    try {
      const now = clock();
      const day = dayInSweden(now);
      const db = database();
      if (request.method === 'POST') {
        // Accept same-origin JSON registrations only. No IP addresses are stored.
        const origin = request.headers.get('origin');
        if (origin && origin !== new URL(request.url).origin) return reply(403, { error: 'Invalid origin' });
        if (!request.headers.get('content-type')?.startsWith('application/json')) return reply(415, { error: 'JSON required' });
        const raw = await request.text();
        if (raw.length > 200) return reply(413, { error: 'Request too large' });
        let body;
        try { body = JSON.parse(raw); } catch { return reply(400, { error: 'Invalid JSON' }); }
        if (!UUID.test(body?.visitor_id ?? '')) return reply(400, { error: 'Invalid visitor ID' });
        await db.sql`
          INSERT INTO q2stats_site_visitors(visitor_id, first_seen, last_seen)
          VALUES (${body.visitor_id}, ${day}::date, ${day}::date)
          ON CONFLICT (visitor_id) DO UPDATE
          SET last_seen = GREATEST(q2stats_site_visitors.last_seen, EXCLUDED.last_seen)
          WHERE q2stats_site_visitors.last_seen < EXCLUDED.last_seen`;
        await db.sql`
          INSERT INTO q2stats_daily_visitors(visitor_id, day)
          VALUES (${body.visitor_id}, ${day}::date)
          ON CONFLICT (visitor_id, day) DO NOTHING`;
        await db.sql`
          INSERT INTO q2stats_pageviews(day, views) VALUES (${day}::date, 1)
          ON CONFLICT (day) DO UPDATE SET views = q2stats_pageviews.views + 1`;
        return reply(200, { recorded: true });
      }

      // A shared database snapshot prevents per-instance caches from disagreeing.
      // Refresh on the first read after an hour, or after Swedish midnight.
      const cached = await db.sql`SELECT day, today, total, pageviews_today, pageviews_total, updated_at FROM q2stats_visitor_snapshot WHERE id = 1`;
      let row = cached[0];
      if (!row || dayInSweden(new Date(row.updated_at)) !== day || now - new Date(row.updated_at) >= 3600000) {
        const counts = await db.sql`
          SELECT COUNT(*) FILTER (WHERE day = ${day}::date) AS today,
                 COUNT(*) AS total FROM q2stats_daily_visitors`;
        const views = await db.sql`
          SELECT COALESCE(SUM(views) FILTER (WHERE day = ${day}::date), 0) AS today,
                 COALESCE(SUM(views), 0) AS total FROM q2stats_pageviews`;
        const saved = await db.sql`
          INSERT INTO q2stats_visitor_snapshot(id, day, today, total, pageviews_today, pageviews_total, updated_at)
          VALUES (1, ${day}::date, ${counts[0].today}, ${counts[0].total}, ${views[0].today}, ${views[0].total}, ${now.toISOString()}::timestamptz)
          ON CONFLICT (id) DO UPDATE SET
            day = EXCLUDED.day, today = EXCLUDED.today, total = EXCLUDED.total,
            pageviews_today = EXCLUDED.pageviews_today, pageviews_total = EXCLUDED.pageviews_total,
            updated_at = EXCLUDED.updated_at
          WHERE q2stats_visitor_snapshot.updated_at < EXCLUDED.updated_at
          RETURNING day, today, total, pageviews_today, pageviews_total, updated_at`;
        row = saved[0] ?? (await db.sql`SELECT day, today, total, pageviews_today, pageviews_total, updated_at FROM q2stats_visitor_snapshot WHERE id = 1`)[0];
      }
      return reply(200, { today: Number(row.today), total: Number(row.total) + HISTORICAL_USERS, pageviews_today: Number(row.pageviews_today), pageviews_total: Number(row.pageviews_total) + HISTORICAL_PAGEVIEWS });
    } catch (error) {
      console.error('site-visitors:', error.message);
      return reply(503, { error: 'Visitor statistics unavailable' });
    }
  };
}

export default makeHandler(getDatabase);
export const config = { path: '/api/v1/site-visitors' };

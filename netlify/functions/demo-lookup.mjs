// Read-only DE3 demo discovery. Never changes match records or ratings.
const ARCHIVE = 'https://pfl.gr/mvd/de3/';
const SERVER = 'PacketFlinger.com ~ OpenTDM ~ Germany #3';
const FIRST_LOCAL_DAY = '2026-10-09';
const MAX_MATCH_MINUTES = 25;
const respond = (body, statusCode = 200) => ({ statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' }, body: JSON.stringify(body) });

export async function handler(event) {
  const q = event.queryStringParameters || {};
  if (q.server !== SERVER || !/^[a-z0-9_-]{1,40}$/i.test(q.map || '')) return respond({ demo: null });
  const end = Date.parse(q.saved_at || '');
  if (!Number.isFinite(end)) return respond({ demo: null });
  // Compare using Swedish local calendar date, including the Oct 2026 DST change.
  const swedishDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(end));
  if (swedishDate < FIRST_LOCAL_DAY) return respond({ demo: null });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    let html;
    try {
      const r = await fetch(ARCHIVE, { signal: controller.signal, headers: { accept: 'text/html' } });
      if (!r.ok) throw new Error('archive unavailable');
      html = await r.text();
    } finally { clearTimeout(timeout); }

    // The PFDE3 filename date/time is local Swedish time (Europe/Stockholm).
    // Convert local wall-clock time to UTC by testing valid offsets and round-tripping.
    const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const startUtc = (day, clock) => {
      const expected = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)} ${clock.slice(0, 2)}:${clock.slice(2, 4)}`;
      const localAsUtc = Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8), +clock.slice(0, 2), +clock.slice(2, 4), +clock.slice(4, 6));
      return [2, 1].map(h => localAsUtc - h * 3600000).filter(ms => formatter.format(new Date(ms)).replace(',', '') === expected);
    };
    const matches = [];
    const re = /PFDE3_(\d{8})-(\d{6})_([a-z0-9_-]+)\.mvd2/gi;
    for (const hit of html.matchAll(re)) {
      const [filename, day, clock, map] = hit;
      if (day < '20261009' || map.toLowerCase() !== q.map.toLowerCase()) continue;
      for (const start of startUtc(day, clock)) {
        const delta = end - start;
        if (delta >= 0 && delta <= MAX_MATCH_MINUTES * 60000) matches.push({ filename, delta });
      }
    }
    const unique = [...new Map(matches.map(m => [m.filename, m])).values()];
    // No guessing if multiple recordings could correspond to this match.
    return respond({ demo: unique.length === 1 ? ARCHIVE + encodeURIComponent(unique[0].filename) : null });
  } catch {
    return respond({ demo: null });
  }
}

// Read-only DE3 demo discovery. Never changes match records or ratings.
const ARCHIVE = 'https://pfl.gr/mvd/de3/';
const SERVER = 'PacketFlinger.com ~ OpenTDM ~ Germany #3';
const FIRST_LOCAL_DAY = '2026-10-09';
const MAX_MATCH_MINUTES = 25;
const respond = (body, statusCode = 200) => ({ statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(body) });

export async function handler(event) {
  const q = event.queryStringParameters || {};
  if (q.server !== SERVER) return respond({ demo: null, reason: 'server_mismatch' });
  if (!/^[a-z0-9_-]{1,40}$/i.test(q.map || '')) return respond({ demo: null, reason: 'invalid_map' });
  const end = Date.parse(q.saved_at || '');
  if (!Number.isFinite(end)) return respond({ demo: null, reason: 'invalid_saved_at' });
  // Compare using Swedish local calendar date, including the Oct 2026 DST change.
  const swedishDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(end));
  if (swedishDate < FIRST_LOCAL_DAY) return respond({ demo: null, reason: 'before_start_date' });

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
    // Use all maps: the next DE3 recording marks the boundary of the previous one.
    // This is an inferred boundary, not a verified demo end time.
    const recordings = new Map();
    const re = /PFDE3_(\d{8})-(\d{6})_([a-z0-9_-]+)\.mvd2/gi;
    for (const hit of html.matchAll(re)) {
      const [filename, day, clock, map] = hit;
      if (day < '20261009') continue;
      for (const start of startUtc(day, clock)) {
        recordings.set(`${filename}:${start}`, { filename, map: map.toLowerCase(), start });
      }
    }
    const ordered = [...recordings.values()].sort((a, b) => a.start - b.start);
    const candidates = [];
    for (let i = 0; i < ordered.length; i++) {
      const recording = ordered[i];
      if (recording.map !== q.map.toLowerCase()) continue;
      const delta = end - recording.start;
      if (delta < 0 || delta > MAX_MATCH_MINUTES * 60000) continue;
      // If another recording started before this match ended, the earlier
      // recording is not a safe match. Check all maps, not just this map.
      const next = ordered[i + 1];
      if (next && next.start <= end) continue;
      candidates.push({ filename: recording.filename, delta });
    }
    const unique = [...new Map(candidates.map(m => [m.filename, m])).values()];
    return respond({
      demo: unique.length === 1 ? ARCHIVE + encodeURIComponent(unique[0].filename) : null,
      reason: unique.length === 0 ? 'no_match' : unique.length > 1 ? 'multiple_candidates' : 'matched',
      candidates: unique.map(m => ({ filename: m.filename, minutes_before_saved_at: Math.round(m.delta / 6000) / 10 }))
    });
  } catch (error) {
    return respond({ demo: null, reason: 'archive_unavailable' });
  }
}

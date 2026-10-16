import { getDatabase } from '@netlify/database';

const reply = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export default async (request) => {
  if (request.method !== 'GET' && request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  try {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const profileId = body.profile_id ?? url.searchParams.get('profile_id');
    const nickname = String(body.nickname ?? url.searchParams.get('nickname') ?? '').trim();
    const db = getDatabase();

    if (profileId !== null && profileId !== undefined && profileId !== '') {
      const id = Number(profileId);
      if (!Number.isSafeInteger(id) || id < 1) return reply(400, { error: 'Invalid profile_id' });
      const existing = await db.sql`SELECT id FROM player_profiles WHERE id = ${id} LIMIT 1`;
      if (!existing.length) return reply(404, { error: 'Profile not found' });
      if (request.method === 'POST') {
        const rows = await db.sql`
          INSERT INTO player_profile_views (profile_id, view_count)
          VALUES (${id}, 1)
          ON CONFLICT (profile_id)
          DO UPDATE SET view_count = player_profile_views.view_count + 1
          RETURNING view_count`;
        return reply(200, { profile_id: id, views: Number(rows[0].view_count) });
      }
      const rows = await db.sql`SELECT view_count FROM player_profile_views WHERE profile_id = ${id}`;
      return reply(200, { profile_id: id, views: Number(rows[0]?.view_count ?? 0) });
    }

    // Players with recorded matches do not necessarily have a player_profiles entry.
    // Keep a separate nickname counter; do not create or relink any player profiles.
    if (!nickname || nickname.length > 100) return reply(400, { error: 'Valid nickname required' });
    const found = await db.sql`SELECT 1 FROM match_players WHERE name = ${nickname} LIMIT 1`;
    if (!found.length) return reply(404, { error: 'Player not found' });
    if (request.method === 'POST') {
      const rows = await db.sql`
        INSERT INTO player_nickname_views (nickname, view_count)
        VALUES (${nickname}, 1)
        ON CONFLICT (nickname)
        DO UPDATE SET view_count = player_nickname_views.view_count + 1
        RETURNING view_count`;
      return reply(200, { nickname, views: Number(rows[0].view_count) });
    }
    const rows = await db.sql`SELECT view_count FROM player_nickname_views WHERE nickname = ${nickname}`;
    return reply(200, { nickname, views: Number(rows[0]?.view_count ?? 0) });
  } catch (error) {
    console.error('profile-views:', error);
    return reply(500, { error: 'Unable to load profile views' });
  }
};

export const config = { path: '/api/v1/profile-views' };

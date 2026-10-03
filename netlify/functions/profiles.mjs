import { getDatabase } from "@netlify/database";

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=30"
  }
});

const clean = v => String(v ?? "").trim();

const WEAPON_NAMES = {
  blaster: "Blaster",
  shotgun: "Shotgun",
  super_shotgun: "Super Shotgun",
  supershotgun: "Super Shotgun",
  machinegun: "Machinegun",
  chaingun: "Chaingun",
  grenades: "Grenades",
  grenade_launcher: "Grenade Launcher",
  grenadelauncher: "Grenade Launcher",
  rocket_launcher: "Rocket Launcher",
  rocketlauncher: "Rocket Launcher",
  hyperblaster: "HyperBlaster",
  hyper_blaster: "HyperBlaster",
  railgun: "Railgun",
  bfg: "BFG10K",
  bfg10k: "BFG10K"
};

function canonicalWeapon(value) {
  const raw = clean(value);
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  return WEAPON_NAMES[key] ?? raw;
}

function toPlayerRow(row) {
  return {
    name: row.name,
    profile_id: row.profile_id ?? null,
    team: row.team,
    frags: Number(row.frags ?? 0),
    kills: Number(row.frags ?? row.kills ?? 0),
    deaths: Number(row.deaths ?? 0),
    damage: Number(row.damage ?? 0),
    damage_received: Number(row.damage_received ?? 0),
    suicides: Number(row.suicides ?? 0),
    teamkills: Number(row.teamkills ?? 0),
    ping: row.ping ?? null
  };
}

export default async request => {
  if (request.method !== "GET") return json(405, { status: "error", error: "Method not allowed" });
  try {
    const url = new URL(request.url);
    const nickname = clean(url.searchParams.get("nickname"));
    const profileId = clean(url.searchParams.get("profile_id"));
    if (!nickname && !profileId) return json(400, { status: "error", error: "nickname or profile_id is required" });

    const db = getDatabase();
    let profiles;
    if (profileId) {
      profiles = await db.sql`SELECT id, primary_name, created_at, updated_at FROM player_profiles WHERE id = ${profileId} LIMIT 1`;
    } else {
      profiles = await db.sql`
        SELECT DISTINCT p.id, p.primary_name, p.created_at, p.updated_at
        FROM player_profiles p
        JOIN player_aliases a ON a.profile_id = p.id
        WHERE a.nickname = ${nickname}
        LIMIT 1`;
    }
    if (!profiles.length) return json(404, { status: "not_found", error: "Public profile not found" });
    const profile = profiles[0];

    const setupRows = await db.sql`
      SELECT mouse, mousepad, dpi, sensitivity, fov, resolution, refresh_rate, cl_maxfps, headphones
      FROM player_setups
      WHERE profile_id = ${profile.id}
      LIMIT 1`;
    const setup = setupRows[0] ?? null;

    const matchRows = await db.sql`
      SELECT m.id, m.match_id, m.server, m.map, m.game_type,
        m.home_score, m.away_score, m.winner, m.match_type,
        m.port, m.saved_at, m.created_at,
        mp.name, mp.profile_id, mp.team,
        mp.frags, mp.deaths, mp.damage, mp.ping,
        mp.suicides, mp.teamkills, mp.teleports,
        mp.damage_received, mp.team_damage, mp.team_damage_received
      FROM matches m
      JOIN match_players mp ON mp.match_id = m.match_id
      WHERE m.match_id IN (
        SELECT DISTINCT profile_mp.match_id FROM match_players profile_mp
        WHERE profile_mp.profile_id = ${profile.id}
      )
      ORDER BY COALESCE(m.saved_at, m.created_at) DESC, m.id DESC`;

    const grouped = new Map();
    for (const row of matchRows) {
      let match = grouped.get(row.match_id);
      if (!match) {
        match = { id:row.id, match_id:row.match_id, server:row.server, map:row.map,
          game_type:row.game_type, home_score:row.home_score, away_score:row.away_score,
          winner:row.winner, match_type:row.match_type, port:row.port,
          saved_at:row.saved_at, created_at:row.created_at, players:[] };
        grouped.set(row.match_id, match);
      }
      match.players.push(toPlayerRow(row));
    }
    const matches = [...grouped.values()];


    // Aggregate this profile's own rows by game type.
    // matchRows contains every player in the profile's matches, so only count
    // rows that are actually linked to this profile.
    const modeStats = {
      team: { matches: 0, kills: 0, deaths: 0 },
      "1v1": { matches: 0, kills: 0, deaths: 0 }
    };
    const seenModeMatches = { team: new Set(), "1v1": new Set() };

    for (const match of matches) {
      const mode = String(match.game_type || "").toLowerCase() === "1v1" ? "1v1" : "team";
      const ownRows = match.players.filter(p => Number(p.profile_id) === Number(profile.id));
      if (!ownRows.length) continue;

      if (!seenModeMatches[mode].has(match.match_id)) {
        seenModeMatches[mode].add(match.match_id);
        modeStats[mode].matches += 1;
      }
      for (const p of ownRows) {
        modeStats[mode].kills += Number(p.kills ?? p.frags ?? 0);
        modeStats[mode].deaths += Number(p.deaths ?? 0);
      }
    }

    for (const s of Object.values(modeStats)) {
      s.kd = s.deaths > 0 ? s.kills / s.deaths : (s.kills > 0 ? s.kills : 0);
    }

    const weaponRows = await db.sql`
      SELECT w.weapon,
        AVG(w.accuracy) FILTER (WHERE w.accuracy IS NOT NULL) AS avg_accuracy,
        COALESCE(SUM(w.kills), 0)::int AS kills, COUNT(*)::int AS matches
      FROM match_player_weapons w
      JOIN match_players mp ON mp.match_id = w.match_id AND mp.name = w.player_name
      WHERE mp.profile_id = ${profile.id}
      GROUP BY w.weapon
      ORDER BY COALESCE(SUM(w.kills), 0) DESC, w.weapon ASC`;

    const weaponHistoryRows = await db.sql`
      SELECT w.match_id,w.weapon,w.accuracy,w.kills,w.deaths,w.dealt,w.received,w.pick,w.miss,
        COALESCE(m.saved_at, m.created_at) AS played_at
      FROM match_player_weapons w
      JOIN match_players mp ON mp.match_id = w.match_id AND mp.name = w.player_name
      JOIN matches m ON m.match_id = w.match_id
      WHERE mp.profile_id = ${profile.id}
      ORDER BY COALESCE(m.saved_at, m.created_at) ASC, m.id ASC, w.weapon ASC`;

    const byMatch = new Map();
    for (const row of weaponHistoryRows) {
      let item=byMatch.get(row.match_id);
      if(!item){ item={match_id:row.match_id,played_at:row.played_at,weapons:{}}; byMatch.set(row.match_id,item); }

      const weapon = canonicalWeapon(row.weapon);
      const current = item.weapons[weapon] ?? {
        accuracy_sum:0, accuracy_count:0, kills:0, deaths:0,
        dealt:0, received:0, pick:0, miss:0
      };
      if(row.accuracy!=null){ current.accuracy_sum += Number(row.accuracy); current.accuracy_count += 1; }
      current.kills += Number(row.kills || 0);
      current.deaths += Number(row.deaths || 0);
      current.dealt += Number(row.dealt || 0);
      current.received += Number(row.received || 0);
      current.pick += Number(row.pick || 0);
      current.miss += Number(row.miss || 0);
      item.weapons[weapon] = current;
    }

    for (const item of byMatch.values()) {
      for (const [weapon, v] of Object.entries(item.weapons)) {
        item.weapons[weapon] = {
          accuracy: v.accuracy_count ? v.accuracy_sum / v.accuracy_count : null,
          kills: v.kills, deaths: v.deaths, dealt: v.dealt,
          received: v.received, pick: v.pick, miss: v.miss
        };
      }
    }

    const weaponMap = new Map();
    for (const row of weaponRows) {
      const weapon = canonicalWeapon(row.weapon);
      let w = weaponMap.get(weapon);
      if (!w) {
        w = { weapon, kills:0, matches:0, weightedAccuracy:0, accuracyWeight:0 };
        weaponMap.set(weapon, w);
      }
      const matchesCount = Number(row.matches || 0);
      w.kills += Number(row.kills || 0);
      w.matches += matchesCount;
      if (row.avg_accuracy != null && matchesCount > 0) {
        w.weightedAccuracy += Number(row.avg_accuracy) * matchesCount;
        w.accuracyWeight += matchesCount;
      }
    }

    const weaponSummary = [...weaponMap.values()]
      .map(w => {
        const accuracy = w.accuracyWeight ? w.weightedAccuracy / w.accuracyWeight : null;
        return { w:w.weapon, weapon:w.weapon, acc:accuracy, accuracy, kills:w.kills, matches:w.matches };
      })
      .sort((a,b) => b.kills - a.kills || a.weapon.localeCompare(b.weapon));

    return json(200,{status:"ok",profile,setup,total_matches:matches.length,matches,mode_stats:modeStats,
      weapons:{summary:weaponSummary,history:[...byMatch.values()]}});
  } catch(error) {
    console.error("Q2Stats public profile failed:",error);
    return json(500,{status:"error",error:error.message||"Internal server error"});
  }
};
export const config={path:"/api/v1/profiles"};

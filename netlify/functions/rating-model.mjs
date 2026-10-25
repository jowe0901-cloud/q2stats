import {ensureRatingSchema} from "./rating-schema.mjs";
import {VERSION,DUEL_VERSION} from './elo-engine.mjs';
export function versionsFor(model){return model==='glicko'?{team:VERSION,'1v1':DUEL_VERSION}:{team:'v2-team-perf','1v1':'v1'};}
export async function getRatingVersions(db){await ensureRatingSchema(db);const rows=await db.sql`SELECT active_model FROM q2stats_rating_state WHERE id=1`;const model=rows[0]?.active_model||'legacy';return {...versionsFor(model),model};}

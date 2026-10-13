import { getDatabase } from "@netlify/database";
const respond=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
const clean=v=>String(v??"").trim();
export default async function(request){
 const key=request.headers.get("x-q2stats-admin-key");
 if(!process.env.Q2STATS_ADMIN_KEY||key!==process.env.Q2STATS_ADMIN_KEY)return respond({error:"Unauthorized"},401);
 const db=getDatabase();
 try{
  if(request.method==="GET"){
   const rows=await db.sql`
    SELECT o.stats_id,o.nickname,o.last_seen,o.last_match_id,
           p.id AS suggested_profile_id,p.primary_name AS suggested_main,
           a.profile_id AS nickname_profile_id
    FROM opentdm_identity_observations o
    JOIN player_aliases known ON known.nickname<>o.nickname
    JOIN player_profiles p ON p.id=known.profile_id
    JOIN opentdm_identity_observations k ON k.stats_id=o.stats_id AND k.nickname=known.nickname
    LEFT JOIN player_aliases a ON a.nickname=o.nickname
    WHERE a.profile_id IS NULL AND (o.rejected_profile_id IS NULL OR o.rejected_profile_id<>p.id)
      AND NOT EXISTS (
        SELECT 1 FROM opentdm_identity_observations z
        JOIN player_aliases az ON az.nickname=z.nickname
        WHERE z.stats_id=o.stats_id AND az.profile_id<>p.id
      )
    GROUP BY o.stats_id,o.nickname,o.last_seen,o.last_match_id,p.id,p.primary_name,a.profile_id
    ORDER BY o.last_seen DESC LIMIT 200
   `;
   return respond({status:"ok",pending:rows});
  }
  if(request.method!=="POST")return respond({error:"Method not allowed"},405);
  const body=await request.json();
  const nickname=clean(body.nickname),statsId=clean(body.stats_id),profileId=Number(body.profile_id);
  if(!["approve","reject"].includes(body.action)||!nickname||!statsId||!Number.isSafeInteger(profileId)||profileId<1)return respond({error:"Invalid request"},400);
  const client=await db.pool.connect();
  try{
   await client.query("BEGIN");
   const observed=await client.query('SELECT 1 FROM opentdm_identity_observations WHERE stats_id=$1 AND nickname=$2 FOR UPDATE',[statsId,nickname]);
   if(!observed.rowCount)throw Error("Identity observation not found");
   const known=await client.query(`SELECT 1 FROM opentdm_identity_observations o JOIN player_aliases a ON a.nickname=o.nickname WHERE o.stats_id=$1 AND a.profile_id=$2 AND o.nickname<>$3 LIMIT 1`,[statsId,profileId,nickname]);
   if(!known.rowCount)throw Error("Suggested identity is no longer linked to this profile");
   const conflicts=await client.query(`SELECT 1 FROM opentdm_identity_observations o JOIN player_aliases a ON a.nickname=o.nickname WHERE o.stats_id=$1 AND a.profile_id<>$2 LIMIT 1`,[statsId,profileId]);
   if(conflicts.rowCount)throw Error("Conflicting profiles for this stats_id; resolve manually");
   if(body.action==="reject"){
    await client.query('UPDATE opentdm_identity_observations SET rejected_profile_id=$1 WHERE stats_id=$2 AND nickname=$3',[profileId,statsId,nickname]);
    await client.query("COMMIT");return respond({status:"rejected"});
   }
   const alias=await client.query('SELECT profile_id FROM player_aliases WHERE nickname=$1 FOR UPDATE',[nickname]);
   if(alias.rowCount)throw Error("Nickname already belongs to a profile");
   const rows=await client.query('SELECT 1 FROM match_players WHERE name=$1 AND profile_id IS NOT NULL AND profile_id<>$2 LIMIT 1',[nickname,profileId]);
   if(rows.rowCount)throw Error("Nickname has matches assigned to another profile");
   await client.query('INSERT INTO player_aliases(profile_id,nickname) VALUES($1,$2)',[profileId,nickname]);
   const linked=await client.query('UPDATE match_players SET profile_id=$1 WHERE name=$2 AND profile_id IS NULL RETURNING player_id',[profileId,nickname]);
   for(const playerId of new Set(linked.rows.map(r=>clean(r.player_id)).filter(Boolean))){
    await client.query('INSERT INTO player_identities(profile_id,player_id) VALUES($1,$2) ON CONFLICT(player_id) DO NOTHING',[profileId,playerId]);
   }
   await client.query('UPDATE player_profiles SET updated_at=NOW() WHERE id=$1',[profileId]);
   await client.query("COMMIT");
   return respond({status:"approved",linked_matches:linked.rowCount,elo_rebuild_required:true});
  }catch(e){await client.query('ROLLBACK');return respond({error:e.message},409)}finally{client.release()}
 }catch(e){console.error("OpenTDM admin identity error",e);return respond({error:"Identity service unavailable"},500)}
}
export const config={path:"/api/admin/opentdm-identities"};

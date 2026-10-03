import { getDatabase } from "@netlify/database";

const json=(data,status=200)=>Response.json(data,{status,headers:{"cache-control":"no-store"}});
const clean=v=>{const s=String(v??"").trim();return s||null};

export default async req=>{
  const adminKey=req.headers.get("x-q2stats-admin-key");
  if(!process.env.Q2STATS_ADMIN_KEY||adminKey!==process.env.Q2STATS_ADMIN_KEY)
    return json({status:"error",error:"Unauthorized"},401);

  const db=getDatabase();
  try{
    const url=new URL(req.url);
    if(req.method==="GET"){
      const profileId=String(url.searchParams.get("profile_id")||"").trim();
      if(!profileId)return json({status:"error",error:"profile_id is required"},400);
      const rows=await db.sql`SELECT profile_id,mouse,mousepad,dpi,sensitivity,fov,resolution,refresh_rate,updated_at
        FROM player_setups WHERE profile_id=${profileId} LIMIT 1`;
      return json({status:"ok",setup:rows[0]??null});
    }
    if(req.method!=="POST")return json({status:"error",error:"Method not allowed"},405);
    const body=await req.json();
    const profileId=String(body?.profile_id??"").trim();
    if(!profileId)return json({status:"error",error:"profile_id is required"},400);

    const existing=await db.sql`SELECT id FROM player_profiles WHERE id=${profileId} LIMIT 1`;
    if(!existing.length)return json({status:"error",error:"Profile not found"},404);

    const mouse=clean(body.mouse),mousepad=clean(body.mousepad),dpi=clean(body.dpi),
      sensitivity=clean(body.sensitivity),fov=clean(body.fov),resolution=clean(body.resolution),
      refreshRate=clean(body.refresh_rate);

    const rows=await db.sql`
      INSERT INTO player_setups(profile_id,mouse,mousepad,dpi,sensitivity,fov,resolution,refresh_rate,updated_at)
      VALUES(${profileId},${mouse},${mousepad},${dpi},${sensitivity},${fov},${resolution},${refreshRate},NOW())
      ON CONFLICT(profile_id) DO UPDATE SET
        mouse=EXCLUDED.mouse,mousepad=EXCLUDED.mousepad,dpi=EXCLUDED.dpi,
        sensitivity=EXCLUDED.sensitivity,fov=EXCLUDED.fov,resolution=EXCLUDED.resolution,
        refresh_rate=EXCLUDED.refresh_rate,updated_at=NOW()
      RETURNING profile_id,mouse,mousepad,dpi,sensitivity,fov,resolution,refresh_rate,updated_at`;
    return json({status:"ok",setup:rows[0]});
  }catch(error){
    console.error("Q2Stats admin player setup failed:",error);
    return json({status:"error",error:error.message||"Internal server error"},500);
  }
};
export const config={path:"/api/admin/player-setup"};

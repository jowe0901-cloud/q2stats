import { getDatabase } from "@netlify/database";

const json=(status,body)=>new Response(JSON.stringify(body),{
 status,
 headers:{
  "content-type":"application/json; charset=utf-8",
  "cache-control":"public, max-age=30"
 }
});

function normalizeWeaponName(weapon){
 const key=String(weapon||"").trim().toLowerCase();

 const names={
  "railgun":"Railgun",
  "rocket_launcher":"Rocket Launcher",
  "rocket launcher":"Rocket Launcher",
  "super_shotgun":"Super Shotgun",
  "super shotgun":"Super Shotgun",
  "grenade_launcher":"Grenade Launcher",
  "grenade launcher":"Grenade Launcher",
  "hyperblaster":"HyperBlaster",
  "chaingun":"Chaingun",
  "machinegun":"Machinegun",
  "blaster":"Blaster"
 };

 return names[key]||weapon;
}

export default async(request)=>{
 if(request.method!=="GET")
  return json(405,{status:"error",error:"Method not allowed"});

 try{
  const url=new URL(request.url);
  const player=(url.searchParams.get("player")||"").trim();

  if(!player)
   return json(400,{status:"error",error:"player is required"});

  const db=getDatabase();

  /*
   * Read the raw weapon rows.
   * Weapon names are normalized in JS so old and new naming
   * conventions are treated as the same weapon.
   */
  const rows=await db.sql`
   SELECT
    w.match_id,
    w.weapon,
    w.accuracy,
    w.kills,
    w.deaths,
    w.dealt,
    w.received,
    w.pick,
    w.miss,
    COALESCE(m.saved_at,m.created_at) AS played_at,
    m.id AS match_db_id
   FROM match_player_weapons w
   JOIN matches m ON m.match_id=w.match_id
   WHERE w.player_name=${player}
   ORDER BY COALESCE(m.saved_at,m.created_at) ASC,m.id ASC,w.weapon ASC
  `;

  /*
   * Build normalized summary.
   */
  const summaryMap=new Map();

  for(const r of rows){
   const weapon=normalizeWeaponName(r.weapon);

   let item=summaryMap.get(weapon);

   if(!item){
    item={
     weapon,
     accSum:0,
     accCount:0,
     kills:0,
     matches:new Set()
    };

    summaryMap.set(weapon,item);
   }

   if(r.accuracy!==null && r.accuracy!==undefined){
    const acc=Number(r.accuracy);

    if(Number.isFinite(acc)){
     item.accSum+=acc;
     item.accCount++;
    }
   }

   item.kills+=Number(r.kills||0);
   item.matches.add(r.match_id);
  }

  const summary=[...summaryMap.values()]
   .map(x=>({
    weapon:x.weapon,
    accuracy:x.accCount ? x.accSum/x.accCount : null,
    kills:x.kills,
    matches:x.matches.size
   }))
   .sort((a,b)=>b.kills-a.kills || a.weapon.localeCompare(b.weapon));

  /*
   * Build normalized weapon history.
   */
  const byMatch=new Map();

  for(const r of rows){
   const weapon=normalizeWeaponName(r.weapon);

   let item=byMatch.get(r.match_id);

   if(!item){
    item={
     match_id:r.match_id,
     played_at:r.played_at,
     weapons:{}
    };

    byMatch.set(r.match_id,item);
   }

   item.weapons[weapon]={
    accuracy:r.accuracy==null?null:Number(r.accuracy),
    kills:r.kills==null?null:Number(r.kills),
    deaths:r.deaths==null?null:Number(r.deaths),
    dealt:r.dealt==null?null:Number(r.dealt),
    received:r.received==null?null:Number(r.received),
    pick:r.pick==null?null:Number(r.pick),
    miss:r.miss==null?null:Number(r.miss)
   };
  }

  return json(200,{
   status:"ok",
   player,
   summary,
   history:[...byMatch.values()]
  });

 }catch(error){
  console.error(error);

  return json(500,{
   status:"error",
   error:error.message||"Internal server error"
  });
 }
};

export const config={path:"/api/v1/weapons"};
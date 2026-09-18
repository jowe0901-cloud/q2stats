import { getDatabase } from "@netlify/database";

const json=(status,body)=>new Response(JSON.stringify(body),{
 status,
 headers:{
  "content-type":"application/json; charset=utf-8",
  "cache-control":"public, max-age=30"
 }
});

export default async(request)=>{
 if(request.method!=="GET")return json(405,{status:"error",error:"Method not allowed"});
 try{
  const url=new URL(request.url);
  const player=(url.searchParams.get("player")||"").trim();
  if(!player)return json(400,{status:"error",error:"player is required"});

  const db=getDatabase();

  const summaryRows=await db.sql`
   SELECT
    weapon,
    AVG(accuracy) FILTER (WHERE accuracy IS NOT NULL) AS avg_accuracy,
    COALESCE(SUM(kills),0)::int AS kills,
    COUNT(*)::int AS matches
   FROM match_player_weapons
   WHERE player_name=${player}
   GROUP BY weapon
   ORDER BY COALESCE(SUM(kills),0) DESC, weapon ASC
  `;

  const historyRows=await db.sql`
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
    COALESCE(m.saved_at,m.created_at) AS played_at
   FROM match_player_weapons w
   JOIN matches m ON m.match_id=w.match_id
   WHERE w.player_name=${player}
   ORDER BY COALESCE(m.saved_at,m.created_at) ASC,m.id ASC,w.weapon ASC
  `;

  const byMatch=new Map();
  for(const r of historyRows){
   let item=byMatch.get(r.match_id);
   if(!item){
    item={match_id:r.match_id,played_at:r.played_at,weapons:{}};
    byMatch.set(r.match_id,item);
   }
   item.weapons[r.weapon]={
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
   summary:summaryRows.map(r=>({
    weapon:r.weapon,
    accuracy:r.avg_accuracy==null?null:Number(r.avg_accuracy),
    kills:Number(r.kills||0),
    matches:Number(r.matches||0)
   })),
   history:[...byMatch.values()]
  });
 }catch(error){
  console.error(error);
  return json(500,{status:"error",error:error.message||"Internal server error"});
 }
};

export const config={path:"/api/v1/weapons"};

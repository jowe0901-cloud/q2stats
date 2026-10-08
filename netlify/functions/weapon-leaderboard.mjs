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
    "chaingun":"Chaingun"
  };
  return names[key]||weapon;
}

const WANTED_WEAPONS=new Set(["Railgun","Rocket Launcher","Chaingun"]);
const MIN_MATCHES=10;
const MIN_KILLS=100;

export default async(request)=>{
  if(request.method!=="GET")
    return json(405,{status:"error",error:"Method not allowed"});

  try{
    const db=getDatabase();

    // Resolve every weapon row through the matching historical player row.
    // Linked nicknames share profile_id and are displayed as primary_name.
    // Unlinked nicknames remain separate exactly as before.
    const rows=await db.sql`
      SELECT
        w.match_id,
        w.player_name,
        w.weapon,
        w.accuracy,
        w.kills,
        w.deaths,
        w.dealt,
        w.received,
        w.pick,
        w.miss,
        mp.profile_id,
        pp.primary_name
      FROM match_player_weapons w
      LEFT JOIN match_players mp
        ON mp.match_id=w.match_id
       AND mp.name=w.player_name
      LEFT JOIN player_profiles pp
        ON pp.id=mp.profile_id
    `;

    const grouped=new Map();

    for(const r of rows){
      const weapon=normalizeWeaponName(r.weapon);
      if(!WANTED_WEAPONS.has(weapon))continue;

      const profileId=r.profile_id==null?null:String(r.profile_id);
      const player=profileId && r.primary_name
        ? String(r.primary_name)
        : String(r.player_name||"");
      if(!player)continue;

      const playerKey=profileId
        ? `profile:${profileId}`
        : `nick:${player}`;
      const key=`${weapon}\u0000${playerKey}`;

      let x=grouped.get(key);
      if(!x){
        x={
          player,
          weapon,
          matches:new Set(),
          kills:0,
          deaths:0,
          dealt:0,
          received:0,
          pick:0,
          miss:0,
          accSum:0,
          accCount:0
        };
        grouped.set(key,x);
      }

      x.matches.add(String(r.match_id));
      x.kills+=Number(r.kills||0);
      x.deaths+=Number(r.deaths||0);
      x.dealt+=Number(r.dealt||0);
      x.received+=Number(r.received||0);
      x.pick+=Number(r.pick||0);
      x.miss+=Number(r.miss||0);

      if(r.accuracy!==null && r.accuracy!==undefined){
        const acc=Number(r.accuracy);
        if(Number.isFinite(acc)){
          x.accSum+=acc;
          x.accCount++;
        }
      }
    }

    const weapons={};
    for(const weapon of WANTED_WEAPONS){
      const all_players=[...grouped.values()]
        .filter(x=>x.weapon===weapon)
        .map(x=>{
          const matches=x.matches.size;
          const accuracy=x.accCount?x.accSum/x.accCount:null;
          const qualified=matches>=MIN_MATCHES && x.kills>=MIN_KILLS;
          return {
            player:x.player,
            matches,
            kills:x.kills,
            deaths:x.deaths,
            dealt:x.dealt,
            received:x.received,
            pick:x.pick,
            miss:x.miss,
            accuracy:accuracy==null?null:Math.round(accuracy*10)/10,
            qualified
          };
        })
        .sort((a,b)=>
          Number(b.accuracy??-Infinity)-Number(a.accuracy??-Infinity) ||
          b.kills-a.kills ||
          a.player.localeCompare(b.player)
        );

      weapons[weapon]={
        top5:all_players.filter(x=>x.qualified).slice(0,5),
        all_players
      };
    }

    return json(200,{
      status:"ok",
      qualification:{
        minimum_matches:MIN_MATCHES,
        minimum_kills:MIN_KILLS
      },
      weapons
    });
  }catch(error){
    console.error(error);
    return json(500,{status:"error",error:error.message||"Internal server error"});
  }
};

export const config={path:"/api/v1/weapon-leaderboard"};

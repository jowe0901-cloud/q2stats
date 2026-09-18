import { getDatabase } from "@netlify/database";

const VERSION = "v1";
const START_ELO = 1500;
const K_1V1 = 32;
const K_TEAM = 16;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {"content-type":"application/json; charset=utf-8"}
  });

const n = (v, d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
const team = v => String(v||"").toLowerCase()==="home" ? "Home" :
                  String(v||"").toLowerCase()==="away" ? "Away" : "Unknown";

function expected(a,b){ return 1/(1+10**((b-a)/400)); }
function percentile(values){
  if(!values.length) return [];
  if(values.length===1) return [100];
  return values.map(v => values.filter(x=>x<v).length/(values.length-1)*100);
}
function perf(players){
  const kd=players.map(p=>n(p.deaths)>0?n(p.frags)/n(p.deaths):n(p.frags));
  const diff=players.map(p=>n(p.frags)-n(p.deaths));
  const dmg=players.map(p=>n(p.damage)-n(p.damage_received));
  const a=percentile(diff), b=percentile(kd), c=percentile(dmg);
  return players.map((p,i)=>{
    let discipline=100-n(p.suicides)*15-n(p.teamkills)*10-(n(p.team_damage)/100)*2;
    discipline=Math.max(0,Math.min(100,discipline));
    return Math.round((a[i]*.40+b[i]*.25+c[i]*.25+discipline*.10)*100)/100;
  });
}
function teamChange(base,p,won,scoreDiff){
  let ch=base+(p-50)*(won?.25:.34);
  if(!won && p>=80 && scoreDiff<=5) ch+=1;
  return won ? Math.max(0,Math.min(16,ch)) : Math.max(-16,Math.min(7,ch));
}
function normalizePlayers(rows){
  const seen=new Set(), active=[], unknown=[];
  for(const r of rows){
    const name=String(r.name||"").trim();
    if(!name||seen.has(name)) continue;
    seen.add(name);
    const p={...r,name,team:team(r.team)};
    (p.team==="Home"||p.team==="Away"?active:unknown).push(p);
  }
  const hasH=active.some(p=>p.team==="Home"), hasA=active.some(p=>p.team==="Away");
  if(hasH&&!hasA) unknown.forEach(p=>{p.team="Away";active.push(p)});
  else if(hasA&&!hasH) unknown.forEach(p=>{p.team="Home";active.push(p)});
  return active;
}
function winner(m){
  const w=team(m.winner);
  if(w!=="Unknown") return w;
  if(n(m.home_score)>n(m.away_score)) return "Home";
  if(n(m.away_score)>n(m.home_score)) return "Away";
  return null;
}

export default async (request) => {
  if(request.method!=="POST") return json(405,{status:"error",error:"Method not allowed"});
  const admin=request.headers.get("x-q2stats-admin-key");
  if(!admin || admin!==process.env.Q2STATS_ADMIN_KEY)
    return json(401,{status:"error",error:"Unauthorized"});

  const db=getDatabase();
  const client=await db.pool.connect();
  try{
    const mr=await client.query(`
      SELECT id,match_id,home_score,away_score,winner,saved_at,created_at
      FROM matches
      ORDER BY COALESCE(saved_at,created_at) ASC,id ASC
    `);
    const pr=await client.query(`
      SELECT match_id,name,team,frags,deaths,damage,suicides,teamkills,
             damage_received,team_damage
      FROM match_players ORDER BY id ASC
    `);
    const by=new Map();
    for(const p of pr.rows){
      if(!by.has(p.match_id)) by.set(p.match_id,[]);
      by.get(p.match_id).push(p);
    }

    const ratings={team:new Map(), "1v1":new Map()};
    const history=[];
    let skipped=0, used=0;
    const get=(type,name)=>{
      if(!ratings[type].has(name)) ratings[type].set(name,{rating:START_ELO,matches:0,wins:0,losses:0});
      return ratings[type].get(name);
    };

    for(const m of mr.rows){
      const ps=normalizePlayers(by.get(m.match_id)||[]);
      const home=ps.filter(p=>p.team==="Home"), away=ps.filter(p=>p.team==="Away");
      const win=winner(m);
      if(!home.length||!away.length||!win){ skipped++; continue; }

      const type=(ps.length===2&&home.length===1&&away.length===1)?"1v1":"team";
      if(type==="1v1"){
        const hp=get(type,home[0].name), ap=get(type,away[0].name);
        const eh=expected(hp.rating,ap.rating);
        const hs=win==="Home"?1:0;
        const dh=K_1V1*(hs-eh), da=-dh;
        for(const [p,r,d,won] of [[home[0],hp,dh,win==="Home"],[away[0],ap,da,win==="Away"]]){
          const old=r.rating; r.rating+=d; r.matches++; won?r.wins++:r.losses++;
          history.push([m.match_id,p.name,type,p.team,old,d,r.rating]);
        }
      } else {
        const havg=home.reduce((s,p)=>s+get(type,p.name).rating,0)/home.length;
        const aavg=away.reduce((s,p)=>s+get(type,p.name).rating,0)/away.length;
        const eh=expected(havg,aavg), hs=win==="Home"?1:0;
        const baseH=K_TEAM*(hs-eh), baseA=-baseH;
        const pv=perf(ps), pm=new Map(ps.map((p,i)=>[p.name,pv[i]]));
        const scoreDiff=Math.abs(n(m.home_score)-n(m.away_score));
        for(const p of ps){
          const r=get(type,p.name), won=p.team===win;
          const base=p.team==="Home"?baseH:baseA;
          const d=teamChange(base,pm.get(p.name),won,scoreDiff);
          const old=r.rating; r.rating+=d; r.matches++; won?r.wins++:r.losses++;
          history.push([m.match_id,p.name,type,p.team,old,d,r.rating]);
        }
      }
      used++;
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM elo_history WHERE algorithm_version=$1",[VERSION]);
    await client.query("DELETE FROM elo_ratings WHERE algorithm_version=$1",[VERSION]);

    for(const [type,map] of Object.entries(ratings)){
      for(const [name,r] of map){
        await client.query(
          `INSERT INTO elo_ratings
           (player_name,elo_type,rating,matches,wins,losses,algorithm_version,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,NOW())`,
          [name,type,r.rating,r.matches,r.wins,r.losses,VERSION]
        );
      }
    }
    for(const h of history){
      await client.query(
        `INSERT INTO elo_history
         (match_id,player_name,elo_type,team,old_elo,elo_change,new_elo,algorithm_version)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [...h,VERSION]
      );
    }
    await client.query("COMMIT");

    return json(200,{
      status:"ok",algorithm_version:VERSION,
      matches_read:mr.rows.length,matches_used:used,skipped,
      ratings_written:[...ratings.team.size?[ratings.team.size]:[]].reduce((a,b)=>a+b,0)+ratings["1v1"].size,
      team_players:ratings.team.size,one_v_one_players:ratings["1v1"].size,
      history_written:history.length
    });
  }catch(e){
    try{await client.query("ROLLBACK")}catch{}
    console.error(e);
    return json(500,{status:"error",error:String(e?.message||e)});
  }finally{ client.release(); }
};

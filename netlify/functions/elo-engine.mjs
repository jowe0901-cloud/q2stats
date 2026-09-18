const VERSION = "v1";
const START_ELO = 1500;
const K_1V1 = 32;
const K_TEAM = 16;

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

export { VERSION, START_ELO, normalizePlayers, winner };

export function calculateMatchElo(match, rows, getRating){
  const ps=normalizePlayers(rows||[]);
  const home=ps.filter(p=>p.team==="Home"), away=ps.filter(p=>p.team==="Away");
  const win=winner(match);
  if(!home.length||!away.length||!win) return null;

  const type=(ps.length===2&&home.length===1&&away.length===1)?"1v1":"team";
  const changes=[];

  if(type==="1v1"){
    const hp=getRating(type,home[0].name), ap=getRating(type,away[0].name);
    const eh=expected(hp.rating,ap.rating);
    const hs=win==="Home"?1:0;
    const dh=K_1V1*(hs-eh), da=-dh;
    for(const [p,r,d,won] of [[home[0],hp,dh,win==="Home"],[away[0],ap,da,win==="Away"]]){
      const old=r.rating; r.rating+=d; r.matches++; won?r.wins++:r.losses++;
      changes.push([match.match_id,p.name,type,p.team,old,d,r.rating]);
    }
  } else {
    const havg=home.reduce((s,p)=>s+getRating(type,p.name).rating,0)/home.length;
    const aavg=away.reduce((s,p)=>s+getRating(type,p.name).rating,0)/away.length;
    const eh=expected(havg,aavg), hs=win==="Home"?1:0;
    const baseH=K_TEAM*(hs-eh), baseA=-baseH;
    const pv=perf(ps), pm=new Map(ps.map((p,i)=>[p.name,pv[i]]));
    const scoreDiff=Math.abs(n(match.home_score)-n(match.away_score));
    for(const p of ps){
      const r=getRating(type,p.name), won=p.team===win;
      const base=p.team==="Home"?baseH:baseA;
      const d=teamChange(base,pm.get(p.name),won,scoreDiff);
      const old=r.rating; r.rating+=d; r.matches++; won?r.wins++:r.losses++;
      changes.push([match.match_id,p.name,type,p.team,old,d,r.rating]);
    }
  }
  return {type,changes};
}

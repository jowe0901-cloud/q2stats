import {Glicko} from './glicko-core.mjs';
export const VERSION='glicko1-team-share50-win2-rd100-notime-v2';
export const DUEL_VERSION='glicko1-duel-q3_5-rd100-notime-v3';
export const START_ELO=1500, START_RD=100;
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const n=v=>Number(v);
const team=v=>String(v||'').toLowerCase()==='home'?'Home':String(v||'').toLowerCase()==='away'?'Away':null;
export function normalizePlayers(rows){return rows.filter(p=>team(p.team)).map(p=>({...p,name:String(p.name||'').trim(),team:team(p.team)}));}
export function winner(m){if(n(m.home_score)===n(m.away_score))return null;return team(m.winner)||(n(m.home_score)>n(m.away_score)?'Home':'Away');}
export function newRating(){return {rating:START_ELO,rd:START_RD,period:null,matches:0,wins:0,losses:0};}
export function matchType(m,ps){const gt=String(m.game_type||'').toLowerCase();return gt==='team'?'team':['1v1','duel'].includes(gt)?'1v1':ps.length===2?'1v1':'team';}
export function calculateMatchElo(m,rows,getRating){
 const all=normalizePlayers(rows||[]);
 if(all.some(p=>!p.name)||new Set(all.map(p=>p.name)).size!==all.length)return {skipped:'duplicate_or_empty_rating_identity'};
 if(!finite(m.home_score)||!finite(m.away_score))return {skipped:'invalid_scores'};
 const type=matchType(m,all),win=winner(m);
 const date=new Date(m.saved_at||m.created_at);if(!Number.isFinite(date.getTime()))return {skipped:'missing_match_date'};
 if(type==='1v1'&&(all.length!==2||!all.some(p=>p.team==='Home')||!all.some(p=>p.team==='Away')))return {skipped:'invalid_duel_teams'};
 if(type==='1v1'&&!win)return {skipped:'drawn_duel_not_supported_by_source_model'};
 const totals=new Map();
 for(const p of all){if(type==='team'&&!['frags','deaths','damage','damage_received'].every(k=>finite(p[k])))return {skipped:'missing_performance_data'};const t=totals.get(p.team)||{damage:0,count:0};t.damage+=n(p.damage)||0;t.count++;totals.set(p.team,t);}
 const ps=type==='1v1'?all:all.filter(p=>n(p.damage)>100&&n(p.damage_received)/n(p.damage)<10);
 if(ps.length<(type==='team'?4:2)||!ps.some(p=>p.team==='Home')||!ps.some(p=>p.team==='Away'))return {skipped:'insufficient_eligible_players'};
 const period=Math.floor(date.getTime()/86400000),g=new Glicko({rating:START_ELO,rd:START_RD,c:0,qFactor:type==='1v1'?3.5:1});
 g.setPeriod(period);
 const records=ps.map(p=>{
  const r=getRating(type,p.name),old={...r},gp=g.makePlayer(r.rating,r.rd??START_RD,r.period??period);
  let performance=win===p.team?1:0,bonus=0;
  if(type==='team'){const t=totals.get(p.team);bonus=t.damage>0?50*n(p.damage)/t.damage:0;performance=5*(n(p.frags)-n(p.deaths))+.04*(n(p.damage)-n(p.damage_received))+.03*n(p.damage)+bonus;}
  return {p,r,old,gp,performance,bonus};
 });
 for(let i=0;i<records.length;i++)for(let j=i+1;j<records.length;j++){
  const a=records[i],b=records[j];if(a.p.team===b.p.team)continue;
  const x=a.performance,y=b.performance,draw=type==='team'&&x!==0&&y!==0&&Math.abs(x/y)<=1.05&&Math.abs(y/x)<=1.05;
  g.addResult(a.gp,b.gp,draw?.5:x>y?1:0);
 }
 g.calculatePlayersRatings();
 const changes=records.map(({p,r,old,gp,performance,bonus})=>{
  const raw=gp.getRating()-old.rating,d=type==='team'&&p.team===win?Math.max(2,raw):raw;
  Object.assign(r,{rating:old.rating+d,rd:gp.getRd(),period,matches:old.matches+1,wins:old.wins+(p.team===win?1:0),losses:old.losses+(win&&p.team!==win?1:0)});
  return [m.match_id,p.name,type,p.team,old.rating,d,r.rating,{rd_before:old.rd??START_RD,rd_after:r.rd,performance,contribution_bonus:bonus,raw_delta:raw,win_floor_adjustment:d-raw}];
 });
 return {type,changes};
}

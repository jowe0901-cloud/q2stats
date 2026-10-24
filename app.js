// Performance: allow browser/CDN HTTP caching; skip legacy full match archive when a profile is available.
const DATA_BASE = location.hostname === "localhost" ? "../" : "";
const DATA_FILES={
    matches: DATA_BASE + "matches.json",
    teamElo: DATA_BASE + "elo_team.json",
    oneElo: DATA_BASE + "elo_1v1.json",
    weaponStats: DATA_BASE + "weapon_stats.json",
    eloHistory: DATA_BASE + "elo_history.json"
};
const MATCH_API = location.hostname === "localhost"
    ? "https://q2stats.com/api/v1/matches"
    : "/api/v1/matches";
const ELO_API = location.hostname === "localhost"
    ? "https://q2stats.com/.netlify/functions/elo"
    : "/.netlify/functions/elo";
const WEAPON_API = location.hostname === "localhost"
    ? "https://q2stats.com/api/v1/weapons"
    : "/api/v1/weapons";
const WEAPON_LEADERBOARD_API = location.hostname === "localhost"
    ? "https://q2stats.com/api/v1/weapon-leaderboard"
    : "/api/v1/weapon-leaderboard";
const PROFILE_API = location.hostname === "localhost"
    ? "https://q2stats.com/api/v1/profiles"
    : "/api/v1/profiles";

(function(){const st=document.createElement("style");st.textContent='.vs-badge{display:inline-block;margin:0 9px;padding:2px 7px;border:1px solid #3a4656;border-radius:5px;background:#161d27;color:#fff;font-size:.78em;font-weight:800;letter-spacing:.08em;vertical-align:1px;white-space:nowrap}.team-avg-elo{color:#7d8796;font-weight:600}';document.head.appendChild(st)})();
// Cache public API responses locally per visitor. TTL: 60 min for weapon leaderboard,
// 10 min for other statistics, 1 min for recent match lists. Never persist error responses or huge payloads.
const Q2_CACHE_VERSION="q2stats-public-v1:";
const Q2_CACHE_STATS_MS=10*60*1000, Q2_CACHE_RECENT_MS=60*1000;
const Q2_CACHE_WEAPON_LEADERBOARD_MS=60*60*1000;
const q2PendingRequests=new Map();
function q2CachePolicy(file){
 const url=String(file);
 if(!/(?:\/api\/v1\/(?:matches|profiles|weapons|weapon-leaderboard)|\/\.netlify\/functions\/elo)(?:[/?]|$)/.test(url))return null;
 if(/\/api\/v1\/matches(?:\?|$)/.test(url))return Q2_CACHE_RECENT_MS;
 if(/\/api\/v1\/weapon-leaderboard(?:\?|$)/.test(url))return Q2_CACHE_WEAPON_LEADERBOARD_MS;
 return Q2_CACHE_STATS_MS;
}
function q2ReadCache(file,ttl){
 try{const raw=localStorage.getItem(Q2_CACHE_VERSION+file);if(!raw)return null;
  const item=JSON.parse(raw);if(!item||Date.now()-item.time>=ttl){localStorage.removeItem(Q2_CACHE_VERSION+file);return null;}
  return item.data;
 }catch{return null;}
}
function q2SaveCache(file,data){
 try{const raw=JSON.stringify({time:Date.now(),data});if(raw.length>800000)return;
  localStorage.setItem(Q2_CACHE_VERSION+file,raw);
 }catch{/* Storage can be disabled or full; networking still works. */}
}
async function q2FetchJson(file,ms){
 const ttl=q2CachePolicy(file),key=String(file);
 if(ttl){const cached=q2ReadCache(key,ttl);if(cached!==null)return cached;}
 if(q2PendingRequests.has(key))return q2PendingRequests.get(key);
 const task=(async()=>{
  const c=ms?new AbortController():null,t=ms?setTimeout(()=>c.abort(),ms):null;
  try{const r=await fetch(file,{cache:"default",...(c?{signal:c.signal}:{})});
   if(!r.ok)throw Error(`HTTP ${r.status}`);
   const data=await r.json();if(ttl&&data?.status!=="error")q2SaveCache(key,data);
   return data;
  }finally{if(t!==null)clearTimeout(t);}
 })();
 q2PendingRequests.set(key,task);
 try{return await task;}finally{q2PendingRequests.delete(key);}
}
async function loadJson(file,fallback=[]){try{return await q2FetchJson(file,0)}catch{return fallback}}
async function loadJsonTimeout(file,fallback=[],ms=8000){try{return await q2FetchJson(file,ms)}catch{return fallback}}
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const playerUrl=n=>`player.html?name=${encodeURIComponent(n)}`,num=v=>Number(v)||0,pct=v=>`${Math.round(num(v))}%`,fmt=v=>Math.round(num(v)).toLocaleString("en-US");
function getPlayers(m){if(Array.isArray(m?.players))return m.players;if(m?.stats&&typeof m.stats==="object")return Object.entries(m.stats).map(([name,v])=>({player:name,...v}));return[]}
function pname(p){return p.player||p.name||p.nickname||"Unknown"} function ptotal(p){return p.total||p.totals||p.stats||p} function pweapons(p){return p.weapons||{}}
function rankRows(items,limit=10,startRank=0){let rows=(Array.isArray(items)?items:[]).slice().sort((a,b)=>num(b.elo)-num(a.elo));if(limit)rows=rows.slice(0,limit);return rows.map((p,i)=>`<tr><td class="rank">${startRank+i+1}</td><td><a class="player-link" href="${playerUrl(p.player||p.name)}">${esc(p.player||p.name)}</a></td><td class="elo">${fmt(p.elo)}</td><td>${fmt(p.matches)}</td><td>${fmt(p.wins)}-${fmt(p.losses)}</td><td>${pct(p.winrate??(num(p.matches)?num(p.wins)/num(p.matches)*100:0))}</td></tr>`).join("")}
function matchLabel(m){const raw=m.saved_at||m.timestamp||m.date||"",d=raw?new Date(raw):null;let date="";if(d&&!Number.isNaN(d.getTime()))date=d.toLocaleString("sv-SE",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).replace(",","");else date=String(raw).replace("T"," ").slice(0,16);return{map:m.map||m.mapname||"Unknown map",date}}
// Small map preview shared by homepage, profile history and match archive.
function mapListPreview(map){
 const key=String(map||"").trim().toLowerCase();
 if(!/^[a-z0-9_-]+$/.test(key))return "";
 return `<img class="match-list-map-image" src="images/maps/${key}.webp" alt="" loading="lazy" decoding="async" onerror="this.remove()">`;
}
function matchListMeta(map,date){
 return `<div class="match-meta"><div class="match-list-map">${mapListPreview(map)}<div class="match-list-map-text">${esc(date||"Undated")}<br>${esc(map)}</div></div></div>`;
}
function scoreText(m){if(m.result)return String(m.result);if(m.score){if(typeof m.score==="string")return m.score;if("home"in m.score||"away"in m.score)return`${m.score.home??0} – ${m.score.away??0}`}if(m.home_score!=null||m.away_score!=null)return`${m.home_score??0} – ${m.away_score??0}`;return"—"}
function teamNames(m){const ps=getPlayers(m),home=[],away=[],homeElo=[],awayElo=[],other=[];for(const p of ps){const t=String(p.team||"").toLowerCase(),n=pname(p),eb=Number(p.elo_before);if(t==="home"||t==="red"||t==="team1"){home.push(n);if(Number.isFinite(eb))homeElo.push(eb)}else if(t==="away"||t==="blue"||t==="team2"){away.push(n);if(Number.isFinite(eb))awayElo.push(eb)}else if(!t.startsWith("spect"))other.push(n)}if(home.length||away.length){const avg=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null,ha=homeElo.length===home.length?avg(homeElo):null,aa=awayElo.length===away.length?avg(awayElo):null;return`${home.join(", ")||"Home"}${ha!=null?` (${ha})`:""} vs ${away.join(", ")||"Away"}${aa!=null?` (${aa})`:""}`}if(other.length>1)return other.join(" vs ");return other[0]||m.winner||"Match"}
function teamNamesHtml(m){const s=esc(teamNames(m));return s.replace(/ \((\d[\d,]*)\)/g,' <span class="team-avg-elo">($1)</span>').replace(/\s+vs\s+/gi,' <span class="vs-badge">VS</span> ')}
function renderMatches(matches,target,limit=12,offset=0){const el=document.getElementById(target);if(!el)return;const all=(Array.isArray(matches)?matches:[]).map((item,i)=>item&&item.__match?{m:item.__match,id:item.__id}:{m:item,id:i}).reverse(),rows=all.slice(offset,offset+limit);if(!rows.length){el.innerHTML='<div class="empty">No match data found yet.</div>';return}el.innerHTML=rows.map(({m,id})=>{const{map,date}=matchLabel(m);const href=m?.match_id?`match.html?match_id=${encodeURIComponent(m.match_id)}`:`match.html?id=${id}`;return`<a class="match match-link" href="${href}">${matchListMeta(map,date)}<div class="match-main">${teamNamesHtml(m)}</div><div class="match-score">${esc(scoreText(m))}</div></a>`}).join("")}

// Player profile recent games: 5 per page, newest first.
function recentMatchMode(m){
 const players=getPlayers(m).filter(p=>!String(p.team||"").toLowerCase().startsWith("spect"));
 const type=String(m.game_type||m.match_type||"").toLowerCase();
 return type.includes("1v1")||type.includes("duel")||players.length===2?"1v1":"team";
}
function recentMatchTime(m){const v=m.played_at||m.saved_at||m.timestamp||m.date;const n=v?Date.parse(v):NaN;return Number.isFinite(n)?n:0}
function initRecentMatches(initialMatches,playerName,canQueryApi){
 const list=document.getElementById("playerMatches"),info=document.getElementById("recentMatchInfo"),next=document.getElementById("recentViewAll");
 if(!list||!next)return;
 const perPage=13;
 let mode="all",page=0,loading=false,loaded=false,loadFailed=false;
 let all=initialMatches.slice();
 const prev=document.createElement("button");prev.type="button";prev.textContent="← Previous";
 prev.className=next.className;prev.id="recentPrevious";
 next.parentNode.insertBefore(prev,next);
 const pageLabel=document.createElement("span");pageLabel.id="recentPageLabel";
 pageLabel.style.margin="0 12px";next.parentNode.insertBefore(pageLabel,next);
 const matchKey=m=>m.match_id||JSON.stringify([m.saved_at,m.map,m.winner,m.home_score,m.away_score,getPlayers(m).map(p=>pname(p))]);
 function normalize(){
  const seen=new Set();all=all.filter(m=>{const k=matchKey(m);if(seen.has(k))return false;seen.add(k);return true});
  all.sort((a,b)=>recentMatchTime(b)-recentMatchTime(a));
 }
 function draw(){
  normalize();const filtered=all.filter(m=>mode==="all"||recentMatchMode(m)===mode);
  const pages=Math.max(1,Math.ceil(filtered.length/perPage));page=Math.min(page,pages-1);
  const shown=filtered.slice(page*perPage,(page+1)*perPage);
  // renderMatches reverses input; pass oldest-first so newest appears first.
  renderMatches(shown.slice().reverse(),"playerMatches",shown.length);
  if(info)info.textContent=loading?"Loading match history…":`${filtered.length}${!loaded&&canQueryApi?" loaded":""} ${mode==="all"?"matches":mode+" matches"}`;
  prev.hidden=page===0;prev.disabled=loading;
  next.hidden=page>=pages-1&&!(!loaded&&canQueryApi&&filtered.length>=perPage);
  next.disabled=loading;
  next.textContent=loading?"Loading…":"Next →";
  pageLabel.textContent=`Page ${page+1} of ${pages}${!loaded&&canQueryApi?"+":""}`;
  document.querySelectorAll("[data-recent-mode]").forEach(b=>{const active=b.dataset.recentMode===mode;b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active))});
 }
 async function loadAll(){
  if(loaded||!canQueryApi)return;
  loading=true;draw();
  try{
   const limit=100;let offset=0,total=Infinity,pages=0;const fetched=[];
   while(offset<total&&pages<200){
    const url=`${MATCH_API}?player=${encodeURIComponent(playerName)}&limit=${limit}&offset=${offset}`;
    const response=await loadJsonTimeout(url,null,12000);
    if(!response||!Array.isArray(response.matches))throw Error("Match API unavailable");
    const batch=response.matches;fetched.push(...batch);pages++;
    if(Number.isFinite(Number(response.total)))total=Number(response.total);
    if(batch.length===0||batch.length<limit)break;
    offset+=batch.length;
   }
   all.push(...fetched);loaded=true;loadFailed=false;
  }catch(e){loadFailed=true;}
  finally{loading=false;draw();if(loadFailed&&info)info.textContent="Could not load complete history. Showing available matches."}
 }
 document.querySelectorAll("[data-recent-mode]").forEach(b=>b.addEventListener("click",async()=>{mode=b.dataset.recentMode;page=0;await loadAll();draw()}));
 prev.addEventListener("click",()=>{if(page>0){page--;draw()}});
 next.addEventListener("click",async()=>{await loadAll();const count=all.filter(m=>mode==="all"||recentMatchMode(m)===mode).length;if((page+1)*perPage<count){page++;draw()}});
 draw();
}
function normalizeWeaponStats(data){if(!data)return{};if(data.weapons)return data.weapons;if(Array.isArray(data)){const out={};for(const r of data){const w=r.weapon||r.name;if(!w)continue;(out[w]??=[]).push(r)}return out}return data}
// Weapon artwork is decorative; statistics and existing links remain unchanged.
const WEAPON_IMAGE_FILES={
  "railgun":"railgun.png","rocket launcher":"rocket_launcher.png",
  "chaingun":"chaingun.png","super shotgun":"super_shotgun.png",
  "hyperblaster":"hyper_blaster.png","hyper blaster":"hyper_blaster.png",
  "machinegun":"machinegun.png","grenades":"grenades.png",
  "grenade launcher":"grenade_launcher.png","shotgun":"shotgun.png",
  "blaster":"blaster.png","bfg":"bfg.png"
};
function weaponImage(name){
  const filename=WEAPON_IMAGE_FILES[String(name||"").trim().toLowerCase()];
  return filename?`<img class="weapon-art" src="images/weapons/${filename}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`:"";
}
function renderWeapons(data){for(const mode of ["team","1v1"]){const n=normalizeWeaponStats(data?.by_mode?.[mode]);["Railgun","Rocket Launcher","Chaingun"].forEach(w=>{const el=document.getElementById(`${mode}-${w}`);if(!el)return;
  const card=el.closest(".weapon-card");
  const heading=card?.querySelector("h3");
  if(heading && !heading.querySelector(".weapon-art")){
    heading.classList.add("weapon-card-title");
    heading.insertAdjacentHTML("afterbegin",weaponImage(w));
  }
  let rows=n[w]||[];if(!Array.isArray(rows))rows=rows.top5||[];rows=rows.slice(0,5);el.innerHTML=rows.length?rows.map((r,i)=>`<div class="weapon-row"><span>${i+1}. <a class="player-link" href="${playerUrl(r.player||r.name)}">${esc(r.player||r.name)}</a></span><span>${r.accuracy==null?'—':pct(r.accuracy)}</span><span>${fmt(r.kills)} kills</span></div>`).join(""):'<div class="empty">No data</div>'})}}
async function initIndex(){
  // Render independent homepage sections as soon as their own requests finish.
  // The slower weapon leaderboard must not delay Recent Games or Elo.
  let matchesReady=false, eloReady=false;
  const updateStatus=()=>{
    const el=document.getElementById("dataStatus");
    if(el)el.textContent=matchesReady||eloReady?"Data connected":"Waiting for data";
  };
  const recentTask=loadJson(`${MATCH_API}?limit=12&offset=0`,{matches:[],total:0}).then(matchData=>{
    const matches=Array.isArray(matchData?.matches)?matchData.matches:[];
    renderMatches(matches.slice().reverse(),"matchList",12);
    document.getElementById("totalMatches").textContent=fmt(matchData?.total??matches.length);
    const lm=matches[matches.length-1];
    document.getElementById("latestMatch").textContent=lm?(lm.map||lm.mapname||"Match"):"—";
    matchesReady=matches.length>0;updateStatus();
  });
  const teamTask=loadJson(`${ELO_API}?type=team&limit=100&offset=0`,{rankings:[]}).then(teamData=>{
    const team=Array.isArray(teamData?.rankings)?teamData.rankings:[];
    document.getElementById("teamEloBody").innerHTML=rankRows(team,10);
    const top=team.slice().sort((a,b)=>num(b.elo)-num(a.elo))[0];
    document.getElementById("topTeam").textContent=top?`${top.player||top.name} · ${fmt(top.elo)}`:"—";
    eloReady=team.length>0;updateStatus();
    return team;
  });
  const team2Task=loadJson(`${ELO_API}?type=team&limit=100&offset=100`,{rankings:[]}).then(d=>Array.isArray(d?.rankings)?d.rankings:[]);
  const oneTask=loadJson(`${ELO_API}?type=1v1&limit=100&offset=0`,{rankings:[]}).then(oneData=>{
    const one=Array.isArray(oneData?.rankings)?oneData.rankings:[];
    document.getElementById("oneEloBody").innerHTML=rankRows(one,10);
    return one;
  });
  const playerCountTask=Promise.all([teamTask,team2Task,oneTask]).then(([team,team2,one])=>{
    document.getElementById("totalPlayers").textContent=fmt(new Set([...team,...team2,...one].map(x=>x.player||x.name).filter(Boolean)).size);
  });
  const weaponsTask=loadJson(WEAPON_LEADERBOARD_API,{}).then(renderWeapons);
  await Promise.all([recentTask,playerCountTask,weaponsTask]);
}

function playerResult(m,name){const p=getPlayers(m).find(x=>pname(x)===name);if(!p)return null;const t=ptotal(p);let won=null;if(typeof p.win==="boolean")won=p.win;else if(p.result)won=String(p.result).toLowerCase().startsWith("w");else if(m.winner)won=String(m.winner).toLowerCase()===name.toLowerCase()||String(m.winner).toLowerCase()===String(p.team||"").toLowerCase();return{p,t,won}}
function profileModeStats(profile){
 const matches=Array.isArray(profile?.matches)?profile.matches:[];
 const profileId=String(profile?.profile?.id??"");
 const out={team:{matches:0,wins:0,kills:0,deaths:0},one:{matches:0,wins:0,kills:0,deaths:0}};
 for(const m of matches){
  const ps=getPlayers(m).filter(p=>!String(p.team||"").toLowerCase().startsWith("spect"));
  const mine=ps.find(p=>profileId&&String(p.profile_id??"")===profileId);
  if(!mine)continue;
  const gt=String(m.game_type||m.match_type||"").toLowerCase();
  const is1v1=gt.includes("1v1")||gt.includes("duel")||ps.length===2;
  const s=is1v1?out.one:out.team;
  s.matches++;
  const t=ptotal(mine);
  s.kills+=num(t.kills??t.frags);
  s.deaths+=num(t.deaths??t.dths);
  if(m.winner!=null){
   const winner=String(m.winner).toLowerCase();
   const team=String(mine.team||"").toLowerCase();
   const nick=String(mine.name||"").toLowerCase();
   if(winner===team||winner===nick)s.wins++;
  }
 }
 return out;
}
function aggregateProfile(profile){
 const matches=Array.isArray(profile?.matches)?profile.matches:[];
 const profileId=String(profile?.profile?.id??"");
 let games=0,wins=0,losses=0,kills=0,deaths=0,dealt=0,received=0,suicides=0,teamkills=0;
 const weapons={},perMatch=[];
 for(const m of matches){
  const ps=getPlayers(m);
  const p=ps.find(x=>profileId&&String(x.profile_id??"")===profileId) || ps[0];
  if(!p)continue;
  games++;
  const team=String(p.team||"").toLowerCase();
  if(m.winner!=null){
   const winner=String(m.winner).toLowerCase();
   if(winner===team || winner===String(p.name||"").toLowerCase())wins++;
   else if(winner==="home"||winner==="away")losses++;
  }
  const t=ptotal(p);
  kills+=num(t.kills??t.frags);
  deaths+=num(t.deaths??t.dths);
  dealt+=num(t.dealt??t.damage??t.damage_dealt);
  received+=num(t.received??t.recvd??t.damage_received);
  suicides+=num(t.suicides??t.sui);
  teamkills+=num(t.teamkills??t.tks);
  const wm={};
  for(const[w,ss]of Object.entries(pweapons(p))){
   const raw=ss.accuracy??ss.acc,acc=raw==null?NaN:Number(raw),wk=num(ss.kills);
   const x=weapons[w]??={accSum:0,accN:0,kills:0,matches:0};
   if(Number.isFinite(acc)){x.accSum+=acc;x.accN++}
   x.kills+=wk;x.matches++;wm[w]=acc;
  }
  perMatch.push({m,weapons:wm});
 }
 return{games,wins,losses,kills,deaths,dealt,received,suicides,teamkills,weapons,perMatch};
}
function aggregatePlayer(matches,name){let games=0,wins=0,losses=0,kills=0,deaths=0,dealt=0,received=0,suicides=0,teamkills=0;const weapons={},perMatch=[];for(const m of matches){const r=playerResult(m,name);if(!r)continue;games++;if(r.won===true)wins++;else if(r.won===false)losses++;const t=r.t;kills+=num(t.kills??t.frags);deaths+=num(t.deaths??t.dths);dealt+=num(t.dealt??t.damage??t.damage_dealt);received+=num(t.received??t.recvd??t.damage_received);suicides+=num(t.suicides??t.sui);teamkills+=num(t.teamkills??t.tks);const wm={};for(const[w,s]of Object.entries(pweapons(r.p))){const raw=s.accuracy??s.acc,acc=raw==null?NaN:Number(raw),wk=num(s.kills),x=weapons[w]??={accSum:0,accN:0,kills:0,matches:0};if(Number.isFinite(acc)){x.accSum+=acc;x.accN++}x.kills+=wk;x.matches++;wm[w]=acc}perMatch.push({m,weapons:wm})}return{games,wins,losses,kills,deaths,dealt,received,suicides,teamkills,weapons,perMatch}}
const WEAPON_ABBR={"Railgun":"RG","Rocket Launcher":"RL","Chaingun":"CG","Super Shotgun":"SSG","Shotgun":"SG","Machinegun":"MG","Grenade Launcher":"GL","Grenades":"G","HyperBlaster":"HB","Blaster":"BL"};
function drawLineChart(canvas,series,opts={}){
if(!canvas)return;
const c=canvas.getContext("2d"),W=canvas.width,H=canvas.height,L=58,R=28,T=30,B=42;
const render=(hover=null)=>{
c.clearRect(0,0,W,H);c.fillStyle="#0c1016";c.fillRect(0,0,W,H);
const visible=series.filter(s=>!s.hidden),all=visible.flatMap(s=>s.values.filter(Number.isFinite));
if(!all.length){c.fillStyle="#8994a6";c.font="14px Segoe UI";c.fillText("No data yet",L,H/2);canvas.__chartPoints=[];return}
let min=opts.min??Math.min(...all),max=opts.max??Math.max(...all);
if(opts.include!=null){min=Math.min(min,opts.include);max=Math.max(max,opts.include)}
if(max===min){min-=10;max+=10}
if(opts.pad!==false){const d=Math.max(1,(max-min)*.12);min-=d;max+=d}
if(opts.min!=null)min=opts.min;if(opts.max!=null)max=opts.max;
const yOf=v=>H-B-(v-min)*(H-T-B)/(max-min);
c.font="12px Segoe UI";c.textAlign="right";c.textBaseline="middle";
const ticks=opts.ticks||6;
for(let i=0;i<ticks;i++){const v=max-(max-min)*i/(ticks-1),y=yOf(v);c.strokeStyle="#27303d";c.lineWidth=1;c.beginPath();c.moveTo(L,y);c.lineTo(W-R,y);c.stroke();c.fillStyle="#aab4c3";c.fillText(`${Math.round(v)}${opts.suffix||""}`,L-9,y)}
if(opts.reference!=null&&opts.reference>=min&&opts.reference<=max){const y=yOf(opts.reference);c.strokeStyle="#7d8796";c.setLineDash([6,5]);c.beginPath();c.moveTo(L,y);c.lineTo(W-R,y);c.stroke();c.setLineDash([]);c.fillStyle="#d0d6df";c.textAlign="left";c.fillText(opts.referenceLabel||String(opts.reference),L+7,y-10)}
const colors=["#ff6b46","#7fc8ff","#86e2a8","#d89cff","#ffd66b","#ff91b8","#a9b8ff","#8de1d0","#ffad75","#c5d36f"],points=[];
visible.forEach((ser,si)=>{
const vals=ser.values,valid=vals.map((v,i)=>({v,i})).filter(x=>Number.isFinite(x.v));if(!valid.length)return;
const xOf=i=>L+(vals.length<=1?0:i*(W-L-R)/(vals.length-1));
c.strokeStyle=colors[si%colors.length];c.lineWidth=2.4;c.beginPath();
valid.forEach((x,j)=>{const px=xOf(x.i),py=yOf(x.v);j?c.lineTo(px,py):c.moveTo(px,py);points.push({x:px,y:py,v:x.v,i:x.i,name:ser.name,color:colors[si%colors.length]})});c.stroke();
if(opts.labelLines){const first=valid[0],x=xOf(first.i),y=yOf(first.v);c.font="bold 11px Segoe UI";c.textAlign="left";c.textBaseline="bottom";c.fillStyle=colors[si%colors.length];c.fillText(ser.short||ser.name,x+5,y-5)}
});
c.fillStyle="#8994a6";c.font="11px Segoe UI";c.textAlign="left";c.textBaseline="alphabetic";c.fillText(opts.xStart||"Start",L,H-14);c.textAlign="right";c.fillText(opts.xEnd||"Latest",W-R,H-14);
canvas.__chartPoints=points;
if(hover){
c.beginPath();c.arc(hover.x,hover.y,5,0,Math.PI*2);c.fillStyle=hover.color;c.fill();c.strokeStyle="#ffffff";c.lineWidth=2;c.stroke();
const value=`${Number.isInteger(hover.v)?hover.v:hover.v.toFixed(1)}${opts.suffix||""}`;
const label=`${hover.name}: ${value} · Match ${hover.i+1}`;
c.font="12px Segoe UI";const tw=c.measureText(label).width+18,th=28;
let tx=hover.x+12;if(tx+tw>W-8)tx=hover.x-tw-12;let ty=hover.y-36;if(ty<T)ty=hover.y+12;
c.fillStyle="#161d27";c.fillRect(tx,ty,tw,th);c.strokeStyle="#3a4656";c.lineWidth=1;c.strokeRect(tx,ty,tw,th);c.fillStyle="#ffffff";c.textAlign="left";c.textBaseline="middle";c.fillText(label,tx+9,ty+th/2);
}
};
render();
canvas.onmousemove=e=>{const r=canvas.getBoundingClientRect(),mx=(e.clientX-r.left)*canvas.width/r.width,my=(e.clientY-r.top)*canvas.height/r.height;let best=null,dist=Infinity;for(const p of canvas.__chartPoints||[]){const d=Math.hypot(p.x-mx,p.y-my);if(d<dist){dist=d;best=p}}render(dist<=18?best:null);canvas.style.cursor=dist<=18?"pointer":"default"};
canvas.onmouseleave=()=>{render();canvas.style.cursor="default"};
}
function eloValues(hist,name,type="team"){const vals=[];if(!Array.isArray(hist))return vals;for(const e of hist){const et=String(e.game_type||e.type||e.mode||e.elo_type||"").toLowerCase();if(type==="team"&&et.includes("1v1"))continue;if(type==="1v1"&&et&&!et.includes("1v1"))continue;if((e.player||e.name)===name){const v=e.new_elo??e.elo;if(v!=null)vals.push(num(v))}if(Array.isArray(e.players)){const p=e.players.find(x=>(x.player||x.name)===name);if(p){const v=p.new_elo??p.elo;if(v!=null)vals.push(num(v))}}else if(e.players&&e.players[name]!=null){const p=e.players[name],v=(typeof p==="object"?(p.new_elo??p.elo):p);if(v!=null)vals.push(num(v))}}return vals}

function renderPlayerSetup(setup){
 const box=document.getElementById("playerSetup"),list=document.getElementById("playerSetupList");
 if(!box||!list)return;
 const fields=[["Mouse",setup?.mouse],["Mousepad",setup?.mousepad],["DPI",setup?.dpi],
  ["Sensitivity",setup?.sensitivity],["FOV",setup?.fov],["Resolution",setup?.resolution],
  ["Refresh rate",setup?.refresh_rate],["cl_maxfps",setup?.cl_maxfps],["Headphones",setup?.headphones]];
 const rows=fields.filter(([,v])=>v!=null&&String(v).trim()!=="");
 if(!rows.length){box.hidden=true;return}
 list.innerHTML=rows.map(([k,v])=>`<div class="setup-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("");
 box.hidden=false;
}


// Map statistics use the actual player's per-match totals, never weapon kills.
function renderMapPerformance(matches,profileId,requestedName){
 const body=document.getElementById("mapPerformanceBody"),info=document.getElementById("mapPerformanceInfo");
 if(!body)return;
 const stats={team:new Map(),"1v1":new Map()};
 const seen=new Set();
 for(const m of Array.isArray(matches)?matches:[]){
  if(!m||typeof m!=="object")continue;
  const matchId=m.match_id!=null?String(m.match_id):null;
  if(matchId&&seen.has(matchId))continue;
  const players=getPlayers(m).filter(p=>!String(p.team||"").toLowerCase().startsWith("spect"));
  const mine=players.find(p=>profileId&&String(p.profile_id??"")===String(profileId))
   ||(!profileId?players.find(p=>String(pname(p)).toLowerCase()===String(requestedName).toLowerCase()):null);
  if(!mine)continue;
  if(matchId)seen.add(matchId);
  const rawMap=String(m.map||m.mapname||"").trim().toLowerCase();
  // Historical matches with no recorded map are excluded only from this table.
  if(!rawMap||rawMap==="unknown")continue;
  // Two names for the same map.
  const key=rawMap==="aerowalk"?"q2duel1":rawMap;
  const map=key;
  const mode=recentMatchMode(m),bucket=stats[mode];
  const s=bucket.get(key)||{map,matches:0,wins:0,losses:0,frags:0,deaths:0,dealt:0,received:0};
  const t=ptotal(mine);
  s.matches++;s.frags+=num(t.frags??t.kills);s.deaths+=num(t.dths??t.deaths);
  s.dealt+=num(t.dealt??t.damage??t.damage_dealt);
  s.received+=num(t.received??t.recvd??t.damage_received);
  let won=null;
  if(typeof mine.win==="boolean")won=mine.win;
  else if(mine.result){const r=String(mine.result).toLowerCase();if(r.startsWith("w"))won=true;else if(r.startsWith("l"))won=false;}
  if(won===null&&m.winner!=null){
   const winner=String(m.winner).trim().toLowerCase();
   const team=String(mine.team||"").trim().toLowerCase();
   const nick=String(pname(mine)).trim().toLowerCase();
   if(winner===team||winner===nick)won=true;
   else if(winner==="home"||winner==="away"||winner==="red"||winner==="blue"||players.some(p=>String(pname(p)).toLowerCase()===winner))won=false;
  }
  if(won===true)s.wins++;else if(won===false)s.losses++
  bucket.set(key,s);
 }
 function draw(mode){
  const items=[...stats[mode].values()].sort((a,b)=>b.matches-a.matches||a.map.localeCompare(b.map));
  body.innerHTML=items.length?items.map(s=>{
   const key=s.map.toLowerCase();
   const img=/^[a-z0-9_-]+$/.test(key)?`<img src="images/maps/${key}.webp" alt="" loading="lazy" onerror="this.remove()">`:"";
   const decided=s.wins+s.losses;
   const win=decided?`${(100*s.wins/decided).toFixed(1)}%`:"—";
   const kd=s.deaths?(s.frags/s.deaths).toFixed(2):(s.frags?"∞":"—");
   const ratio=s.received?(s.dealt/s.received).toFixed(2):(s.dealt?"∞":"—");
   const tone=(v,baseline)=>v>baseline?"positive":v<baseline?"negative":"";
   const winTone=decided?tone(s.wins/decided,0.5):"";
   return `<tr><td><span class="map-performance-map">${img}<span>${esc(s.map)}</span></span></td><td>${fmt(s.matches)}</td><td>${fmt(s.wins)}–${fmt(s.losses)}</td><td><div class="map-winrate"><span>${win}</span><div class="map-winrate-track"><div class="map-winrate-fill" style="width:${decided?(100*s.wins/decided).toFixed(1):0}%"></div></div></div></td><td>${kd}</td><td>${fmt(s.dealt/s.matches)}</td><td>${ratio}</td></tr>`;
  }).join(""):'<tr><td colspan="7" class="empty">No map statistics available for this mode.</td></tr>';
  info.textContent=`${items.length} maps · ${items.reduce((n,s)=>n+s.matches,0)} matches`;
  document.querySelectorAll("[data-map-mode]").forEach(b=>{const active=b.dataset.mapMode===mode;b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active))});
 }
 document.querySelectorAll("[data-map-mode]").forEach(b=>b.addEventListener("click",()=>draw(b.dataset.mapMode)));
 draw("team");
}

async function initPlayer(){const requestedName=new URLSearchParams(location.search).get("name")||"Unknown";const profile=await loadJson(`${PROFILE_API}?nickname=${encodeURIComponent(requestedName)}`,null);const hasProfile=profile?.status==="ok"&&profile?.profile;const name=hasProfile?String(profile.profile.primary_name||requestedName):requestedName;document.title=`${name} · Q2Stats`;document.getElementById("playerName").textContent=name;if(hasProfile)renderPlayerSetup(profile.setup);const[matches,teamFallback,oneFallback,hist,teamPage1,teamPage2,oneData,centralMatches,weaponData,centralTeamHist,centralOneHist]=await Promise.all([hasProfile?Promise.resolve([]):loadJson(DATA_FILES.matches,[]),loadJson(DATA_FILES.teamElo,[]),loadJson(DATA_FILES.oneElo,[]),loadJson(DATA_FILES.eloHistory,[]),loadJson(`${ELO_API}?type=team&limit=100&offset=0`,{rankings:[]}),loadJson(`${ELO_API}?type=team&limit=100&offset=100`,{rankings:[]}),loadJson(`${ELO_API}?type=1v1&limit=100&offset=0`,{rankings:[]}),loadJsonTimeout(`${MATCH_API}?player=${encodeURIComponent(name)}&limit=100`,{},8000),loadJson(`${WEAPON_API}?player=${encodeURIComponent(name)}`,{}),loadJson(`${ELO_API}?type=team&player=${encodeURIComponent(name)}`,{}),loadJson(`${ELO_API}?type=1v1&player=${encodeURIComponent(name)}`,{})]);const team=[...(Array.isArray(teamPage1?.rankings)?teamPage1.rankings:[]),...(Array.isArray(teamPage2?.rankings)?teamPage2.rankings:[])],one=Array.isArray(oneData?.rankings)?oneData.rankings:[],localA=aggregatePlayer(matches,requestedName),centralPlayerMatches=hasProfile&&Array.isArray(profile.matches)?profile.matches:(Array.isArray(centralMatches?.matches)?centralMatches.matches:[]),centralComplete=hasProfile|| (Number.isFinite(Number(centralMatches?.total))&&Number(centralMatches.total)===centralPlayerMatches.length),centralA=hasProfile?aggregateProfile(profile):(centralComplete?aggregatePlayer(centralPlayerMatches,requestedName):null),a=centralA||localA,tr=team.find(x=>(x.player||x.name)===name)||(teamFallback||[]).find(x=>(x.player||x.name)===name),or=one.find(x=>(x.player||x.name)===name)||(oneFallback||[]).find(x=>(x.player||x.name)===name),wr=a.games?a.wins/a.games*100:(tr?.winrate||0),kd=a.deaths?a.kills/a.deaths:a.kills,avg=a.games?a.dealt/a.games:0,modeStats=hasProfile?profileModeStats(profile):(()=>{const out={team:{matches:0,wins:0,kills:0,deaths:0},one:{matches:0,wins:0,kills:0,deaths:0}};for(const m of centralPlayerMatches){const r=playerResult(m,requestedName);if(!r)continue;const ps=getPlayers(m).filter(p=>!String(p.team||"").toLowerCase().startsWith("spect"));const gt=String(m.game_type||m.match_type||"").toLowerCase();const is1v1=gt.includes("1v1")||gt.includes("duel")||ps.length===2;const s=is1v1?out.one:out.team;s.matches++;s.kills+=num(r.t.kills??r.t.frags);s.deaths+=num(r.t.deaths??r.t.dths);if(r.won===true)s.wins++}return out})();document.getElementById("pTeamElo").textContent=tr?fmt(tr.elo):"—";document.getElementById("p1v1Elo").textContent=or?fmt(or.elo):"—";document.getElementById("pTeamRank").textContent=tr?`Rank #${team.findIndex(x=>(x.player||x.name)===name)+1} · ${modeStats.team.matches} matches`:"—";document.getElementById("p1v1Rank").textContent=or?`Rank #${one.findIndex(x=>(x.player||x.name)===name)+1} · ${modeStats.one.matches} matches`:"—";const teamWR=modeStats.team.matches?modeStats.team.wins/modeStats.team.matches*100:0,oneWR=modeStats.one.matches?modeStats.one.wins/modeStats.one.matches*100:0,teamKD=modeStats.team.deaths?modeStats.team.kills/modeStats.team.deaths:modeStats.team.kills,oneKD=modeStats.one.deaths?modeStats.one.kills/modeStats.one.deaths:modeStats.one.kills;document.getElementById("pTeamWinrate").textContent=pct(teamWR);document.getElementById("p1v1Winrate").textContent=pct(oneWR);document.getElementById("pTeamKD").textContent=teamKD.toFixed(2);document.getElementById("p1v1KD").textContent=oneKD.toFixed(2);document.getElementById("pMatches").textContent=fmt(a.games||tr?.matches||0);document.getElementById("pKillsOverall").textContent=fmt(a.kills);document.getElementById("pAvgDamage").textContent=fmt(avg);document.getElementById("playerSub").textContent=`${a.games} recorded matches · ${fmt(a.kills)} kills · ${fmt(a.dealt)} total dealt damage`;const combat=[["Kills",a.kills],["Deaths",a.deaths],["Damage dealt",a.dealt],["Damage received",a.received],["Suicides",a.suicides],["Teamkills",a.teamkills]];document.getElementById("combatStats").innerHTML=combat.map(([k,v])=>`<div class="stat-item"><span>${k}</span><strong>${fmt(v)}</strong></div>`).join("");const weaponModes=profile?.weapons?.summary_by_mode;
const sourceMatches=hasProfile?profile.matches:(centralComplete?centralPlayerMatches:matches);
const fallbackModes={team:{},"1v1":{}};
// The weapons endpoint returns {summary, history}, not summary_by_mode.
// Match the weapon history to player matches to keep Team and 1v1 separate.
const weaponHistory=Array.isArray(weaponData?.history)?weaponData.history:[];
const matchModes=new Map(centralPlayerMatches.filter(m=>m?.match_id).map(m=>[String(m.match_id),recentMatchMode(m)]));
if(!weaponModes&&weaponHistory.length){
 for(const entry of weaponHistory){
  const mode=matchModes.get(String(entry.match_id));
  if(!mode)continue; // Do not guess the game type when a match is unavailable.
  for(const [w,stat] of Object.entries(entry.weapons||{})){
   const x=fallbackModes[mode][w]??={weapon:w,kills:0,matches:0,accSum:0,accCount:0};
   x.kills+=num(stat?.kills);x.matches++;
   const acc=stat?.accuracy;
   if(acc!=null&&Number.isFinite(Number(acc))){x.accSum+=Number(acc);x.accCount++}
  }
 }
}

if(!weaponModes&&!weaponHistory.length){for(const m of sourceMatches){const players=getPlayers(m);const gt=String(m.game_type||m.match_type||"").toLowerCase();const mode=gt==="1v1"||gt==="duel"||(gt!=="team"&&players.length===2)?"1v1":"team";const p=hasProfile?players.find(x=>String(x.profile_id)===String(profile.profile.id)):players.find(x=>String(x.name||"").toLowerCase()===requestedName.toLowerCase());if(!p)continue;for(const [w,stat] of Object.entries(pweapons(p))){const x=fallbackModes[mode][w]??={weapon:w,kills:0,matches:0,accSum:0,accCount:0};x.kills+=num(stat.kills);x.matches++;const acc=stat.accuracy??stat.acc;if(acc!=null&&Number.isFinite(Number(acc))){x.accSum+=Number(acc);x.accCount++}}}}
const WEAPON_DISPLAY_ORDER=["Railgun","Chaingun","Rocket Launcher","Super Shotgun","HyperBlaster","Machinegun","Grenades","Grenade Launcher","Shotgun","Blaster"];
for(const [mode,id] of [["team","weaponBodyTeam"],["1v1","weaponBody1v1"]]){
  const ws=weaponModes?.[mode]||Object.values(fallbackModes[mode]).map(x=>({...x,accuracy:x.accCount?x.accSum/x.accCount:null}));
  const byName=new Map(ws.map(x=>[String(x.weapon).toLowerCase(),x]));
  const ordered=WEAPON_DISPLAY_ORDER.map(w=>byName.get(w.toLowerCase())||{weapon:w,accuracy:null,kills:0,matches:0});
  const extras=ws.filter(x=>!WEAPON_DISPLAY_ORDER.some(w=>w.toLowerCase()===String(x.weapon).toLowerCase()) && !/^(?:adrenaline|combat[ _-]*armor|jacket[ _-]*armor|mega[ _-]*health)$/i.test(String(x.weapon).trim())).sort((a,b)=>String(a.weapon).localeCompare(String(b.weapon)));
  document.getElementById(id).innerHTML=[...ordered,...extras].map(x=>`<tr><td><span class="weapon-summary-name">${weaponImage(x.weapon)}<span>${esc(x.weapon)}</span></span></td><td>${x.accuracy==null?'—':pct(x.accuracy)}</td><td>${fmt(x.kills)}</td><td>${fmt(x.matches)}</td></tr>`).join("");
}
renderMapPerformance(
  hasProfile&&Array.isArray(profile.matches)?profile.matches:
  centralPlayerMatches.length?centralPlayerMatches:matches,
  hasProfile?profile.profile.id:null,
  requestedName
 );
 const playerMatches=centralPlayerMatches.length?centralPlayerMatches.slice().reverse():matches.map((m,id)=>({__match:m,__id:id})).filter(x=>playerResult(x.__match,name));initRecentMatches(playerMatches.map(x=>x.__match||x),name,true);
const centralTeamEvents=Array.isArray(centralTeamHist?.history)?centralTeamHist.history:[],centralOneEvents=Array.isArray(centralOneHist?.history)?centralOneHist.history:[];let teamEv=centralTeamEvents.length?centralTeamEvents.map(e=>num(e.elo_after)):eloValues(hist,name,"team"),oneEv=centralOneEvents.length?centralOneEvents.map(e=>num(e.elo_after)):eloValues(hist,name,"1v1");if(!teamEv.length&&tr)teamEv=[num(tr.elo)];if(!oneEv.length&&or)oneEv=[num(or.elo)];const fromStart=vals=>[1500,...vals.filter((v,i,a)=>i||v!==1500)];teamEv=fromStart(teamEv);oneEv=fromStart(oneEv);const eloCanvas=document.getElementById("eloChart"),eloButtons=document.querySelectorAll("[data-elo-history]");const drawElo=type=>{const isOne=type==="1v1",values=isOne?oneEv:teamEv;drawLineChart(eloCanvas,[{name:isOne?"1v1 Elo":"Team Elo",short:isOne?"1V1":"TEAM",values}],{include:1500,reference:1500,referenceLabel:"START 1500",xStart:"Start 1500",xEnd:"Latest"});eloButtons.forEach(b=>b.classList.toggle("active",b.dataset.eloHistory===type))};eloButtons.forEach(b=>b.onclick=()=>drawElo(b.dataset.eloHistory));drawElo("team");
const centralWeaponHistory=hasProfile&&Array.isArray(profile?.weapons?.history)?profile.weapons.history:(Array.isArray(weaponData?.history)?weaponData.history:[]),accuracyMatches=centralWeaponHistory.length?centralWeaponHistory.map(x=>({m:{match_id:x.match_id,saved_at:x.played_at},weapons:Object.fromEntries(Object.entries(x.weapons||{}).map(([w,s])=>{const raw=s?.accuracy,acc=raw==null?NaN:Number(raw);return[w,Number.isFinite(acc)?acc:NaN]}))})):localA.perMatch,preferred=["Railgun","Chaingun"],allWeapons=[...new Set(accuracyMatches.flatMap(x=>Object.keys(x.weapons)))].filter(w=>! /^(?:adrenaline|combat[ _-]*armor|jacket[ _-]*armor|mega[ _-]*health)$/i.test(w.trim())),ordered=[...preferred.filter(w=>allWeapons.includes(w)),...allWeapons.filter(w=>!preferred.includes(w))],series=ordered.map(w=>({name:w,short:WEAPON_ABBR[w]||w.slice(0,3).toUpperCase(),values:accuracyMatches.map(x=>x.weapons[w]??NaN),hidden:!preferred.includes(w)})),legend=document.getElementById("weaponLegend");legend.innerHTML=series.map((s,i)=>`<button class="${s.hidden?"":"on"}" data-i="${i}" title="${esc(s.name)}">${esc(s.short)}</button>`).join("");const redraw=()=>drawLineChart(document.getElementById("accuracyChart"),series,{min:0,max:100,ticks:11,suffix:"%",pad:false,labelLines:true,xStart:"Oldest match",xEnd:"Latest match"});legend.querySelectorAll("button").forEach(b=>b.onclick=()=>{const i=+b.dataset.i;series[i].hidden=!series[i].hidden;b.classList.toggle("on",!series[i].hidden);redraw()});redraw()}
async function initRankings(){const q=new URLSearchParams(location.search),type=q.get("type")==="1v1"?"1v1":"team",per=100,requestedPage=Math.max(1,parseInt(q.get("page")||"1")),requestedOffset=(requestedPage-1)*per,data=await loadJson(`${ELO_API}?type=${encodeURIComponent(type)}&limit=${per}&offset=${requestedOffset}`,{rankings:[],total:0}),total=num(data?.total),pages=Math.max(1,Math.ceil(total/per)),page=Math.min(requestedPage,pages),offset=(page-1)*per;let items=Array.isArray(data?.rankings)?data.rankings:[];if(page!==requestedPage){const corrected=await loadJson(`${ELO_API}?type=${encodeURIComponent(type)}&limit=${per}&offset=${offset}`,{rankings:[],total}),items2=Array.isArray(corrected?.rankings)?corrected.rankings:[];items=items2}document.querySelectorAll("[data-ranking]").forEach(b=>b.classList.toggle("active",b.dataset.ranking===type));document.getElementById("rankingTitle").textContent=type==="1v1"?"1v1 Elo Rankings":"Team Elo Rankings";document.getElementById("rankingBody").innerHTML=rankRows(items,0,offset);const nav=document.getElementById("rankingPagination");if(nav){let h=page>1?`<a href="rankings.html?type=${type}&page=${page-1}">← Previous</a>`:"<span></span>";h+=`<span>Page ${page} of ${pages} · ${total} players</span>`;h+=page<pages?`<a href="rankings.html?type=${type}&page=${page+1}">Next →</a>`:"<span></span>";nav.innerHTML=h}}
async function initMatchesPage(){
 const per=40,q=new URLSearchParams(location.search),requestedPage=Math.max(1,parseInt(q.get("page")||"1")),requestedOffset=(requestedPage-1)*per;
 let data=await loadJson(`${MATCH_API}?limit=${per}&offset=${requestedOffset}`,{matches:[],total:0});
 let total=num(data?.total),pages=Math.max(1,Math.ceil(total/per)),p=Math.min(requestedPage,pages),offset=(p-1)*per;
 if(p!==requestedPage)data=await loadJson(`${MATCH_API}?limit=${per}&offset=${offset}`,{matches:[],total});
 const matches=Array.isArray(data?.matches)?data.matches:[];total=num(data?.total??total);pages=Math.max(1,Math.ceil(total/per));
 const el=document.getElementById("allMatchList");
 if(el){el.innerHTML=matches.length?matches.map(m=>{const{map,date}=matchLabel(m);return`<a class="match match-link" href="match.html?match_id=${encodeURIComponent(m.match_id)}">${matchListMeta(map,date)}<div class="match-main">${teamNamesHtml(m)}</div><div class="match-score">${esc(scoreText(m))}</div></a>`}).join(""):'<div class="empty">No match data found yet.</div>'}
 const nav=document.getElementById("pagination");if(nav){const options=Array.from({length:pages},(_,i)=>`<option value="${i+1}"${i+1===p?" selected":""}>Page ${i+1}</option>`).join("");let h=p>1?`<a href="matches.html?page=${p-1}">← Previous</a>`:"<span></span>";h+=`<span><select id="matchPageSelect" aria-label="Choose match page">${options}</select> of ${pages} · ${total} matches</span>`;h+=p<pages?`<a href="matches.html?page=${p+1}">Next →</a>`:"<span></span>";nav.innerHTML=h;const sel=document.getElementById("matchPageSelect");if(sel)sel.addEventListener("change",()=>{location.href=`matches.html?page=${sel.value}`})}
}
async function initMatch(){
 const q=new URLSearchParams(location.search),matchId=q.get("match_id"),box=document.getElementById("matchDetail");
 let m=null,id=-1;
 if(matchId)m=await loadJson(`${MATCH_API}/${encodeURIComponent(matchId)}`,null);
 else{const matches=await loadJson(DATA_FILES.matches,[]);id=parseInt(q.get("id")||"-1");m=matches[id]}
 if(!m||m.status==="error"){box.innerHTML='<div class="empty">Match not found.</div>';return}
 const ml=matchLabel(m),players=getPlayers(m).filter(p=>!String(p.team||"").toLowerCase().startsWith("spect"));
 document.getElementById("matchTitle").textContent=teamNames(m);document.getElementById("matchMap").textContent=ml.map;
  // Show a map screenshot when a matching local image exists.
  const mapElement=document.getElementById("matchMap");
  const mapKey=String(ml.map||"").trim().toLowerCase();
  if(mapElement&&/^[a-z0-9_-]+$/.test(mapKey)){
    const mapImg=document.createElement("img");
    mapImg.className="match-map-thumbnail";
    mapImg.src=`images/maps/${mapKey}.webp`;
    mapImg.alt=`Screenshot of ${ml.map}`;
    mapImg.loading="lazy";
    mapImg.decoding="async";
    mapImg.onerror=()=>mapImg.remove();
    mapElement.prepend(mapImg);
    mapElement.classList.add("match-map-with-image");
  }document.getElementById("matchServer").textContent=m.hostname||m.server||"Server not recorded";document.getElementById("matchWinner").textContent=m.winner||"—";document.getElementById("matchScore").textContent=scoreText(m);
 // Only exact OpenTDM demo filenames; no time/map matching.
 const demoFilename=String(m.demo_filename||m.demo||"");
 if(/^(?:PFDE3|PFDE)_[0-9]{8}-[0-9]{6}_[a-z0-9_-]+\.mvd2$/i.test(demoFilename)){
  const demoQuery=new URLSearchParams({server:String(m.server||m.hostname||""),filename:demoFilename});
  loadJson(`/.netlify/functions/demo-lookup?${demoQuery}`,{}).then(data=>{
   if(!data?.demo)return;
   const a=document.getElementById("demoDownload");if(!a)return;
   a.href=data.demo;a.hidden=false;
  });
 }
 const realMatchId=m.match_id,is1v1=players.length===2,eloType=is1v1?"1v1":"team",eloMap=new Map();
 if(realMatchId){
  for(const p of players){
   const before=Number(p.elo_before),after=Number(p.elo_after??p.new_elo),change=Number(p.elo_change??p.change);
   if(Number.isFinite(after)&&Number.isFinite(change))eloMap.set(pname(p),{new_elo:after,change});
   else if(Number.isFinite(before)&&Number.isFinite(change))eloMap.set(pname(p),{new_elo:before+change,change});
  }
  const missing=players.filter(p=>!eloMap.has(pname(p)));
  if(missing.length){
   const histories=await Promise.all(missing.map(p=>loadJson(`${ELO_API}?type=${encodeURIComponent(eloType)}&player=${encodeURIComponent(pname(p))}`,{})));
   histories.forEach((data,i)=>{const history=Array.isArray(data?.history)?data.history:[],e=history.find(x=>x.match_id===realMatchId);if(e)eloMap.set(pname(missing[i]),{new_elo:e.elo_after??e.new_elo,change:e.change??e.elo_change})});
  }
 }else{
  const hist=await loadJsonTimeout(DATA_FILES.eloHistory,[],3000),events=Array.isArray(hist)?hist:(hist.events||hist.history||[]);
  let ev=id>=0&&events[id]&&Array.isArray(events[id].players)?events[id]:null;
  for(const x of ev?.players||[])eloMap.set(String(x.player||x.name||""),x);
 }
 const groups=[];
 for(const p of players){const raw=String(p.team||"Other"),key=raw.toLowerCase(),label=(key==="home"||key==="red"||key==="team1")?"Home":(key==="away"||key==="blue"||key==="team2")?"Away":raw||"Other";let g=groups.find(x=>x.key===key);if(!g){g={key,label,players:[]};groups.push(g)}g.players.push(p)}
 const row=p=>{const t=ptotal(p),k=num(t.frags??t.kills??p.score),d=num(t.dths??t.deaths),net=k-d,ping=p.ping??t.ping??"—",ee=eloMap.get(pname(p));let elo='—';if(ee){const ch=num(ee.change??ee.elo_change),newElo=ee.new_elo??ee.elo_after,cls=ch>0?'positive':ch<0?'negative':'',sign=ch>0?'+':'';elo=`<span>${fmt(newElo)}</span> <span class="${cls}">(${sign}${ch.toFixed(1)})</span>`}return`<tr><td><a class="player-link" href="${playerUrl(pname(p))}">${esc(pname(p))}</a></td><td>${k}</td><td>${d}</td><td class="${net>=0?'positive':'negative'}">${net>0?'+':''}${net}</td><td>${esc(ping)}</td><td>${elo}</td></tr>`};
 const avgPreElo=g=>{const vals=g.players.map(p=>{const direct=Number(p.elo_before);if(Number.isFinite(direct))return direct;const e=eloMap.get(pname(p));if(!e)return NaN;const after=Number(e.new_elo??e.elo_after),change=Number(e.change??e.elo_change);return Number.isFinite(after)&&Number.isFinite(change)?after-change:NaN}).filter(Number.isFinite);return vals.length===g.players.length&&vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null};
 const groupOrder={home:0,red:0,team1:0,away:1,blue:1,team2:1};
 groups.sort((a,b)=>(groupOrder[a.key]??2)-(groupOrder[b.key]??2));
 const teamScore=g=>{const key=String(g.label||"").toLowerCase();if(key==="home")return m.home_score??m.score?.home;if(key==="away")return m.away_score??m.score?.away;return null};
 box.innerHTML=`<div class="match-elo-note">${is1v1?'1v1 Elo':'Team Elo'} · rating after match (change) · team average uses rating before match</div>`+groups.map(g=>{g.players.sort((a,b)=>{const ta=ptotal(a),tb=ptotal(b);return num(tb.frags??tb.kills??b.score)-num(ta.frags??ta.kills??a.score)});const avg=avgPreElo(g),score=teamScore(g);return`<section class="team-scoreboard"><div class="team-scoreboard-head"><span class="team-name">${esc(g.label)}</span><span class="team-head-meta">${avg!=null?`<span>Avg Elo <strong>${fmt(avg)}</strong></span>`:''}${score!=null?`<span class="team-score">Score <strong>${esc(score)}</strong></span>`:''}<span>${g.players.length} player${g.players.length===1?'':'s'}</span></span></div><div class="table-wrap"><table><thead><tr><th>Player</th><th>Frags</th><th>Dths</th><th>Net</th><th>Ping</th><th>Elo</th></tr></thead><tbody>${g.players.map(row).join("")}</tbody></table></div></section>`}).join("")||'<div class="empty">No player data</div>' 
}
if(document.getElementById("teamEloBody"))initIndex();if(document.getElementById("playerName"))initPlayer();if(document.getElementById("rankingBody"))initRankings();if(document.getElementById("allMatchList"))initMatchesPage();if(document.getElementById("matchDetail"))initMatch();

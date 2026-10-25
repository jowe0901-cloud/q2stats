import {getDatabase} from '@netlify/database';
import {randomUUID} from 'node:crypto';
import {readPoll,vote} from './rating-poll-core.mjs';
const cookieName='__Host-q2stats-poll';
export function getVoter(request){
 const value=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||'')?value:null;
}
export default async request=>{
 const reply=(status,body,cookie)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Cookie',...(cookie?{'Set-Cookie':`${cookieName}=${cookie}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`}:{})}});
 if(!['GET','POST'].includes(request.method))return reply(405,{error:'Method not allowed'});
 const known=getVoter(request),voter=known||randomUUID();
 if(request.method==='POST'){
  if(request.headers.get('origin')!==new URL(request.url).origin)return reply(403,{error:'Please vote from the Q2Stats website.'});
  if(!known)return reply(400,{error:'Please enable cookies, reload the page and try again.'});
  if(!(request.headers.get('content-type')||'').includes('application/json'))return reply(415,{error:'JSON required'});
 }
 let client;
 try{
  let body;
  if(request.method==='POST'){try{body=JSON.parse(await request.text());}catch{return reply(400,{error:'Invalid request'});}if(!body||typeof body!=='object')return reply(400,{error:'Invalid request'});}
  client=await getDatabase().pool.connect();
  const result=request.method==='GET'?{status:200,body:await readPoll(client,voter)}:await vote(client,voter,body.choice);
  return reply(result.status,result.body,known?null:voter);
 }catch(e){console.error('rating-poll',e);return reply(503,{error:'The poll is temporarily unavailable. Please try again later.'});}
 finally{client?.release();}
};
export const config={path:'/api/v1/rating-poll'};

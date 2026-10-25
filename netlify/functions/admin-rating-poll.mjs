import {getDatabase} from '@netlify/database';
import {POLL_ID,readPoll} from './rating-poll-core.mjs';
export default async request=>{
 const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(!process.env.Q2STATS_ADMIN_KEY||request.headers.get('x-q2stats-admin-key')!==process.env.Q2STATS_ADMIN_KEY)return reply(401,{error:'Unauthorized'});
 if(!['GET','POST'].includes(request.method))return reply(405,{error:'Method not allowed'});
 let client;
 try{
  let body;if(request.method==='POST'){body=await request.json().catch(()=>null);if(typeof body?.is_open!=='boolean')return reply(400,{error:'is_open must be true or false'});}
  client=await getDatabase().pool.connect();
  if(body)await client.query('UPDATE q2stats_polls SET is_open=$2 WHERE id=$1',[POLL_ID,body.is_open]);
  return reply(200,await readPoll(client,'00000000-0000-4000-8000-000000000000',true));
 }catch(e){console.error('admin-rating-poll',e);return reply(503,{error:'Poll unavailable'});}finally{client?.release();}
};
export const config={path:'/api/admin/rating-poll'};

import {getDatabase} from '@netlify/database';
import {rebuildRatings} from './rating-service.mjs';
export default async req=>{
 const json=(status,body)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
 if(!process.env.Q2STATS_ADMIN_KEY||req.headers.get('x-q2stats-admin-key')!==process.env.Q2STATS_ADMIN_KEY)return json(401,{status:'error',error:'Unauthorized'});
 if(req.method!=='POST')return json(405,{status:'error',error:'Method not allowed'});
 if(req.headers.get('x-q2stats-confirm')!=='REBUILD_ALL_ELO')return json(400,{status:'error',error:'Missing rebuild confirmation'});
 const model=new URL(req.url).searchParams.get('model')||'glicko';if(!['glicko','legacy'].includes(model))return json(400,{status:'error',error:'Invalid model'});
 try{return json(200,await rebuildRatings(getDatabase(),model))}catch(e){console.error(e);return json(500,{status:'error',error:String(e.message||e)})}
};
export const config={path:'/api/admin/elo-rebuild'};

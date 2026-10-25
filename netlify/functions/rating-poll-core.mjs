export const POLL_ID='rating-system-2026-10';
export const OPTIONS=Object.freeze(['Better than the previous system','About the same','I preferred the previous system','Neither system is good']);
export function validChoice(value){return Number.isInteger(value)&&value>=0&&value<OPTIONS.length;}
export async function readPoll(client,voter,admin=false){
 const state=(await client.query('SELECT is_open FROM q2stats_polls WHERE id=$1',[POLL_ID])).rows[0];
 if(!state)throw Error('Poll migration is not installed');
 const rows=(await client.query('SELECT choice,COUNT(*)::int AS votes,BOOL_OR(voter_id=$2::uuid) AS mine FROM q2stats_poll_votes WHERE poll_id=$1 GROUP BY choice ORDER BY choice',[POLL_ID,voter])).rows;
 const mine=rows.find(r=>r.mine),voted=!!mine;
 const result={question:'What do you think of the new rating system?',is_open:state.is_open,voted,choice:voted?Number(mine.choice):null,options:OPTIONS};
 if(voted||admin){result.counts=OPTIONS.map((_,i)=>Number(rows.find(r=>Number(r.choice)===i)?.votes||0));result.total=result.counts.reduce((a,b)=>a+b,0);}
 return result;
}
export async function vote(client,voter,choice){
 if(!validChoice(choice))return {status:400,body:{error:'Choose one of the four options.'}};
 await client.query('BEGIN');
 try{
  const state=(await client.query('SELECT is_open FROM q2stats_polls WHERE id=$1 FOR UPDATE',[POLL_ID])).rows[0];
  if(!state)throw Error('Poll migration is not installed');
  if(!state.is_open){await client.query('ROLLBACK');return {status:409,body:{error:'This poll is closed.'}};}
  await client.query('INSERT INTO q2stats_poll_votes(poll_id,voter_id,choice) VALUES($1,$2,$3) ON CONFLICT(poll_id,voter_id) DO NOTHING',[POLL_ID,voter,choice]);
  const result=await readPoll(client,voter);
  await client.query('COMMIT');
  return {status:200,body:result};
 }catch(e){await client.query('ROLLBACK');throw e;}
}

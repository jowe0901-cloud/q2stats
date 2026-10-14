// Verify ONLY the exact MVD2 filename supplied by OpenTDM; never infer by timestamps.
const SERVERS = {
  'PacketFlinger.com ~ OpenTDM ~ Germany': { archive: 'https://pfl.gr/mvd/de/', prefix: 'PFDE' },
  'PacketFlinger.com ~ OpenTDM ~ Germany #3': { archive: 'https://pfl.gr/mvd/de3/', prefix: 'PFDE3' }
};
const respond = (body) => ({statusCode:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify(body)});
export async function handler(event){
 const q=event.queryStringParameters||{};
 const server=SERVERS[q.server];
 const filename=q.filename||'';
 if(!server || !new RegExp(`^${server.prefix}_[0-9]{8}-[0-9]{6}_[a-z0-9_-]+\\.mvd2$`,'i').test(filename))
  return respond({demo:null,reason:'invalid_server_or_filename'});
 const url=server.archive+encodeURIComponent(filename);
 try{
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),6000);
  try{
   // Require exact filename to appear in the archive directory index.
   const r=await fetch(server.archive,{signal:controller.signal,headers:{accept:'text/html'}});
   if(!r.ok)return respond({demo:null,reason:'archive_unavailable'});
   const html=await r.text();
   const escaped=filename.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   const found=new RegExp(`(?:href=["']?[^"'<>]*\\/)?${escaped}(?=["'<>\\s?])`,'i').test(html);
   return respond({demo:found?url:null,reason:found?'exact_match':'not_in_archive'});
  }finally{clearTimeout(timeout)}
 }catch{return respond({demo:null,reason:'archive_unavailable'})}
}

import {SOURCES,SECTORS,readSource} from "./sources.js";
import {sendOneSignal} from "./push.js";
const seconds=n=>Math.floor(n/1000);
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const enabled=e=>e.PUSH_ENABLED==="true"&&!!(e.ONESIGNAL_APP_ID&&e.ONESIGNAL_REST_API_KEY);
const query=(e,statement,...args)=>e.DB.prepare(statement).bind(...args);
const msg=e=>String(e?.message||e).slice(0,160);
export async function getStatuses(env,time=Date.now()){
 const rows=(await env.DB.prepare("SELECT * FROM feed_state").all()).results||[];
 const map=new Map(rows.map(r=>[r.source,r]));
 return SOURCES.map(s=>{
  const r=map.get(s.id);let status=r?.status||"unavailable";
  if(status==="live"&&(!r.last_success||seconds(time)-r.last_success>1800))status="stale";
  return {id:s.id,name:s.name,scope:s.scope,page:s.page,status,
    checkedAt:r?.checked_at?r.checked_at*1000:null,
    lastSuccess:r?.last_success?new Date(r.last_success*1000).toISOString():null,
    count:null,error:r?.last_error||null};
 });
}
export async function ingest(env,source,fetcher=fetch,time=Date.now()){
 const stamp=seconds(time);
 const old=await query(env,"SELECT last_success FROM feed_state WHERE source=?",source.id).first();
 try{
  const records=await readSource(source,fetcher);
  const baseline=!old?.last_success;
  const ops=records.map(r=>{
   const happened=seconds(Date.parse(r.date));
   const canPush=!baseline&&enabled(env)&&["critical","high"].includes(r.severity)&&
      happened<=stamp&&stamp-happened<=1200;
   return query(env,
    "INSERT INTO incidents (id,source,category,severity,title,summary,happened_at,location,url,lat,lon,first_seen,last_seen,notify_status,notify_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen",
    r.id,r.source,r.category,r.severity,r.title,r.summary,happened,r.location,r.url,
    r.coords?.lat??null,r.coords?.lon??null,stamp,stamp,canPush?"pending":"skipped",crypto.randomUUID());
  });
  if(ops.length)await env.DB.batch(ops);
  await query(env,"INSERT INTO feed_state(source,status,checked_at,last_success,last_error) VALUES (?,'live',?,?,NULL) ON CONFLICT(source) DO UPDATE SET status='live',checked_at=excluded.checked_at,last_success=excluded.last_success,last_error=NULL",source.id,stamp,stamp).run();
  return {source:source.id,status:"live",count:records.length,baseline};
 }catch(e){
  await query(env,"INSERT INTO feed_state(source,status,checked_at,last_success,last_error) VALUES (?,'unavailable',?,NULL,?) ON CONFLICT(source) DO UPDATE SET status=CASE WHEN feed_state.last_success IS NOT NULL THEN 'stale' ELSE 'unavailable' END,checked_at=excluded.checked_at,last_error=excluded.last_error",source.id,stamp,msg(e)).run();
  return {source:source.id,status:old?.last_success?"stale":"unavailable",error:msg(e)};
 }
}
export async function dispatch(env,fetcher=fetch,time=Date.now()){
 if(!enabled(env))return {configured:false,sent:0};
 const stamp=seconds(time);
 await query(env,"UPDATE incidents SET notify_status='retry' WHERE notify_status='sending' AND notify_checked_at<?",stamp-600).run();
 await query(env,"UPDATE incidents SET notify_status='expired' WHERE notify_status IN ('pending','retry') AND happened_at<?",stamp-1200).run();
 const rows=(await query(env,"SELECT * FROM incidents WHERE notify_status IN ('pending','retry') AND notify_attempts<3 AND happened_at>=? ORDER BY first_seen ASC LIMIT 2",stamp-1200).all()).results||[];
 let sent=0;
 for(const row of rows){
  const claim=await query(env,"UPDATE incidents SET notify_status='sending',notify_attempts=notify_attempts+1,notify_checked_at=? WHERE id=? AND notify_status IN ('pending','retry')",stamp,row.id).run();
  if(!claim.meta?.changes)continue;
  try{
   const outcome=await sendOneSignal(env,row,fetcher);
   const status=outcome.status==="accepted"?"sent":"skipped";
   await query(env,"UPDATE incidents SET notify_status=?,notified_at=?,notify_last_error=NULL WHERE id=?",status,stamp,row.id).run();
   if(status==="sent")sent++;
  }catch(e){
   await query(env,"UPDATE incidents SET notify_status=CASE WHEN notify_attempts>=3 THEN 'failed' ELSE 'retry' END,notify_last_error=? WHERE id=?",msg(e),row.id).run();
  }
 }
 return {configured:true,sent};
}
export async function tick(env,time=Date.now(),fetcher=fetch){
 if(!env.DB)throw Error("D1 not configured");
 const index=Math.floor(time/60000)%SOURCES.length;
 const result=await ingest(env,SOURCES[index],fetcher,time);
 const notifications=await dispatch(env,fetcher,time);
 if(Math.floor(time/60000)%1440===0)await query(env,"DELETE FROM incidents WHERE last_seen<?",seconds(time)-30*86400).run();
 return {result,notifications};
}
export async function handleAPI(request,env){
 const path=new URL(request.url).pathname;
 if(request.method!=="GET")return json({error:"Method not allowed"},405);
 if(path==="/api/push/config")return json({provider:"onesignal",appId:env.ONESIGNAL_APP_ID||null,
  configured:enabled(env),nearby:false,grouped:true,
  note:"Notifications use five grouped categories. Nearby targeting is not yet available."});
 if(!env.DB)return json({error:"D1 database not configured"},503);
 try{
  if(path==="/api/status"){
   const sources=await getStatuses(env);
   return json({app:"WATCHTOWER",time:new Date().toISOString(),
    sources,push:{configured:enabled(env),persistent:true},provider:"cloudflare"});
  }
  if(path==="/api/alerts"){
   const [records,sources]=await Promise.all([
    query(env,"SELECT id,source,category,severity,title,summary,happened_at,location,url,lat,lon FROM incidents ORDER BY happened_at DESC LIMIT 240").all(),
    getStatuses(env)
   ]);
   const sm=new Map(sources.map(x=>[x.id,x.status]));
   const alerts=(records.results||[]).map(r=>({
    id:r.id,source:r.source,category:r.category,severity:r.severity,title:r.title,summary:r.summary,
    date:new Date(r.happened_at*1000).toISOString(),location:r.location,url:r.url,
    coords:r.lat==null||r.lon==null?null:{lat:r.lat,lon:r.lon},feedStatus:sm.get(r.source)||"unavailable"
   }));
   const coverage=Object.fromEntries(Object.entries(SECTORS).map(([name,c])=>{
    const related=c.sources.map(id=>sources.find(s=>s.id===id)).filter(Boolean);
    const live=related.filter(s=>s.status==="live").length;
    return [name,{kind:c.kind,status:live?"available":related.some(s=>s.status==="stale")?"stale":"unavailable",
     responding:live,total:related.length,note:c.note,links:related.map(s=>({title:s.name,url:s.page}))}];
   }));
   return json({generatedAt:new Date().toISOString(),alerts,sources,coverage,
    disclaimer:"Limited coverage. An empty dashboard is NOT an all-clear; always follow official emergency warnings."});
  }
  return json({error:"Not found"},404);
 }catch{return json({error:"Storage unavailable. No current safety status can be verified."},503);}
}
export default {
 async fetch(request,env){
  if(new URL(request.url).pathname.startsWith("/api/"))return handleAPI(request,env);
  return env.ASSETS.fetch(request);
 },
 async scheduled(event,env,ctx){
  ctx.waitUntil(tick(env,event.scheduledTime||Date.now())
   .then(x=>console.log("WATCHTOWER_TICK "+JSON.stringify(x)))
   .catch(e=>console.error("WATCHTOWER_TICK_ERROR "+msg(e))));
 }
};

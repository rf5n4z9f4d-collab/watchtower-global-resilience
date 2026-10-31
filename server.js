import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PUBLIC=path.join(ROOT,'public');
const PORT=Number(process.env.PORT||3000);
const CACHE_MS=240000;
const cache=new Map();
const sources=[
 {id:'usgs',name:'USGS Earthquakes',scope:'Worldwide',url:'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',page:'https://earthquake.usgs.gov/earthquakes/map/',type:'json'},
 {id:'gdacs',name:'GDACS Disaster Alerts',scope:'Worldwide',url:'https://www.gdacs.org/xml/rss.xml',page:'https://www.gdacs.org/',type:'xml'},
 {id:'nws',name:'National Weather Service',scope:'United States',url:'https://api.weather.gov/alerts/active',page:'https://www.weather.gov/',type:'json'},
 {id:'swpc',name:'NOAA Space Weather',scope:'Global',url:'https://services.swpc.noaa.gov/products/alerts.json',page:'https://www.swpc.noaa.gov/',type:'json'},
 {id:'fda',name:'FDA Food Recalls',scope:'United States',url:'https://api.fda.gov/food/enforcement.json?search=status%3A%22Ongoing%22&sort=report_date%3Adesc&limit=35',page:'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts',type:'json'},
 {id:'cisa',name:'CISA Known Exploited Vulnerabilities',scope:'Technology worldwide',url:'https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json',page:'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',type:'json'},
 {id:'state',name:'U.S. State Department Travel Advisories',scope:'Worldwide travel safety',url:'https://travel.state.gov/_res/rss/TAsTWs.xml',page:'https://travel.state.gov/en/international-travel/travel-advisories.html',type:'xml'},
 {id:'cdc_travel',name:'CDC Travel Health Notices',scope:'Worldwide public-health travel risks',url:'https://wwwnc.cdc.gov/travel/rss/notices.xml',page:'https://wwwnc.cdc.gov/travel/notices',type:'xml'}
];
const cleaned=x=>String(x??'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
const date=x=>{const d=new Date(x);return Number.isNaN(d.getTime())?null:d.toISOString();};
const geo=(lat,lon)=>lat!=null&&lon!=null&&String(lat).trim()!==''&&String(lon).trim()!==''&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lon))&&Math.abs(Number(lat))<=90&&Math.abs(Number(lon))<=180?{lat:Number(lat),lon:Number(lon)}:null;
const https=(value,base)=>{try{let u=new URL(value);return u.protocol==='https:'?u.href:base;}catch{return base;}};
function item(id,source,category,severity,title,summary,time,location,link,coords=null,geometry=null){
 const s=sources.find(x=>x.id===source);
 return {id:String(id),source,category,severity,title:cleaned(title).slice(0,190),summary:cleaned(summary).slice(0,380),date:date(time),location:cleaned(location).slice(0,110),url:https(link,s.page),coords,geometry};
}
const tag=(s,name)=>{const m=s.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'));return m?cleaned(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')):'';};
function transform(s,v){
 if(s==='usgs') return (v.features||[]).slice(0,130).filter(f=>Number(f.properties?.mag)>=4.5).map(f=>{
  const p=f.properties,m=Number(p.mag),tsunami=Number(p.tsunami)===1;
  return item('usgs-'+f.id,'usgs','Earthquake',m>=7?'critical':m>=6?'high':'moderate','M'+m.toFixed(1)+' — '+p.place,'Recorded earthquake'+(tsunami?'; USGS tsunami flag present':'')+'. No infrastructure damage is confirmed by this record.',p.time,p.place,p.url,geo(f.geometry?.coordinates?.[1],f.geometry?.coordinates?.[0]));
 });
 if(s==='gdacs') return [...v.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,100).map(([_,x],i)=>{
  const code=tag(x,'gdacs:eventtype'),color=tag(x,'gdacs:alertlevel').toLowerCase();
  const category=code==='EQ'?'Earthquake':'Climate & disasters';
  const g=tag(x,'georss:point').split(' ');
  return item('gdacs-'+code+'-'+(tag(x,'gdacs:eventid')||tag(x,'guid')||i),'gdacs',category,color==='red'?'critical':color==='orange'?'high':'advisory',tag(x,'title'),tag(x,'description')+' (GDACS ranks potential humanitarian impact, not confirmed infrastructure damage.)',tag(x,'pubDate')||tag(x,'dc:date'),tag(x,'gdacs:country')||'Worldwide',tag(x,'link'),geo(tag(x,'geo:lat')||g[0],tag(x,'geo:long')||g[1]));
 }).filter(x=>x.title&&x.date);
 if(s==='state')return [...v.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,120).map(([_,x],i)=>{
  const title=tag(x,'title'), level=Number((title.match(/Level\s+([1-4])/i)||[])[1]||0);
  const location=title.replace(/\s*[-–]\s*Level\s+[1-4].*$/i,'').trim()||'International travel';
  return item('state-'+(tag(x,'guid')||tag(x,'link')||i),'state','Military & security',level>=3?'moderate':'advisory',
   'Travel safety advisory — '+title,
   'U.S. State Department travel advisory (not a military incident, military alert, or confirmed infrastructure outage). '+tag(x,'description').slice(0,200),
   tag(x,'pubDate')||tag(x,'dc:date'),location,tag(x,'link'));
 }).filter(x=>x.title&&x.date);
 if(s==='cdc_travel')return [...v.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,100).map(([_,x],i)=>{
  const title=tag(x,'title'), level=Number((title.match(/Level\s+([1-4])/i)||[])[1]||0);
  return item('cdc-'+(tag(x,'guid')||tag(x,'link')||i),'cdc_travel','Healthcare',level>=4?'moderate':'advisory',
   'Travel health notice — '+title,
   'CDC travel health notice (not a confirmed hospital disruption). '+tag(x,'description').slice(0,220),
   tag(x,'pubDate')||tag(x,'dc:date'),title.replace(/^Level\s+[1-4]\s*[-–]\s*/i,'').slice(0,110),tag(x,'link'));
 }).filter(x=>x.title&&x.date);
 if(s==='nws')return (v.features||[]).filter(f=>!f.properties?.status||f.properties.status==='Actual').filter(f=>['Extreme','Severe','Moderate'].includes(f.properties?.severity)).slice(0,140).map(f=>{
  const p=f.properties;
  const text=(p.event+' '+p.headline+' '+p.description).toLowerCase();
  const category=/boil water|drinking water|water contamination/.test(text)?'Water':/911|phone outage|emergency communications/.test(text)?'Communications':'Climate & disasters';
  return item('nws-'+(p.id||f.id),'nws',category,p.severity==='Extreme'?'critical':p.severity==='Severe'?'high':'moderate',p.headline||p.event+' — '+p.areaDesc,p.description||p.event,p.sent||p.effective,p.areaDesc||'United States',p.id,null,f.geometry);
 });
 if(s==='swpc')return (Array.isArray(v)?v:[]).filter(p=>/WARNING|WATCH|ALERT/.test(p.message||'')&&/geomagnetic|radio blackout|solar radiation|GPS|solar flare/i.test(p.message||'')).slice(-25).map((p,i)=>{
  const msg=p.message||'',grade=(msg.match(/\b[GRS][1-5]\b/)||[])[0]||'';
  const severity=/[45]$/.test(grade)?'high':/[23]$/.test(grade)?'moderate':'advisory';
  const category=/radio blackout|GPS/i.test(msg)?'Communications':'Power & energy';
  return item('swpc-'+p.product_id+'-'+p.issue_datetime+'-'+i,'swpc',category,severity,msg.split('\n').find(x=>/WARNING|WATCH|ALERT/.test(x))||'Space-weather bulletin',msg.slice(0,330)+' (Potential effects, not a confirmed outage.)',String(p.issue_datetime||'').replace(' ','T')+'Z','Potentially global','https://www.swpc.noaa.gov/products/alerts-watches-and-warnings');
 }).filter(x=>x.date&&Date.now()-Date.parse(x.date)<5*86400000);
 if(s==='fda')return (v.results||[]).slice(0,35).filter(p=>p.status!=='Terminated').map(p=>{
  return item('fda-'+(p.recall_number||p.event_id),'fda','Food & supply',p.classification==='Class I'?'high':'moderate',p.classification+' recall — '+p.product_description,p.reason_for_recall+' (Product recall, not evidence of a food shortage.)',String(p.report_date).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),p.distribution_pattern||p.state||'United States','https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts');
 });
 if(s==='cisa')return (v.vulnerabilities||[]).filter(p=>Date.now()-Date.parse(p.dateAdded+'T00:00:00Z')<21*86400000).slice(-45).reverse().map(p=>
  item('cisa-'+p.cveID,'cisa','Cyber & data','advisory','Known exploited vulnerability — '+p.vendorProject+' '+p.product,p.shortDescription+' (This does not confirm a breach.)',p.dateAdded,'Technology worldwide','https://www.cisa.gov/known-exploited-vulnerabilities-catalog')
 );
 return [];
}
function validateFeed(s,raw){
 if(s.type==='xml'){
  if(typeof raw!=='string'||!/<rss\b/i.test(raw)||!/<channel\b/i.test(raw)||!/<\/channel>/i.test(raw))throw Error('Unexpected XML feed format');
  return;
 }
 const arrays={usgs:'features',nws:'features',fda:'results',cisa:'vulnerabilities'};
 if(s.id==='swpc'&&!Array.isArray(raw))throw Error('Unexpected space-weather feed format');
 if(arrays[s.id]&&!Array.isArray(raw?.[arrays[s.id]]))throw Error('Unexpected JSON feed format');
}
async function pull(s,force=false){
 const old=cache.get(s.id);
 if(!force&&old&&Date.now()-old.checkedAt<CACHE_MS)return old;
 try{
  const response=await fetch(s.url,{headers:{'User-Agent':'WATCHTOWER resilience-monitor (information dashboard)','Accept':'application/json, application/xml, */*'},signal:AbortSignal.timeout(16000)});
  if(!response.ok)throw Error('Upstream HTTP '+response.status);
  const raw=s.type==='xml'?await response.text():await response.json();
  validateFeed(s,raw);
  const entries=transform(s.id,raw);
  const state={id:s.id,name:s.name,scope:s.scope,checkedAt:Date.now(),lastSuccess:new Date().toISOString(),status:'live',count:entries.length,entries};
  cache.set(s.id,state);return state;
 }catch(e){
  const state={id:s.id,name:s.name,scope:s.scope,checkedAt:Date.now(),lastSuccess:old?.lastSuccess||null,status:old?.lastSuccess?'stale':'unavailable',count:old?.count||0,entries:old?.entries||[],error:String(e.message)};
  cache.set(s.id,state);return state;
 }
}
const sectorDescriptions={
 'Earthquake':{sourceIds:['usgs','gdacs'],kind:'incident',note:'USGS earthquake reports and GDACS disaster evaluations. These do not verify infrastructure damage.',links:[{title:'USGS',url:'https://earthquake.usgs.gov/earthquakes/map/'}]},
 'Climate & disasters':{sourceIds:['gdacs','nws'],kind:'incident',note:'Global disaster signals plus severe U.S. weather warnings; global weather coverage is incomplete.',links:[{title:'GDACS',url:'https://www.gdacs.org/'}]},
 'Power & energy':{sourceIds:['swpc'],kind:'related',note:'Space-weather risks to power systems only. Not a feed of verified grid failures or utility outages.',links:[{title:'NOAA SWPC',url:'https://www.swpc.noaa.gov/'}]},
 'Food & supply':{sourceIds:['fda'],kind:'related',note:'FDA food product recalls, not supply chain disruptions or food shortages.',links:[{title:'FDA Recalls',url:'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts'}]},
 'Communications':{sourceIds:['swpc','nws'],kind:'related',note:'Potential radio, GPS, and severe-weather communication impacts only. No dedicated 911 outage feed.',links:[{title:'FCC Emergency',url:'https://www.fcc.gov/emergency'}]},
 'Cyber & data':{sourceIds:['cisa'],kind:'related',note:'Actively exploited vulnerabilities, not proof of active attacks, infrastructure compromises, or information leaks.',links:[{title:'CISA',url:'https://www.cisa.gov/news-events/cybersecurity-advisories'}]},
 'Water':{sourceIds:['nws'],kind:'limited',note:'Only some U.S. weather bulletins mentioning water safety. No comprehensive contamination, boil-water or treatment-plant outage feed.',links:[{title:'EPA',url:'https://www.epa.gov/ground-water-and-drinking-water'}]},
 'Healthcare':{sourceIds:['cdc_travel'],kind:'related',note:'CDC travel health notices, not hospital shutdowns, patient-care interruptions or hospital cyber incidents.',links:[{title:'CDC Health Alert Network',url:'https://www.cdc.gov/han/index.html'}]},
 'Military & security':{sourceIds:['state'],kind:'related',note:'U.S. State Department international travel-safety advisories. No live military operation, mobilization, or conflict incident feed is connected.',links:[{title:'DHS National Terrorism Advisory System',url:'https://www.dhs.gov/national-terrorism-advisory-system'},{title:'State Department',url:'https://travel.state.gov/en/international-travel/travel-advisories.html'}]},
 'Humanitarian':{sourceIds:['gdacs'],kind:'related',note:'GDACS disaster-impact estimates; not comprehensive conflict, migration, or humanitarian emergency reporting.',links:[{title:'ReliefWeb',url:'https://reliefweb.int/'}]}
};
function getCoverage(states){
 const byId=new Map(states.map(x=>[x.id,x]));
 return Object.fromEntries(Object.entries(sectorDescriptions).map(([sector,info])=>{
  const feeds=info.sourceIds.map(id=>byId.get(id)).filter(Boolean);
  const responding=feeds.filter(x=>x.status==='live').length;
  return [sector,{kind:info.kind,status:responding>0?'available':feeds.some(x=>x.status==='stale')?'stale':'unavailable',responding,total:info.sourceIds.length,note:info.note,links:info.links}];
 }));
}

const fetchAll=force=>Promise.all(sources.map(s=>pull(s,force)));
let webpush=null,db=null,ready=false,lastCheck=null,lastWorkerError=null,seen=null;
const testTimestamps=new Map();
const rank={advisory:0,moderate:1,high:2,critical:3};
const categories=['Earthquake','Climate & disasters','Power & energy','Food & supply','Communications','Cyber & data','Water','Healthcare','Military & security','Humanitarian'];
async function initPush(){
 if(!process.env.DATABASE_URL||!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY||!process.env.VAPID_SUBJECT)return;
 try{
  const pg=(await import('pg')).default;
  webpush=(await import('web-push')).default;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  db=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='disable'?false:{rejectUnauthorized:true},max:4});
  await db.query('CREATE TABLE IF NOT EXISTS wt_subscriptions(endpoint TEXT PRIMARY KEY,p256dh TEXT NOT NULL,auth TEXT NOT NULL,prefs JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  await db.query('CREATE TABLE IF NOT EXISTS wt_deliveries(endpoint TEXT NOT NULL,alert_id TEXT NOT NULL,sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(endpoint,alert_id))');
  ready=true;
 }catch(e){lastWorkerError='Push storage/credentials initialization failed';console.error('[push]',e.message);ready=false;}
}
function near(a,p){
 if(p.mode!=='nearby')return true;
 if(a.source==='swpc')return true;
 if(!a.coords)return false;
 const d=Math.PI/180,dl=(a.coords.lon-p.lon)*d,dp=(a.coords.lat-p.lat)*d;
 const h=Math.sin(dp/2)**2+Math.cos(p.lat*d)*Math.cos(a.coords.lat*d)*Math.sin(dl/2)**2;
 return 6371*2*Math.asin(Math.min(1,Math.sqrt(h)))<=p.radiusKm;
}
const matches=(a,p)=>p.categories.includes(a.category)&&rank[a.severity]>=rank[p.minSeverity]&&near(a,p);
function validPrefs(p){
 if(!p||!Array.isArray(p.categories))throw Error('Choose alert categories');
 const selected=p.categories.filter(x=>categories.includes(x));
 if(!selected.length)throw Error('Choose at least one monitored category');
 const mode=p.mode==='nearby'?'nearby':'global';
 const lat=Number(p.lat),lon=Number(p.lon);
 if(mode==='nearby'&&(p.lat==null||p.lon==null||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180))throw Error('Nearby alerts require a valid location');
 return {categories:selected,minSeverity:['critical','high','moderate'].includes(p.minSeverity)?p.minSeverity:'high',mode,lat:mode==='nearby'?lat:null,lon:mode==='nearby'?lon:null,radiusKm:[50,100,250,500].includes(Number(p.radiusKm))?Number(p.radiusKm):100};
}
function validSub(s){
 if(!s||typeof s.endpoint!=='string'||s.endpoint.length>2048||!s.endpoint.startsWith('https://')||typeof s.keys?.p256dh!=='string'||typeof s.keys?.auth!=='string'||s.keys.p256dh.length>512||s.keys.auth.length>512)throw Error('Invalid browser subscription');
 return s;
}
async function worker(){
 if(!ready)return;
 try{
  const states=await fetchAll(true);
  const alerts=states.filter(s=>s.status==='live').flatMap(s=>s.entries);
  const newSeen=new Set(alerts.map(a=>a.id));
  if(seen===null){seen=newSeen;lastCheck=new Date().toISOString();return;}
  const fresh=alerts.filter(a=>!seen.has(a.id)&&a.date&&Date.now()-Date.parse(a.date)>=0&&Date.now()-Date.parse(a.date)<1200000);
  seen=newSeen;lastCheck=new Date().toISOString();
  if(!fresh.length)return;
  const users=(await db.query('SELECT endpoint,p256dh,auth,prefs,created_at FROM wt_subscriptions')).rows;
  for(const u of users){
   let sends=Number((await db.query("SELECT count(*)::int n FROM wt_deliveries WHERE endpoint=$1 AND sent_at>now()-interval '24 hours'",[u.endpoint])).rows[0].n);
   for(const a of fresh){
    if(sends>=20)break;
    if(!matches(a,u.prefs)||Date.parse(a.date)<Date.parse(u.created_at))continue;
    const duplicate=await db.query('SELECT 1 FROM wt_deliveries WHERE endpoint=$1 AND alert_id=$2',[u.endpoint,a.id]);
    if(duplicate.rowCount)continue;
    try {
     await webpush.sendNotification({endpoint:u.endpoint,keys:{p256dh:u.p256dh,auth:u.auth}},JSON.stringify({title:'WATCHTOWER · '+a.severity.toUpperCase(),body:a.title,url:'/#alerts',tag:'watchtower-'+a.id}),{TTL:1800,urgency:'high'});
     await db.query('INSERT INTO wt_deliveries(endpoint,alert_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[u.endpoint,a.id]);sends++;
    }catch(e){if([404,410].includes(e.statusCode))await db.query('DELETE FROM wt_subscriptions WHERE endpoint=$1',[u.endpoint]);else console.error('[push delivery]',e.message);}
   }
  }
  await db.query("DELETE FROM wt_deliveries WHERE sent_at<now()-interval '30 days'");
  lastWorkerError=null;
 }catch(e){lastWorkerError='Monitoring worker experienced an error';console.error('[worker]',e.message);}
}
function respond(res,status,payload){
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(payload));
}
async function getJson(req){
 const chunks=[];let n=0;
 for await(const c of req){n+=c.length;if(n>10000)throw Error('Request too large');chunks.push(c);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function handle(req,res){
 try{
  const u=new URL(req.url||'/', 'http://localhost:'+PORT);
  if(req.method==='GET'&&u.pathname==='/api/status')return respond(res,200,{app:'WATCHTOWER',time:new Date().toISOString(),push:{configured:ready,persistent:ready,lastCheck,lastWorkerError},sources:sources.map(({id,name,scope,page})=>({id,name,scope,page}))});
  if(req.method==='GET'&&u.pathname==='/api/alerts'){
   const states=await fetchAll(false);
   const alerts=states.flatMap(s=>s.entries.map(({geometry,...a})=>({...a,feedStatus:s.status}))).sort((a,b)=>Date.parse(b.date||0)-Date.parse(a.date||0));
   return respond(res,200,{generatedAt:new Date().toISOString(),alerts,coverage:getCoverage(states),sources:states.map(({id,name,scope,status,count,lastSuccess,error})=>({id,name,scope,status,count,lastSuccess,error})),disclaimer:'This dashboard does not cover all hazards. Records may be delayed, duplicated, or unrelated to actual infrastructure outages. It is not an emergency warning system.'});
  }
  if(req.method==='GET'&&u.pathname==='/api/push/config')return respond(res,200,{configured:ready,persistent:ready,publicKey:ready?process.env.VAPID_PUBLIC_KEY:null});
  if(req.method==='POST'&&u.pathname.startsWith('/api/push/')){
   if(!ready)return respond(res,503,{error:'Phone alerts require persistent storage and configured server keys'});
   const origin=req.headers.origin;
   if(!origin||new URL(origin).host!==req.headers.host)return respond(res,403,{error:'Origin rejected'});
   const b=await getJson(req);
   if(u.pathname==='/api/push/subscribe'){
    const s=validSub(b.subscription),p=validPrefs(b.preferences);
    await db.query('INSERT INTO wt_subscriptions(endpoint,p256dh,auth,prefs) VALUES ($1,$2,$3,$4) ON CONFLICT(endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,prefs=EXCLUDED.prefs',[s.endpoint,s.keys.p256dh,s.keys.auth,p]);
    return respond(res,200,{ok:true});
   }
   if(u.pathname==='/api/push/unsubscribe'){
    if(typeof b.endpoint!=='string'||b.endpoint.length>2048)throw Error('Invalid endpoint');
    await db.query('DELETE FROM wt_subscriptions WHERE endpoint=$1',[b.endpoint]);return respond(res,200,{ok:true});
   }
   if(u.pathname==='/api/push/test'){
    if(typeof b.endpoint!=='string'||b.endpoint.length>2048)throw Error('Invalid endpoint');
    if(Date.now()-(testTimestamps.get(b.endpoint)||0)<3600000)throw Error('Test is limited to once per hour');
    const row=(await db.query('SELECT endpoint,p256dh,auth FROM wt_subscriptions WHERE endpoint=$1',[b.endpoint])).rows[0];
    if(!row)throw Error('Phone not subscribed');
    testTimestamps.set(b.endpoint,Date.now());
    await webpush.sendNotification({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify({title:'WATCHTOWER test',body:'Notifications are connected. This is only a test.',url:'/#alerts'}));
    return respond(res,200,{ok:true});
   }
   return respond(res,404,{error:'Endpoint not found'});
  }
  if(req.method!=='GET')return respond(res,405,{error:'Method not allowed'});
  const rel=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname).replace(/^\/+/,'');
  const file=path.resolve(PUBLIC,rel);
  if(!file.startsWith(PUBLIC+path.sep))return respond(res,403,{error:'Forbidden'});
  let data;try{data=await fs.readFile(file)}catch{return respond(res,404,{error:'Not found'});}
  const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'public,max-age=300','X-Content-Type-Options':'nosniff'});res.end(data);
 }catch(e){respond(res,400,{error:String(e.message).slice(0,130)});}
}
if(process.env.WT_TEST_MODE!=='1'){
 await initPush();
 const server=http.createServer(handle);
 server.listen(PORT,()=>console.log('WATCHTOWER listening on '+PORT));
 if(ready){worker();setInterval(worker,120000).unref();}
}
export {sources,geo,tag,transform,validateFeed,pull,getCoverage,near,matches,validPrefs,validSub,handle};

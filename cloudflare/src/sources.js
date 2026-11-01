export const SOURCES=[
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
 const s=SOURCES.find(x=>x.id===source);
 return {id:String(id),source,category,severity,title:cleaned(title).slice(0,190),summary:cleaned(summary).slice(0,380),date:date(time),location:cleaned(location).slice(0,110),url:https(link,s.page),coords,geometry};
}
const tag=(s,name)=>{const m=s.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'));return m?cleaned(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')):'';};
function transform(s,v){
 if(s==='usgs') return (v.features||[]).slice(0,25).filter(f=>Number(f.properties?.mag)>=4.5).map(f=>{
  const p=f.properties,m=Number(p.mag),tsunami=Number(p.tsunami)===1;
  return item('usgs-'+f.id,'usgs','Earthquake',m>=7?'critical':m>=6?'high':'moderate','M'+m.toFixed(1)+' — '+p.place,'Recorded earthquake'+(tsunami?'; USGS tsunami flag present':'')+'. No infrastructure damage is confirmed by this record.',p.time,p.place,p.url,geo(f.geometry?.coordinates?.[1],f.geometry?.coordinates?.[0]));
 });
 if(s==='gdacs') return [...v.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,25).map(([_,x],i)=>{
  const code=tag(x,'gdacs:eventtype'),color=tag(x,'gdacs:alertlevel').toLowerCase();
  const category=code==='EQ'?'Earthquake':'Climate & disasters';
  const g=tag(x,'georss:point').split(' ');
  return item('gdacs-'+code+'-'+(tag(x,'gdacs:eventid')||tag(x,'guid')||i),'gdacs',category,color==='red'?'critical':color==='orange'?'high':'advisory',tag(x,'title'),tag(x,'description')+' (GDACS ranks potential humanitarian impact, not confirmed infrastructure damage.)',tag(x,'pubDate')||tag(x,'dc:date'),tag(x,'gdacs:country')||'Worldwide',tag(x,'link'),geo(tag(x,'geo:lat')||g[0],tag(x,'geo:long')||g[1]));
 }).filter(x=>x.title&&x.date);
 if(s==='state')return [...v.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,25).map(([_,x],i)=>{
  const title=tag(x,'title'), level=Number((title.match(/Level\s+([1-4])/i)||[])[1]||0);
  const location=title.replace(/\s*[-–]\s*Level\s+[1-4].*$/i,'').trim()||'International travel';
  return item('state-'+(tag(x,'guid')||tag(x,'link')||i),'state','Military & security',level>=3?'moderate':'advisory',
   'Travel safety advisory — '+title,
   'U.S. State Department travel advisory (not a military incident, military alert, or confirmed infrastructure outage). '+tag(x,'description').slice(0,200),
   tag(x,'pubDate')||tag(x,'dc:date'),location,tag(x,'link'));
 }).filter(x=>x.title&&x.date);
 if(s==='cdc_travel')return [...v.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,25).map(([_,x],i)=>{
  const title=tag(x,'title'), level=Number((title.match(/Level\s+([1-4])/i)||[])[1]||0);
  return item('cdc-'+(tag(x,'guid')||tag(x,'link')||i),'cdc_travel','Healthcare',level>=4?'moderate':'advisory',
   'Travel health notice — '+title,
   'CDC travel health notice (not a confirmed hospital disruption). '+tag(x,'description').slice(0,220),
   tag(x,'pubDate')||tag(x,'dc:date'),title.replace(/^Level\s+[1-4]\s*[-–]\s*/i,'').slice(0,110),tag(x,'link'));
 }).filter(x=>x.title&&x.date);
 if(s==='nws')return (v.features||[]).filter(f=>!f.properties?.status||f.properties.status==='Actual').filter(f=>['Extreme','Severe','Moderate'].includes(f.properties?.severity)).slice(0,25).map(f=>{
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
 }).filter(x=>x.date&&Date.now()-Date.parse(x.date)>=0&&Date.now()-Date.parse(x.date)<5*86400000);
 if(s==='fda')return (v.results||[]).slice(0,25).filter(p=>p.status!=='Terminated').map(p=>{
  return item('fda-'+(p.recall_number||p.event_id),'fda','Food & supply',p.classification==='Class I'?'high':'moderate',p.classification+' recall — '+p.product_description,p.reason_for_recall+' (Product recall, not evidence of a food shortage.)',String(p.report_date).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),p.distribution_pattern||p.state||'United States','https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts');
 });
 if(s==='cisa')return (v.vulnerabilities||[]).filter(p=>{const age=Date.now()-Date.parse(p.dateAdded+'T00:00:00Z');return age>=0&&age<21*86400000;}).slice(-25).reverse().map(p=>
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

export const SECTORS={
 'Earthquake':{sources:['usgs','gdacs'],kind:'incident',note:'Earthquake records, not confirmed infrastructure damage.'},
 'Climate & disasters':{sources:['gdacs','nws'],kind:'incident',note:'GDACS global disasters and U.S. weather alerts; partial worldwide coverage.'},
 'Power & energy':{sources:['swpc'],kind:'related',note:'Space-weather risks, not verified grid outages.'},
 'Communications':{sources:['swpc','nws'],kind:'related',note:'Possible communications effects, not comprehensive 911 failures.'},
 'Water':{sources:['nws'],kind:'limited',note:'Some weather bulletins only; no global water outage feed.'},
 'Food & supply':{sources:['fda'],kind:'related',note:'FDA recalls, not food shortages.'},
 'Cyber & data':{sources:['cisa'],kind:'related',note:'Known exploited vulnerabilities, not confirmed incidents.'},
 'Healthcare':{sources:['cdc_travel'],kind:'related',note:'Travel health notices, not hospital failures.'},
 'Military & security':{sources:['state'],kind:'related',note:'Travel advisories, not live military alerts.'},
 'Humanitarian':{sources:['gdacs'],kind:'related',note:'GDACS disaster impact, not comprehensive humanitarian reporting.'}
};
export function parseSource(s,raw){
 validateFeed(s,raw);
 return transform(s.id,raw).filter(r=>r.id&&r.title&&r.date&&Date.parse(r.date)<=Date.now()+60_000).slice(0,25);
}
export async function readSource(s,fetcher=fetch){
 const res=await fetcher(s.url,{headers:{Accept:s.type==='xml'?'application/rss+xml':'application/json','User-Agent':'WATCHTOWER monitoring proof-of-concept'},signal:AbortSignal.timeout(16000)});
 if(!res.ok)throw Error('Upstream HTTP '+res.status);
 const max=1_500_000;
 if(Number(res.headers?.get?.('content-length')||0)>max)throw Error('Feed exceeds safety size cap');
 let raw;
 if(!res.body?.getReader){const str=await res.text();if(str.length>max)throw Error('Feed too large');raw=s.type==='xml'?str:JSON.parse(str);}
 else{
  const reader=res.body.getReader(),parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('Feed too large');parts.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
  const data=new TextDecoder().decode(bytes);raw=s.type==='xml'?data:JSON.parse(data);
 }
 return parseSource(s,raw);
}

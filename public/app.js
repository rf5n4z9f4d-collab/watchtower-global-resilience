const $=id=>document.getElementById(id);
const cats=['Earthquake','Climate & disasters','Power & energy','Food & supply','Communications','Cyber & data','Water','Healthcare','Military & security','Humanitarian'];
const guideLinks=[
 ['Power outages','https://www.eia.gov/electricity/','Energy data and power infrastructure'],
 ['Water systems','https://www.epa.gov/ground-water-and-drinking-water','EPA water resources'],
 ['Emergency communications','https://www.fcc.gov/emergency','FCC emergency communications'],
 ['Hospitals & public health','https://www.cdc.gov/','CDC public health information'],
 ['Cybersecurity alerts','https://www.cisa.gov/news-events/cybersecurity-advisories','CISA advisories'],
 ['Military & security','https://www.defense.gov/News/','Public defense news; not a global warning feed']
];
let alerts=[],states=[],coverage={},pushConfig={configured:false},currentSub=null,renderLimit=70,latestGenerated=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=x=>{if(!x)return 'Time not provided';let d=new Date(x);return Number.isNaN(d.getTime())?'Time not provided':d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};
const numeric=(x,d=1)=>Math.min(40,Math.max(1,Number.parseInt(x,10)||d));
const safeUrl=x=>{try{const u=new URL(x);return u.protocol==='https:'?u.href:'#';}catch{return '#';}};
$('coverageGaps').innerHTML=guideLinks.map(([title,link,detail])=>'<div class="source-row"><div><a href="'+safeUrl(link)+'" target="_blank" rel="noopener noreferrer">'+esc(title)+' ↗</a><small>'+esc(detail)+'</small></div><span class="state">Reference</span></div>').join('');
const stateText=s=>s==='live'?'Live':'Stale / delayed';
$('categoryFilter').innerHTML='<option value="all">All sectors</option>'+cats.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
$('categoryChecks').innerHTML=cats.map(c=>'<label><input type="checkbox" value="'+esc(c)+'" '+(['Earthquake','Climate & disasters','Power & energy','Communications'].includes(c)?'checked':'')+'>'+esc(c)+'</label>').join('');
const checkItems=['Drinking water stored','Nonperishable meals','Flashlight and spare batteries','First-aid kit and medications','Battery or hand-crank radio','Charging banks and cables','Printed contacts and meeting plan','Pet and baby supplies, if needed','Important documents backed up','Fuel and evacuation route planned'];
function readSaved(key,fallback){try{const value=localStorage.getItem(key);return value?JSON.parse(value):fallback;}catch{return fallback;}}
function writeSaved(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* Storage may be disabled by browser privacy settings. */}}
const rawChecks=readSaved('watchtower-prep',{});
const checks=rawChecks&&typeof rawChecks==='object'&&!Array.isArray(rawChecks)?rawChecks:{};
$('checkList').innerHTML=checkItems.map((v,i)=>'<label><input type="checkbox" data-key="'+i+'" '+(checks[i]?'checked':'')+'>'+esc(v)+'</label>').join('');
$('checkList').addEventListener('change',e=>{if(e.target.matches('input[data-key]')){checks[e.target.dataset.key]=e.target.checked;writeSaved('watchtower-prep',checks);}});
function calc(){const p=numeric($('people').value,2),d=Math.min(30,numeric($('days').value,7));$('waterCount').textContent=(p*d)+' gallons';$('mealCount').textContent=(p*d*3)+' meals';}
$('people').addEventListener('input',calc);$('days').addEventListener('input',calc);
for(const [field,cap,def] of [['people',40,2],['days',30,7]]){
 $(field).addEventListener('change',()=>{const value=Math.min(cap,numeric($(field).value,def));$(field).value=String(value);calc();});
}
calc();
function setSystem(live){
 $('systemStatus').textContent=live+'/'+(states.length||'—')+' responding feeds';document.querySelector('.dot').classList.toggle('good',states.length>0&&live===states.length);
}
function renderCoverage(cat,n) {
 const banner=$('sectorCoverage');
 if(cat==='all'){
  banner.hidden=false;
  banner.innerHTML='<div class="coverage-title"><span class="coverage-chip neutral">PARTIAL COVERAGE</span> Cross-sector monitoring</div><p>WATCHTOWER collects selected official reports and advisories. It is not a complete register of water, 911, hospital, military, food or power infrastructure incidents.</p>';
  return;
 }
 const c=coverage[cat];
 if(!c){banner.hidden=false;banner.innerHTML='<div class="coverage-title"><span class="coverage-chip poor">NO COVERAGE DATA</span> Coverage could not be verified</div><p>Source status is unavailable. Zero results must not be interpreted as safety.</p>';return;}
 const fullIncident=c.kind==='incident';
 const badge=c.status==='unavailable'?'SOURCES UNAVAILABLE':c.status==='stale'?'STALE SOURCES':fullIncident?'PARTIAL INCIDENT COVERAGE':c.kind==='limited'?'VERY LIMITED COVERAGE':'RELATED ADVISORIES ONLY';
 const tone=c.status==='unavailable'||c.status==='stale'?'poor':fullIncident?'partial':'neutral';
 const links=(c.links||[]).map(x=>'<a href="'+safeUrl(x.url)+'" target="_blank" rel="noopener noreferrer">'+esc(x.title)+' ↗</a>').join(' · ');
 banner.hidden=false;
 banner.innerHTML='<div class="coverage-title"><span class="coverage-chip '+tone+'">'+badge+'</span><strong>'+esc(cat)+'</strong></div>'+
 '<p>'+esc(c.note||'Only selected public reports are available.')+'</p>'+
 '<div class="coverage-extra"><span>Responding associated feeds: '+Number(c.responding||0)+'/'+Number(c.total||0)+'</span><span>Records matching current filters: '+n+'</span></div>'+
 '<div class="coverage-links">'+links+'</div>';
}
function render(){
 const live=states.filter(s=>s.status==='live').length;
 $('metricLive').textContent=live+'/'+(states.length||'—');$('sourceTotal').textContent=states.length||'—';
 $('metricTotal').textContent=alerts.length.toLocaleString();
 $('metricHigh').textContent=alerts.filter(a=>a.feedStatus==='live'&&['high','critical'].includes(a.severity)).length.toLocaleString();
 const checkTimes=states.map(s=>Number(s.checkedAt)).filter(t=>Number.isFinite(t)&&t>0);
 $('metricTime').textContent=checkTimes.length?new Date(Math.max(...checkTimes)).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Not verified';
 setSystem(live);
 $('sourceList').innerHTML=states.length?states.map(s=>'<div class="source-row"><div><a href="'+safeUrl((sourcePages[s.id]||{}).page)+'" target="_blank" rel="noopener noreferrer">'+esc(s.name)+'</a><small>'+esc(s.scope)+' · '+(s.count||0)+' records · '+(s.checkedAt?'Last attempt '+when(s.checkedAt):'No fetch attempt')+' · '+(s.lastSuccess?'Last success '+when(s.lastSuccess):'No successful fetch')+'</small></div><span class="state '+esc(s.status)+'">'+esc(s.status)+'</span></div>').join(''):'No feed statuses available.';
 const q=$('search').value.trim().toLowerCase(),cat=$('categoryFilter').value,sev=$('severityFilter').value,hrs=$('timeFilter').value;
 const levels={advisory:0,moderate:1,high:2,critical:3};
 const filtered=alerts.filter(a=>(cat==='all'||a.category===cat)&&(sev==='all'||levels[a.severity]>=levels[sev])&&(hrs==='all'||(a.date&&Date.now()-Date.parse(a.date)>=0&&Date.now()-Date.parse(a.date)<Number(hrs)*3600000))&&(!q||[a.title,a.summary,a.location,a.category,a.source].join(' ').toLowerCase().includes(q)));
 renderCoverage(cat,filtered.length);
 $('countMsg').textContent='Showing '+Math.min(renderLimit,filtered.length)+' of '+filtered.length+' matching records from available sources. Coverage is incomplete.';
 $('alertList').innerHTML=filtered.length?filtered.slice(0,renderLimit).map(a=>'<article class="alert-row"><div><span class="badge '+esc(a.severity)+'">'+esc(a.severity)+'</span></div><div class="alert-main"><h3>'+esc(a.title)+'</h3><p>'+esc(a.summary)+'</p><div class="alert-meta"><span>◎ '+esc(a.location||'Location not listed')+'</span><span>◷ '+when(a.date)+'</span><span>'+esc(a.source.toUpperCase())+'</span><span>'+esc(stateText(a.feedStatus))+'</span><a href="'+safeUrl(a.url)+'" target="_blank" rel="noopener noreferrer">Official source ↗</a></div></div></article>').join(''):'<div class="empty"><b>No matching records from the connected sources.</b><p>Filters, partial coverage, or unavailable feeds could explain this. It does not mean there are no emergencies.</p></div>';
 drawMap();
}
const sourcePages={
 usgs:{page:'https://earthquake.usgs.gov/earthquakes/map/'},gdacs:{page:'https://www.gdacs.org/'},nws:{page:'https://www.weather.gov/'},
 swpc:{page:'https://www.swpc.noaa.gov/'},fda:{page:'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts'},cisa:{page:'https://www.cisa.gov/known-exploited-vulnerabilities-catalog'},
 state:{page:'https://travel.state.gov/en/international-travel/travel-advisories.html'},cdc_travel:{page:'https://wwwnc.cdc.gov/travel/notices'}
};
function drawMap(){
 const svg=$('eventPins');svg.replaceChildren();
 const located=alerts.filter(a=>a.coords&&Number.isFinite(Number(a.coords.lat))&&Number.isFinite(Number(a.coords.lon))).slice(0,150);
 for(const a of located){
  const x=360+(Number(a.coords.lon)/180)*348;
  const y=185-(Number(a.coords.lat)/90)*168;
  const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
  circle.setAttribute('cx',x);circle.setAttribute('cy',y);circle.setAttribute('r',a.severity==='critical'?6:4);
  circle.setAttribute('fill',a.severity==='critical'?'#fb7e81':a.severity==='high'?'#f8ae70':'#4ae2ba');
  circle.setAttribute('opacity','.85');
  const label=document.createElementNS('http://www.w3.org/2000/svg','title');
  label.textContent=a.title+' · '+a.location;circle.appendChild(label);circle.addEventListener('click',()=>window.open(safeUrl(a.url),'_blank','noopener'));
  svg.appendChild(circle);
 }
 $('mapNote').textContent=located.length+' geolocated records plotted · visual approximation only';
}
async function load(){
 $('refresh').disabled=true;$('refresh').textContent='Refreshing…';
 try{
  const r=await fetch('/api/alerts',{cache:'no-store'});if(!r.ok)throw Error('Dashboard API HTTP '+r.status);
  const payload=await r.json();alerts=payload.alerts||[];states=payload.sources||[];coverage=payload.coverage||{};latestGenerated=payload.generatedAt;
  render();
 }catch(e){
  alerts=[];states=[];coverage={};latestGenerated=null;
  $('alertList').textContent='Could not reach the alert API: '+e.message+'. No all-clear can be inferred.';
  $('systemStatus').textContent='Connection unavailable';document.querySelector('.dot').classList.remove('good');
  $('metricLive').textContent='—';$('metricHigh').textContent='—';$('metricTotal').textContent='—';$('metricTime').textContent='Unverified';
  $('sourceList').textContent='Source status unavailable — please try again.';
  $('sectorCoverage').hidden=false;$('sectorCoverage').textContent='Dashboard disconnected. No sector is verified as safe.';
  $('eventPins').replaceChildren();$('mapNote').textContent='Geographic records temporarily unavailable';
  $('countMsg').textContent='No current data can be confirmed.';
 }
 finally{$('refresh').disabled=false;$('refresh').textContent='↻ Refresh';}
}
for(const id of ['search','categoryFilter','severityFilter','timeFilter'])$(id).addEventListener(id==='search'?'input':'change',render);
$('refresh').addEventListener('click',load);
setInterval(load,300000);load();
const statusMessage=(msg,bad=false)=>{$('pushResult').textContent=msg;$('pushResult').style.color=bad?'#ffb38e':'#9ee8cf';};
async function updatePush(){
 try{
  const r=await fetch('/api/push/config',{cache:'no-store'});pushConfig=await r.json();
  const supported='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
  $('pushPill').textContent=pushConfig.configured?'SERVER CONFIGURED':'SETUP REQUIRED';
  const msg=pushConfig.configured?'Push server is configured. Install this website on your Home Screen on iPhone, then enable alerts.':'Push is not yet active: administrator must configure server push keys and persistent database. Dashboard monitoring still works.';
  $('pushMessage').textContent=msg;
  $('pushMessage').classList.toggle('warn',!pushConfig.configured);
  $('subscribe').disabled=!pushConfig.configured||!supported;
  $('testPush').disabled=!pushConfig.configured||!supported;
  $('unsubscribe').disabled=!pushConfig.configured||!supported;
  if(pushConfig.configured&&supported){const reg=await navigator.serviceWorker.register('/sw.js');currentSub=await reg.pushManager.getSubscription();if(currentSub)statusMessage('This device has an existing browser subscription.');}
  else if(!supported)statusMessage('Your browser does not support this notification method. On iPhone, open WATCHTOWER from its Home Screen icon.',true);
 }catch(e){statusMessage('Could not check phone alerts: '+e.message,true);}
}
$('pushMode').addEventListener('change',()=>{$('radiusRow').hidden=$('pushMode').value!=='nearby';});
const base64ToBytes=b=>{const safe=b.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(safe+'='.repeat((4-safe.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0));};
const post=async(endpoint,body)=>{const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const json=await r.json();if(!r.ok)throw Error(json.error||'Request failed');return json;};
const storedPrefs=readSaved('wt-prefs',null);
if(storedPrefs){
 $('pushSeverity').value=storedPrefs.minSeverity||'high';$('pushMode').value=storedPrefs.mode||'global';$('pushRadius').value=String(storedPrefs.radiusKm||100);
 $('radiusRow').hidden=$('pushMode').value!=='nearby';
 document.querySelectorAll('#categoryChecks input').forEach(el=>el.checked=(storedPrefs.categories||[]).includes(el.value));
}
$('subscribe').addEventListener('click',async()=>{
 $('subscribe').disabled=true;statusMessage('Requesting permission and registering phone…');
 try{
  if(!pushConfig.configured)throw Error('Server is not configured');
  if(!('serviceWorker' in navigator)||!('PushManager' in window))throw Error('Push is not supported in this browser');
  if(Notification.permission==='denied')throw Error('Notifications are blocked in device settings');
  const permit=await Notification.requestPermission();if(permit!=='granted')throw Error('Notification permission was not granted');
  const categories=[...document.querySelectorAll('#categoryChecks input:checked')].map(e=>e.value);
  const prefs={categories,minSeverity:$('pushSeverity').value,mode:$('pushMode').value,radiusKm:Number($('pushRadius').value)};
  if(prefs.mode==='nearby'){
   if(!navigator.geolocation)throw Error('Location is unavailable on this device');
   const position=await new Promise((ok,no)=>navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:false,timeout:12000,maximumAge:300000}));
   prefs.lat=position.coords.latitude;prefs.lon=position.coords.longitude;
  }
  const reg=await navigator.serviceWorker.ready;
  let sub=await reg.pushManager.getSubscription();
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64ToBytes(pushConfig.publicKey)});
  await post('/api/push/subscribe',{subscription:sub.toJSON(),preferences:prefs});currentSub=sub;
  writeSaved('wt-prefs',{...prefs,lat:null,lon:null});
  statusMessage('Phone subscribed. Tap Send test to check on-device delivery. This is not a substitute for local emergency alerts.');
 }catch(e){statusMessage(e.message,true)}
 finally{$('subscribe').disabled=false;}
});
$('unsubscribe').addEventListener('click',async()=>{
 try{const reg=await navigator.serviceWorker.ready;const s=await reg.pushManager.getSubscription();if(s){await post('/api/push/unsubscribe',{endpoint:s.endpoint});await s.unsubscribe();}currentSub=null;statusMessage('Notifications disabled for this browser.');}
 catch(e){statusMessage(e.message,true);}
});
$('testPush').addEventListener('click',async()=>{
 try{const reg=await navigator.serviceWorker.ready;const s=await reg.pushManager.getSubscription();if(!s)throw Error('Enable notifications first');await post('/api/push/test',{endpoint:s.endpoint});statusMessage('Test sent to push service. Check your phone; delivery is not guaranteed.');}
 catch(e){statusMessage(e.message,true);}
});
updatePush();

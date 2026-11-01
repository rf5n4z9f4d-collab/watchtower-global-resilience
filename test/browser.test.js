import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/style.css',import.meta.url),'utf8');
const timestamp=new Date().toISOString();
const sourceIDs=['usgs','gdacs','nws','swpc','fda','cisa','state','cdc_travel'];
const sample={
 generatedAt:timestamp,
 sources:sourceIDs.map((id,i)=>({id,name:id,scope:'Global',status:i===7?'unavailable':'live',count:1,checkedAt:Date.now(),lastSuccess:timestamp})),
 coverage:{
  'Military & security':{kind:'related',status:'live',responding:1,total:1,note:'Only State Department travel advisories, not live military incidents.',links:[{title:'State Department',url:'https://travel.state.gov/'}]},
  'Water':{kind:'limited',status:'available',responding:1,total:1,note:'No complete boil-water warning coverage',links:[{title:'EPA',url:'https://www.epa.gov/'}]},
  'Earthquake':{kind:'incident',status:'available',responding:1,total:1,note:'Recorded earthquakes, not confirmed infrastructure damage.',links:[{title:'USGS',url:'https://earthquake.usgs.gov/'}]}
 },
 alerts:[
  {id:'eq1',source:'usgs',category:'Earthquake',severity:'high',title:'M6.3 earthquake',summary:'Ground shaking in Region A',date:timestamp,location:'Region A',url:'https://earthquake.usgs.gov/earthquakes/',coords:{lat:35,lon:-97},feedStatus:'live'},
  {id:'mil1',source:'state',category:'Military & security',severity:'moderate',title:'Travel advisory — Testland',summary:'Not a military incident',date:timestamp,location:'Testland',url:'https://travel.state.gov/',coords:null,feedStatus:'live'},
  {id:'cyber1',source:'cisa',category:'Cyber & data',severity:'advisory',title:'Known exploited vulnerability',summary:'Not evidence of a breach',date:timestamp,location:'Worldwide',url:'https://www.cisa.gov/',coords:null,feedStatus:'live'},
  {id:'escape',source:'usgs',category:'Earthquake',severity:'moderate',title:'<img src=x onerror=alert(1)>',summary:'safe',date:timestamp,location:'Location',url:'javascript:alert(1)',coords:null,feedStatus:'live'}
 ]
};

async function bootstrap({corruptStorage=false,alerts=sample.alerts}={}){
 const dom=new JSDOM(html,{url:'https://watchtower.example/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;const d=w.document;let feedCalls=0;
 if(corruptStorage){w.localStorage.setItem('watchtower-prep','{broken json');w.localStorage.setItem('wt-prefs','{broken json');}
 w.fetch=async input=>{
  const url=String(input);
  if(url==='/api/alerts'){feedCalls++;return {ok:true,json:async()=>({...sample,alerts})};}
  if(url==='/api/push/config')return {ok:true,json:async()=>({configured:false,persistent:false,publicKey:null})};
  throw Error('Unexpected network call '+url);
 };
 w.open=()=>null;
 const errors=[];w.addEventListener('error',e=>errors.push(e.error?.message||e.message));
 try{w.eval(js);}catch(e){dom.window.close();throw e;}
 const ready=async()=>{
  for(let i=0;i<60;i++){
   if(d.getElementById('metricTotal').textContent===String(alerts.length))return;
   await new Promise(ok=>setTimeout(ok,10));
  }
  throw Error('Dashboard failed to render alert response: '+errors.join(','));
 };
 await ready();
 return {dom,w,d,errors,getFeedCalls:()=>feedCalls};
}
function change(w,d,id,value,type='change'){
 const el=d.getElementById(id);el.value=value;el.dispatchEvent(new w.Event(type,{bubbles:true}));
}
test('browser initializes all eight sector sources and renders records without JS exceptions',async()=>{
 const {dom,d,errors}=await bootstrap();
 try{
  assert.equal(d.getElementById('metricLive').textContent,'7/8');
  assert.equal(d.getElementById('metricTotal').textContent,'4');
  assert.equal(d.getElementById('sourceTotal').textContent,'8');
  assert.equal(d.querySelectorAll('.alert-row').length,4);
  assert.equal(d.querySelectorAll('#categoryFilter option').length,11);
  assert.equal(d.querySelectorAll('#sourceList .source-row').length,8);
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});
test('sector changes are honest about advisory-only coverage and zero results',async()=>{
 const {dom,w,d}=await bootstrap();
 try{
  change(w,d,'categoryFilter','Military & security');
  assert.equal(d.querySelectorAll('.alert-row').length,1);
  assert.match(d.getElementById('sectorCoverage').textContent,/RELATED ADVISORIES ONLY/);
  change(w,d,'severityFilter','high');
  assert.equal(d.querySelectorAll('.alert-row').length,0);
  assert.match(d.getElementById('alertList').textContent,/No matching records from the connected sources/);
  assert.match(d.getElementById('sectorCoverage').textContent,/not live military incidents/i);
 }finally{dom.window.close();}
});
test('search, category, severity, time controls change the visible list',async()=>{
 const {dom,w,d}=await bootstrap();
 try{
  change(w,d,'search','M6.3','input');assert.equal(d.querySelectorAll('.alert-row').length,1);
  change(w,d,'search','definitely not here','input');assert.equal(d.querySelectorAll('.alert-row').length,0);
  change(w,d,'search','','input');
  change(w,d,'severityFilter','high');assert.equal(d.querySelectorAll('.alert-row').length,1);
  change(w,d,'severityFilter','moderate');assert.equal(d.querySelectorAll('.alert-row').length,3);
  change(w,d,'timeFilter','24');assert.equal(d.querySelectorAll('.alert-row').length,3);
  change(w,d,'categoryFilter','Water');assert.equal(d.querySelectorAll('.alert-row').length,0);
  assert.match(d.getElementById('sectorCoverage').textContent,/VERY LIMITED COVERAGE/);
 }finally{dom.window.close();}
});
test('map pins only contain coordinate-backed entries',async()=>{
 const {dom,d}=await bootstrap();
 try{
  assert.equal(d.querySelectorAll('#eventPins circle').length,1);
  assert.match(d.getElementById('mapNote').textContent,/1 geolocated/);
 }finally{dom.window.close();}
});
test('preparedness calculator updates water and food requirements',async()=>{
 const {dom,d,w}=await bootstrap();
 try{
  change(w,d,'people','3','input');change(w,d,'days','5','input');
  assert.equal(d.getElementById('waterCount').textContent,'15 gallons');
  assert.equal(d.getElementById('mealCount').textContent,'45 meals');
  change(w,d,'days','100','input');assert.equal(d.getElementById('waterCount').textContent,'90 gallons');
  change(w,d,'days','100','change');assert.equal(d.getElementById('days').value,'30');
 }finally{dom.window.close();}
});
test('checklist changes are saved and corrupted prior storage cannot crash startup',async()=>{
 const {dom,d,w,errors}=await bootstrap({corruptStorage:true});
 try{
  assert.deepEqual(errors,[]);
  const item=d.querySelector('#checkList input[data-key="0"]');
  item.checked=true;item.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(JSON.parse(w.localStorage.getItem('watchtower-prep'))['0'],true);
 }finally{dom.window.close();}
});
test('push controls accurately show server not configured; buttons are disabled',async()=>{
 const {dom,d}=await bootstrap();
 try{
  await new Promise(ok=>setTimeout(ok,10));
  assert.equal(d.getElementById('subscribe').disabled,true);
  assert.equal(d.getElementById('testPush').disabled,true);
  assert.equal(d.getElementById('unsubscribe').disabled,true);
  assert.match(d.getElementById('pushMessage').textContent,/not yet active/);
  assert.match(d.getElementById('pushPill').textContent,/SETUP REQUIRED/);
 }finally{dom.window.close();}
});
test('untrusted titles appear as text; untrusted URLs cannot turn into javascript links',async()=>{
 const {dom,d}=await bootstrap();
 try{
  assert.equal(d.querySelectorAll('.alert-row img').length,0);
  assert.match(d.getElementById('alertList').textContent,/<img src=x onerror=alert\(1\)>/);
  const links=[...d.querySelectorAll('.alert-row a')].filter(x=>x.textContent.includes('Official source'));
  assert.ok(links.some(a=>a.getAttribute('href')==='#'));
 }finally{dom.window.close();}
});
test('refresh fetches again and restores button state',async()=>{
 const {dom,d,getFeedCalls}=await bootstrap();
 try{
  const initial=getFeedCalls();d.getElementById('refresh').click();
  for(let i=0;i<20&&getFeedCalls()<=initial;i++)await new Promise(ok=>setTimeout(ok,10));
  assert.ok(getFeedCalls()>initial);
  await new Promise(ok=>setTimeout(ok,10));
  assert.equal(d.getElementById('refresh').disabled,false);
 }finally{dom.window.close();}
});

test('a network outage clears optimistic status counters, pins and old alerts',async()=>{
 const {dom,d,w}=await bootstrap();
 try{
  assert.equal(d.getElementById('metricLive').textContent,'7/8');
  w.fetch=async url=>{if(url==='/api/alerts')throw Error('network unavailable');return {ok:true,json:async()=>({configured:false})};};
  d.getElementById('refresh').click();
  for(let i=0;i<60 && d.getElementById('metricTime').textContent!=='Unverified';i++)await new Promise(ok=>setTimeout(ok,10));
  assert.equal(d.getElementById('metricTime').textContent,'Unverified');
  assert.equal(d.getElementById('metricTotal').textContent,'—');
  assert.equal(d.getElementById('metricHigh').textContent,'—');
  assert.equal(d.querySelectorAll('#eventPins circle').length,0);
  assert.match(d.getElementById('sectorCoverage').textContent,/No sector is verified as safe/);
  assert.match(d.getElementById('sourceList').textContent,/unavailable/);
 }finally{dom.window.close();}
});
test('last checked time is grounded in actual source attempts rather than API response generation',async()=>{
 const {dom,d}=await bootstrap();
 try{
  assert.notEqual(d.getElementById('metricTime').textContent,'Not verified');
  assert.match(d.getElementById('sourceList').textContent,/Last attempt/);
 }finally{dom.window.close();}
});

test('Cloudflare notification mode keeps nearby distance disabled until supported',async()=>{
 const {dom,d,w}=await bootstrap();
 try{
  const style=d.createElement('style');style.textContent=css;d.head.appendChild(style);
  const row=d.getElementById('radiusRow');
  assert.equal(row.hidden,true);
  assert.equal(w.getComputedStyle(row).display,'none');
  change(w,d,'pushMode','nearby');
  assert.equal(row.hidden,true);
  assert.equal(w.getComputedStyle(row).display,'none');
  change(w,d,'pushMode','global');
  assert.equal(row.hidden,true);
  assert.equal(w.getComputedStyle(row).display,'none');
 }finally{dom.window.close();}
});

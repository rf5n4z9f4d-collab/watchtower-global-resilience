import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WT_TEST_MODE='1';
const {sources,geo,tag,transform,validateFeed,pull,getCoverage,near,matches,validPrefs,validSub,handle}=await import('../server.js');
const sample={endpoint:'https://push.example.org/send/abc',keys:{p256dh:'test-public-key',auth:'test-auth-key'}};
const now=Date.now();
const src=id=>sources.find(x=>x.id===id);
const call=async(url,method='GET')=>{
 const chunks=[];let status=null,headers=null;
 const response={writeHead(code,head){status=code;headers=head;},end(data){if(data)chunks.push(data);}};
 await handle({url,method,headers:{host:'localhost'}},response);
 const data=Buffer.concat(chunks.map(x=>Buffer.isBuffer(x)?x:Buffer.from(x))).toString('utf8');
 return {status,headers,body:headers?.['Content-Type']?.includes('json')?JSON.parse(data):data};
};

test('eight source registrations have unique IDs and HTTPS endpoints',()=>{
 assert.equal(sources.length,8);assert.equal(new Set(sources.map(s=>s.id)).size,8);
 for(const s of sources)assert.match(s.url,/^https:\/\//);
});

test('coordinate parser does not manufacture 0,0 when feed coordinates are absent',()=>{
 for(const missing of [undefined,null,'',' ','nope'])assert.equal(geo(missing,34),null);
 assert.equal(geo(0,0)?.lat,0);
 assert.equal(geo(91,10),null);assert.equal(geo(40,-181),null);
 assert.deepEqual(geo('40.3','-74.2'),{lat:40.3,lon:-74.2});
});

test('CDATA, XML tags and encoded entities can be parsed',()=>{
 assert.equal(tag('<title><![CDATA[Water &amp; power]]></title>','title'),'Water & power');
 assert.equal(tag('<gdacs:eventtype>EQ</gdacs:eventtype>','gdacs:eventtype'),'EQ');
 assert.equal(tag('','title'),'');
});

test('invalid upstream data is rejected instead of being marked healthy',()=>{
 assert.throws(()=>validateFeed(src('gdacs'),'<html>gateway returned 200</html>'));
 assert.throws(()=>validateFeed(src('usgs'),{features:null}));
 assert.throws(()=>validateFeed(src('nws'),{}));
 assert.throws(()=>validateFeed(src('swpc'),{}));
 assert.throws(()=>validateFeed(src('fda'),{error:'blocked'}));
 assert.throws(()=>validateFeed(src('cisa'),{}));
 assert.doesNotThrow(()=>validateFeed(src('state'),'<?xml version="1.0"?><rss><channel></channel></rss>'));
});

test('USGS earthquakes are categorized, dated, geolocated, and severity graded',()=>{
 const f=mag=>({id:'eq-'+mag,properties:{mag,place:'Test region',time:now,url:'https://earthquake.usgs.gov/event',tsunami:0},geometry:{coordinates:[-97.4,35.4,8]}});
 const a=transform('usgs',{features:[f(4.6),f(6.1),f(7.2),f(2)]});
 assert.deepEqual(a.map(x=>x.severity),['moderate','high','critical']);
 assert.deepEqual(a[0].coords,{lat:35.4,lon:-97.4});
 assert.equal(a[0].category,'Earthquake');
});

test('GDACS parser handles high impact alerts and points',()=>{
 const xml='<rss><channel><item><title><![CDATA[Test Flood]]></title><description>Impact estimated</description><gdacs:eventtype>FL</gdacs:eventtype><gdacs:alertlevel>Red</gdacs:alertlevel><gdacs:eventid>1234</gdacs:eventid><georss:point>29.5 -99.5</georss:point><pubDate>Sat, 31 Oct 2026 12:00:00 GMT</pubDate><link>https://www.gdacs.org/</link></item></channel></rss>';
 const a=transform('gdacs',xml);
 assert.equal(a.length,1);assert.equal(a[0].severity,'critical');assert.equal(a[0].category,'Climate & disasters');assert.deepEqual(a[0].coords,{lat:29.5,lon:-99.5});
});

test('National Weather Service filters low severity warnings and selects impacted sector',()=>{
 const p=(severity,event,description='')=>({type:'Feature',properties:{id:'https://api.weather.gov/'+event,headline:event,severity,status:'Actual',event,description,sent:new Date(now).toISOString(),areaDesc:'Oklahoma'}});
 const a=transform('nws',{features:[p('Severe','Tornado Warning'),p('Moderate','Boil water warning','Drinking water contamination'),p('Minor','Routine update')]});
 assert.equal(a.length,2);assert.equal(a[0].category,'Climate & disasters');assert.equal(a[1].category,'Water');
});

test('NOAA space-weather alerts parse UTC dates and remain potential-impact advisories',()=>{
 const a=transform('swpc',[{product_id:'K06A',issue_datetime:new Date(now-2000).toISOString().replace('T',' ').replace('Z',''),message:'ALERT: Geomagnetic storm G4. Power grid fluctuations can occur.'}]);
 assert.equal(a.length,1);assert.equal(a[0].severity,'high');assert.equal(a[0].category,'Power & energy');assert.ok(a[0].date);
 assert.match(a[0].summary,/not a confirmed outage/);
});

test('FDA recalls and CISA advisories do not claim confirmed shortages or breaches',()=>{
 const f=transform('fda',{results:[{recall_number:'R123',classification:'Class I',product_description:'Test food',reason_for_recall:'Contamination',report_date:'20261030',status:'Ongoing'}]});
 assert.equal(f.length,1);assert.equal(f[0].severity,'high');assert.match(f[0].summary,/not evidence of a food shortage/);
 const c=transform('cisa',{vulnerabilities:[{cveID:'CVE-2026-1234',dateAdded:new Date(now).toISOString().slice(0,10),vendorProject:'Vendor',product:'Product',shortDescription:'Exploited vulnerability'}]});
 assert.equal(c.length,1);assert.match(c[0].summary,/does not confirm a breach/);
});

test('security and health RSS entries are clearly described as travel advisories',()=>{
 const xml=(title)=>'<rss><channel><item><title>'+title+'</title><pubDate>Sat, 31 Oct 2026 12:00:00 GMT</pubDate><link>https://travel.state.gov/</link></item></channel></rss>';
 const s=transform('state',xml('Testland - Level 4: Do Not Travel'))[0];
 assert.equal(s.category,'Military & security');assert.match(s.summary,/not a military incident/);
 const h=transform('cdc_travel',xml('Level 2 - Yellow Fever in Testland'))[0];
 assert.equal(h.category,'Healthcare');assert.match(h.summary,/not a confirmed hospital disruption/);
});

test('sector coverage explicitly distinguishes sources from incident coverage',()=>{
 const states=sources.map(s=>({id:s.id,status:'live'}));
 const coverage=getCoverage(states);
 assert.equal(coverage['Military & security'].kind,'related');
 assert.match(coverage.Water.note,/No comprehensive/);
 assert.equal(coverage.Earthquake.status,'available');
 assert.equal(coverage['Military & security'].responding,1);
 assert.equal(getCoverage([])['Military & security'].status,'unavailable');
});

test('nearby selection does not turn nongeolocated incidents into local alerts',()=>{
 const prefs={mode:'nearby',lat:35,lon:-97,radiusKm:100};
 assert.equal(near({source:'usgs',coords:null},prefs),false);
 assert.equal(near({source:'usgs',coords:{lat:35.1,lon:-97.1}},prefs),true);
 assert.equal(near({source:'usgs',coords:{lat:45,lon:-97}},prefs),false);
});

test('notification preferences validate coverage, source lists and distance',()=>{
 assert.throws(()=>validPrefs({categories:[]}));
 assert.throws(()=>validPrefs({categories:['Power & energy'],mode:'nearby'}));
 assert.deepEqual(validPrefs({categories:['Earthquake','bogus'],mode:'global'}).categories,['Earthquake']);
 assert.equal(validPrefs({categories:['Earthquake'],mode:'global',minSeverity:'unknown'}).minSeverity,'high');
 assert.equal(validPrefs({categories:['Earthquake'],mode:'nearby',lat:35,lon:-97,radiusKm:100}).radiusKm,100);
});

test('notification subscription endpoints require HTTPS and key data',()=>{
 assert.deepEqual(validSub(sample),sample);
 assert.throws(()=>validSub({endpoint:'http://localhost',keys:sample.keys}));
 assert.throws(()=>validSub({endpoint:sample.endpoint,keys:{p256dh:'missing auth'}}));
});

test('push filter respects category and minimum severity',()=>{
 const x={category:'Earthquake',severity:'moderate',source:'usgs',coords:geo(35,-97)};
 assert.equal(matches(x,{categories:['Earthquake'],minSeverity:'high',mode:'global'}),false);
 assert.equal(matches(x,{categories:['Earthquake'],minSeverity:'moderate',mode:'global'}),true);
 assert.equal(matches(x,{categories:['Water'],minSeverity:'moderate',mode:'global'}),false);
});

test('an invalid feed response becomes unavailable, not a fake all-clear',async()=>{
 const real=globalThis.fetch;
 try{
  globalThis.fetch=async()=>({ok:true,json:async()=>({broken:'unexpected'})});
  const state=await pull(src('nws'),true);
  assert.equal(state.status,'unavailable');assert.match(state.error,/Unexpected JSON/);
 }finally{globalThis.fetch=real;}
});

test('API health, push availability, homepage and not-found endpoints respond safely',async()=>{
 const status=await call('/api/status');
 assert.equal(status.status,200);assert.equal(status.body.sources.length,8);
 const cfg=await call('/api/push/config');
 assert.equal(cfg.status,200);assert.equal(cfg.body.configured,false);
 assert.equal((await call('/')).status,200);
 assert.equal((await call('/missing-page')).status,404);
 assert.equal((await call('/api/push/subscribe','POST')).status,503);
 assert.equal((await call('/api/status','POST')).status,405);
});

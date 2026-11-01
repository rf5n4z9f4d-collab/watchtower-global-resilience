import test from "node:test";
import assert from "node:assert/strict";
import {SOURCES,SECTORS,parseSource,readSource} from "../src/sources.js";
import {GROUPS,groupFor,buildFilters,sendOneSignal} from "../src/push.js";
import {handleAPI,ingest,getStatuses} from "../src/index.js";
import {readFileSync} from "node:fs";

test("Eight official sources are registered and all use HTTPS",()=>{
 assert.equal(SOURCES.length,8);
 assert.equal(new Set(SOURCES.map(s=>s.id)).size,8);
 assert.ok(SOURCES.every(s=>s.url.startsWith("https://")));
 assert.equal(Object.keys(SECTORS).length,10);
});
test("USGS earthquakes are normalized with stable IDs and coordinates",()=>{
 const now=Date.now();
 const a=parseSource(SOURCES.find(x=>x.id==="usgs"),{features:[{
  id:"eq1",properties:{mag:6.5,place:"Test region",time:now,url:"https://earthquake.usgs.gov/earthquakes/eventpage/eq1"},
  geometry:{coordinates:[-97.5,35.7,5]}
 }]});
 assert.equal(a.length,1);assert.equal(a[0].severity,"high");
 assert.equal(a[0].coords.lon,-97.5);assert.equal(a[0].category,"Earthquake");
});
test("GDACS red alerts are high-impact signals but not verified outages",()=>{
 const xml='<rss><channel><item><title>Flood</title><gdacs:eventtype>FL</gdacs:eventtype><gdacs:alertlevel>Red</gdacs:alertlevel><georss:point>20 -90</georss:point><pubDate>Sat, 31 Oct 2026 12:00:00 GMT</pubDate><link>https://www.gdacs.org/</link></item></channel></rss>';
 const out=parseSource(SOURCES.find(x=>x.id==="gdacs"),xml);
 assert.equal(out.length,1);assert.equal(out[0].severity,"critical");
 assert.match(out[0].summary,/not confirmed infrastructure damage|not verified|potential/i);
});
test("malformed upstream data throws instead of inventing an all-clear",()=>{
 assert.throws(()=>parseSource(SOURCES.find(s=>s.id==="usgs"),{unexpected:"bad"}));
 assert.throws(()=>parseSource(SOURCES.find(s=>s.id==="gdacs"),"<html>error</html>"));
});
test("bounded HTTP response rejects oversized feeds",async()=>{
 const source=SOURCES.find(x=>x.id==="usgs");
 await assert.rejects(()=>readSource(source,async()=>({ok:true,headers:{get:()=>String(2000000)}})));
});
test("Five OneSignal groups plus one severity tag stay inside the free plan",()=>{
 assert.equal(Object.keys(GROUPS).length,5);
 assert.equal(new Set(Object.values(GROUPS).map(x=>x.tag)).size,5);
 assert.equal(groupFor("Earthquake"),"disasters");
 assert.equal(groupFor("Communications"),"utilities");
 assert.equal(groupFor("Cyber & data"),"cyber");
});
test("OneSignal audience filters honor topic and minimum urgency",()=>{
 const high=buildFilters("Earthquake","high");
 assert.equal(high.filter(f=>f.key==="wt_min").length,2);
 assert.equal(high.filter(f=>f.key==="wt_disasters").length,2);
 const critical=buildFilters("Cyber & data","critical");
 assert.equal(critical.filter(f=>f.key==="wt_min").length,3);
 assert.equal(buildFilters("Earthquake","moderate"),null);
});
test("OneSignal REST request uses stable UUID and never exposes server key to clients",async()=>{
 let payload,header;
 const env={PUSH_ENABLED:"true",ONESIGNAL_APP_ID:"sample-app-id",ONESIGNAL_REST_API_KEY:"server-secret"};
 const incident={category:"Earthquake",severity:"high",title:"Test earthquake",url:"https://earthquake.usgs.gov/",notify_key:"00000000-0000-4000-8000-000000000001"};
 const result=await sendOneSignal(env,incident,async(url,opts)=>{
  assert.equal(url,"https://api.onesignal.com/notifications");
  payload=JSON.parse(opts.body);header=opts.headers.Authorization;
  return {ok:true,json:async()=>({id:"message-id"})};
 });
 assert.equal(result.status,"accepted");
 assert.equal(header,"Key server-secret");
 assert.equal(payload.idempotency_key,incident.notify_key);
 assert.equal(payload.included_segments,undefined);
 assert.equal(payload.filters[0].key,"wt_disasters");
});
test("disabled OneSignal never makes an outbound API call",async()=>{
 const r=await sendOneSignal({PUSH_ENABLED:"false"},{},()=>{throw Error("sent unexpectedly")});
 assert.equal(r.status,"disabled");
});
test("public push configuration does not disclose the OneSignal secret",async()=>{
 const response=await handleAPI(new Request("https://watchtower.test/api/push/config"),{PUSH_ENABLED:"true",ONESIGNAL_APP_ID:"public-id",ONESIGNAL_REST_API_KEY:"do-not-expose"});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.provider,"onesignal");assert.equal(body.configured,true);
 assert.equal(body.nearby,false);assert.ok(!JSON.stringify(body).includes("do-not-expose"));
});
test("no D1 binding fails closed",async()=>{
 const r=await handleAPI(new Request("https://watchtower.test/api/alerts"),{});
 assert.equal(r.status,503);
 const j=await r.json();assert.ok(!JSON.stringify(j).includes("safe"));
});
test("HTTP writes to status APIs are not allowed",async()=>{
 const r=await handleAPI(new Request("https://watchtower.test/api/push/config",{method:"POST"}),{});
 assert.equal(r.status,405);
});

test("Wrangler cron configuration uses valid five-field syntax",()=>{
 const config=JSON.parse(readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8"));
 assert.equal(config.name,"watchtower-free");
 assert.equal(config.d1_databases[0].binding,"DB");
 for(const expr of config.triggers.crons){
  const fields=expr.trim().split(/\\s+/);
  assert.equal(fields.length,5,"Invalid cron expression: "+expr);
 }
});

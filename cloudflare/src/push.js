// Free OneSignal plan has six user data tags: five opt-in groups plus minimum urgency.
export const GROUPS = {
 disasters:{tag:"wt_disasters",label:"Earthquakes and disasters",categories:["Earthquake","Climate & disasters","Humanitarian"]},
 utilities:{tag:"wt_utilities",label:"Power, water and communications",categories:["Power & energy","Water","Communications"]},
 foodhealth:{tag:"wt_foodhealth",label:"Food and health",categories:["Food & supply","Healthcare"]},
 cyber:{tag:"wt_cyber",label:"Cybersecurity",categories:["Cyber & data"]},
 security:{tag:"wt_security",label:"Travel and security",categories:["Military & security"]}
};
export function groupFor(category){return Object.entries(GROUPS).find(([k,v])=>v.categories.includes(category))?.[0]||null;}
export function buildFilters(category,severity){
 const group=groupFor(category);if(!group)throw Error("Unsupported category");
 const levels=severity==="critical"?["moderate","high","critical"]:severity==="high"?["moderate","high"]:[];
 if(!levels.length)return null; // Only high or critical incidents are sent.
 const filters=[];
 for(const level of levels){
  if(filters.length)filters.push({operator:"OR"});
  filters.push({field:"tag",key:GROUPS[group].tag,relation:"=",value:"1"},
               {operator:"AND"},
               {field:"tag",key:"wt_min",relation:"=",value:level});
 }
 return filters;
}
export async function sendOneSignal(env,incident,fetcher=fetch){
 if(!env.ONESIGNAL_REST_API_KEY||!env.ONESIGNAL_APP_ID||env.PUSH_ENABLED!=="true")return {status:"disabled"};
 const filters=buildFilters(incident.category,incident.severity);
 if(!filters)return {status:"skipped"};
 if(!incident.notify_key)throw Error("Missing persisted notification idempotency key");
 const payload={
  app_id:env.ONESIGNAL_APP_ID,
  target_channel:"push",
  filters,
  headings:{en:"WATCHTOWER · "+incident.severity.toUpperCase()},
  contents:{en:incident.title.slice(0,165)},
  url:incident.url, // Official source. Never trust an arbitrary user-provided URL.
  idempotency_key:incident.notify_key,
  ttl:1800,
  isAnyWeb:true
 };
 const response=await fetcher("https://api.onesignal.com/notifications",{
  method:"POST",
  headers:{"Content-Type":"application/json","Authorization":"Key "+env.ONESIGNAL_REST_API_KEY},
  body:JSON.stringify(payload),
  signal:AbortSignal.timeout(15000)
 });
 if(!response.ok)throw Error("OneSignal HTTP "+response.status);
 const body=await response.json();
 if(!body.id)return {status:"no_recipients"};
 return {status:"accepted",messageId:body.id};
}

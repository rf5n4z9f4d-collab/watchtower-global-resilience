// Cloudflare-only browser push adapter (OneSignal Web SDK v16).
const $=id=>document.getElementById(id);
const groups={
 disasters:"Earthquakes, disasters and humanitarian events",
 utilities:"Power, water and communications",
 foodhealth:"Food recalls and travel-health notices",
 cyber:"Cybersecurity advisories",
 security:"Travel and security advisories"
};
const keys=Object.keys(groups);
const saved=(()=>{try{return JSON.parse(localStorage.getItem("wt-free-prefs")||"null");}catch{return null;}})();
const checks=$("categoryChecks");
checks.innerHTML=keys.map(k=>'<label><input type="checkbox" data-group="'+k+'" '+(saved?.groups? saved.groups.includes(k):["disasters","utilities"].includes(k)?"checked":"")+'>'+groups[k]+'</label>').join("");
$("pushMode").innerHTML='<option value="global">Worldwide — grouped alerts only</option>';
$("pushMode").disabled=true;
$("radiusRow").hidden=true;
$("pushSeverity").value=saved?.minSeverity||"high";
$("testPush").textContent="How to test";
const message=(text,error=false)=>{$("pushResult").textContent=text;$("pushResult").style.color=error?"#ffb28f":"#9ee8d4"};
let config=null,sdk=null,initializing=null;
function getPreferences(){
 const selected=[...checks.querySelectorAll("input:checked")].map(x=>x.dataset.group);
 if(!selected.length)throw Error("Choose at least one alert group");
 return {groups:selected,minSeverity:$("pushSeverity").value};
}
async function loadSdk(){
 if(sdk)return sdk;
 if(initializing)return initializing;
 initializing=new Promise((resolve,reject)=>{
  const script=document.createElement("script");
  script.src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
  script.async=true;script.onerror=()=>reject(new Error("Cannot load OneSignal SDK"));
  document.head.appendChild(script);
  window.OneSignalDeferred=window.OneSignalDeferred||[];
  window.OneSignalDeferred.push(async OS=>{
   try{
    await OS.init({appId:config.appId,serviceWorkerPath:"OneSignalSDKWorker.js",serviceWorkerParam:{scope:"/"},
      allowLocalhostAsSecureOrigin:false});
    sdk=OS;resolve(OS);
   }catch(e){reject(e)}
  });
 });
 return initializing;
}
async function refreshConfiguration(){
 try{
  const response=await fetch("/api/push/config",{cache:"no-store"});
  if(!response.ok)throw Error("Notification settings API unavailable");
  config=await response.json();
  const ready=config.provider==="onesignal"&&config.configured&&!!config.appId;
  $("pushPill").textContent=ready?"ONESIGNAL CONFIGURED":"SETUP REQUIRED";
  $("subscribe").disabled=!ready;
  $("unsubscribe").disabled=!ready;
  $("testPush").disabled=!ready;
  $("pushMessage").textContent=ready
   ?"Worldwide grouped web push is configured. On iPhone, add WATCHTOWER to the Home Screen and open it there before subscribing."
   :"Push is not active: a Cloudflare OneSignal App ID, REST API secret and explicit enable switch are required. This dashboard can still display incident data.";
  $("pushMessage").classList.toggle("warn",!ready);
  if(!ready)message("No alerts are being sent yet. No paid services were created.");
 }catch(e){
  $("pushPill").textContent="CONFIGURATION UNAVAILABLE";
  $("subscribe").disabled=$("unsubscribe").disabled=$("testPush").disabled=true;
  $("pushMessage").textContent="Could not verify notification setup. Do not assume delivery is working.";
  message(e.message,true);
 }
}
$("subscribe").addEventListener("click",async()=>{
 $("subscribe").disabled=true;
 try{
  if(!config?.configured)throw Error("Push server is not configured");
  const prefs=getPreferences(),OS=await loadSdk();
  if(!(await OS.Notifications.isPushSupported()))throw Error("This browser does not support web push. iPhone requires a Home Screen web app.");
  await OS.Notifications.requestPermission();
  if(!OS.Notifications.permission)throw Error("Notification permission was not granted");
  const tags=Object.fromEntries(keys.map(k=>["wt_"+k,prefs.groups.includes(k)?"1":"0"]));
  tags.wt_min=prefs.minSeverity;
  await OS.User.addTags(tags); // OneSignal Free: five groups + one urgency tag.
  await OS.User.PushSubscription.optIn();
  if(!OS.User.PushSubscription.optedIn)throw Error("OneSignal reports this device is not subscribed");
  try{localStorage.setItem("wt-free-prefs",JSON.stringify(prefs));}catch{}
  message("Device subscribed to worldwide "+prefs.minSeverity+"+ alerts in your selected groups. Verify delivery using a OneSignal dashboard test.");
 }catch(e){message(String(e.message||e),true)}
 finally{$("subscribe").disabled=false;}
});
$("unsubscribe").addEventListener("click",async()=>{
 try{
  const OS=await loadSdk();await OS.User.PushSubscription.optOut();
  message("This device opted out of OneSignal push notifications.");
 }catch(e){message(e.message,true)}
});
$("testPush").addEventListener("click",()=>{
 message("In OneSignal: Audience → Subscriptions → choose this test device, then Messages → New Push → Test Users. A successful API response is not proof of device delivery.");
});
refreshConfiguration();

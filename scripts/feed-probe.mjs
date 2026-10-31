process.env.WT_TEST_MODE='1';
const {sources,pull}=await import('../server.js');
const start=Date.now();
const results=await Promise.all(sources.map(s=>pull(s,true)));
for(const r of results){
 const msg={source:r.id,status:r.status,records:r.count,lastSuccess:r.lastSuccess||null,elapsedMs:Date.now()-start,error:r.error||null};
 console.log('FEED_AUDIT '+JSON.stringify(msg));
}
const available=results.filter(x=>x.status==='live').length;
console.log('FEED_AUDIT_SUMMARY '+JSON.stringify({responding:available,total:results.length,failed:results.filter(x=>x.status!=='live').map(x=>x.id),time:new Date().toISOString(),kind:'one-time-deployment-probe'}));

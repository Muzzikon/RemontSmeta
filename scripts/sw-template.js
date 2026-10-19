const CACHE_NAME='__CACHE_NAME__';
const PRECACHE=__PRECACHE__;
const SCOPE=new URL('./',self.location.href);
const OFFLINE=new URL('./offline.html',SCOPE).href;
const ASSETS=new Set(PRECACHE.map(p=>new URL(p,SCOPE).href));
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE_NAME);
  try {
   for(const url of ASSETS){
    const response=await fetch(new Request(url,{cache:'reload',credentials:'same-origin',redirect:'error'}));
    if(!response.ok||response.type==='opaque'||response.redirected)throw new Error('Asset not available');
    if(url===OFFLINE&&!(await response.clone().text()).includes('data-remontsmeta-shell'))throw new Error('Not an application shell');
    await cache.put(url,response);
   }
  }catch(error){await caches.delete(CACHE_NAME);throw error}
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('remontsmeta-shell-')&&key!==CACHE_NAME)await caches.delete(key);await self.clients.claim()})());
});
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting())});
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;
 const url=new URL(request.url);if(url.origin!==SCOPE.origin)return;
 // Leave authentication routes, APIs, downloads and unrelated pages to the network.
 if(request.mode==='navigate'&&(url.pathname===SCOPE.pathname||url.pathname===new URL('index.html',SCOPE).pathname||url.href===OFFLINE)){
  event.respondWith((async()=>{try{return await fetch(request)}catch{return (await caches.open(CACHE_NAME)).match(OFFLINE).then(r=>r||Response.error())}})());return;
 }
 if(ASSETS.has(url.href))event.respondWith((async()=>{const cache=await caches.open(CACHE_NAME);return (await cache.match(url.href))||fetch(request)})());
});

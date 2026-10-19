import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('../scripts/sw-template.js',import.meta.url),'utf8')).replace('__CACHE_NAME__','remontsmeta-shell-test').replace('__PRECACHE__',JSON.stringify(['./offline.html','./assets/app.js','./manifest.webmanifest']));
function harness(){
 const listeners=new Map(),data=new Map();let calls=0,skip=0,claimed=0;
 const getCache=name=>{if(!data.has(name))data.set(name,new Map());return {async put(key,response){data.get(name).set(typeof key==='string'?key:key.url,response.clone())},async match(key){return data.get(name).get(typeof key==='string'?key:key.url)?.clone()}}};
 const context={URL,Request,Response,Set,Error,console,self:{location:{href:'https://example.test/sw.js'},clients:{async claim(){claimed++}},async skipWaiting(){skip++},addEventListener(name,fn){listeners.set(name,fn)}},caches:{async open(name){return getCache(name)},async keys(){return [...data.keys()]},async delete(name){return data.delete(name)}},fetch:async request=>{calls++;const url=typeof request==='string'?request:request.url;return new Response(url.endsWith('offline.html')?'<html data-remontsmeta-shell>offline</html>':'compiled app',{status:200})}};
 vm.createContext(context);vm.runInContext(source,context);
 async function dispatch(name,fields={}){const waits=[];let response;listeners.get(name)({...fields,waitUntil:p=>waits.push(p),respondWith:p=>{response=Promise.resolve(p)}});await Promise.all(waits);return response?await response:undefined}
 return {context,data,dispatch,get calls(){return calls},get skip(){return skip},get claimed(){return claimed}};
}
test('SW заранее сохраняет все локальные файлы и не активирует обновление самовольно',async()=>{
 const h=harness();await h.dispatch('install');assert.equal(h.calls,3);assert.equal(h.data.get('remontsmeta-shell-test').size,3);assert.equal(h.skip,0);
});
test('SW при отсутствии сети отдаёт сохранённую оболочку и скомпилированный JS',async()=>{
 const h=harness();await h.dispatch('install');h.context.fetch=async()=>{throw Error('offline')};const page=await h.dispatch('fetch',{request:{url:'https://example.test/',method:'GET',mode:'navigate'}});assert.match(await page.text(),/data-remontsmeta-shell/);const asset=await h.dispatch('fetch',{request:{url:'https://example.test/assets/app.js',method:'GET',mode:'cors'}});assert.equal(await asset.text(),'compiled app');
});
test('SW не перехватывает авторизацию, API, POST и сторонние ресурсы',async()=>{
 const h=harness();for(const request of [{url:'https://example.test/login',method:'GET',mode:'navigate'},{url:'https://example.test/api/data',method:'GET',mode:'cors'},{url:'https://outside.test/assets/app.js',method:'GET',mode:'cors'},{url:'https://example.test/',method:'POST',mode:'navigate'}])assert.equal(await h.dispatch('fetch',{request}),undefined);
});
test('SW отказывается кэшировать страницу входа вместо приложения и удаляет неполный кэш',async()=>{
 const h=harness();h.context.fetch=async()=>new Response('<html>Sign in</html>');await assert.rejects(()=>h.dispatch('install'));assert.equal(h.data.has('remontsmeta-shell-test'),false);
});
test('SW при ошибке загрузки одного ресурса удаляет только свой новый кэш',async()=>{
 const h=harness();h.data.set('another-app-cache',new Map());let count=0;h.context.fetch=async()=>{if(++count===2)throw Error('network');return new Response('<html data-remontsmeta-shell>ok</html>')};await assert.rejects(()=>h.dispatch('install'));assert.equal(h.data.has('remontsmeta-shell-test'),false);assert.equal(h.data.has('another-app-cache'),true);
});
test('SW удаляет предыдущую свою версию при активации и не трогает чужие кэши',async()=>{
 const h=harness();await h.dispatch('install');h.data.set('remontsmeta-shell-old',new Map());h.data.set('other',new Map());await h.dispatch('activate');assert.ok(!h.data.has('remontsmeta-shell-old'));assert.ok(h.data.has('remontsmeta-shell-test'));assert.ok(h.data.has('other'));assert.equal(h.claimed,1);
});
test('SW активирует ожидающее обновление только после сообщения приложения',async()=>{
 const h=harness();await h.dispatch('install');assert.equal(h.skip,0);await h.dispatch('message',{data:{type:'ACTIVATE_UPDATE'}});assert.equal(h.skip,1);
});

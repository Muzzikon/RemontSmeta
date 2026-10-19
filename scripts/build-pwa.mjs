import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const dir=path.resolve('dist');
async function collect(folder){const result=[];for(const item of await readdir(folder,{withFileTypes:true})){const file=path.join(folder,item.name);if(item.isDirectory())result.push(...await collect(file));else result.push(path.relative(dir,file).split(path.sep).join('/'))}return result}
const html=await readFile(path.join(dir,'index.html'),'utf8');
await writeFile(path.join(dir,'offline.html'),html);
const files=(await collect(dir)).filter(f=>!['index.html','sw.js'].includes(f)).sort();
const hasher=createHash('sha256').update(html);
for(const file of files)hasher.update(file).update(await readFile(path.join(dir,file)));
const hash=hasher.digest('hex').slice(0,12);
const template=await readFile('scripts/sw-template.js','utf8');
await writeFile(path.join(dir,'sw.js'),template.replace('__CACHE_NAME__',`remontsmeta-shell-${hash}`).replace('__PRECACHE__',JSON.stringify(files.map(f=>'./'+f))));
console.log(`PWA: ${files.length} local assets, cache ${hash}`);

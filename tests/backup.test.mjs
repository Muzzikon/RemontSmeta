import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectRepository } from '../src/repository.ts';
import { ProjectService } from '../src/service.ts';
import { exportFullSnapshot, prepareSnapshot } from '../src/backup.ts';
import { estimateCsv, paymentsCsv, printMarkup } from '../src/export.ts';
import { allExpenses, projectAnalytics, receiptIds } from '../src/domain.ts';
function memory(){let value=null;return {getItem:()=>value,setItem:(key,next)=>{value=next}}}
function images(){const data=new Map();return {data,async put(r){data.set(r.id,structuredClone(r))},async get(id){return data.get(id)||null},async delete(ids){ids.forEach(id=>data.delete(id))},async list(){return [...data.values()].map(r=>({id:r.id,size_bytes:r.size_bytes}))}}}
const lock=async fn=>fn();const validWebp='UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoCAAIAAUAmJaQAA3AA/vz0AAA=';
const photo=()=>({blob:new Blob([Buffer.from(validWebp,'base64')],{type:'image/webp'}),width:2,height:2});
function setup(){const storage=memory(),repo=new ProjectRepository(storage),receipts=images();repo.load();repo.createProject('Исходная квартира',10000000);repo.addRoom('Кухня');const room=repo.get().rooms[0].id;repo.saveItem(room,null,'Плитка','material',1000000);const item=repo.get().rooms[0].items[0].id;const service=new ProjectService(repo,receipts,lock);return {storage,repo,receipts,service,item}}
const dto=(item,amount=500)=>({budgetItemId:item,amountCents:amount,spentAt:'2026-01-01',note:'Тестовый чек'});
async function withPhoto(){const f=setup();await f.service.saveExpense(dto(f.item),photo());return f}
test('полная копия сохраняет смету, платежи, байты фото и контрольную сумму',async()=>{
 const f=await withPhoto();const json=await f.service.exportSnapshot();const raw=JSON.parse(json);assert.equal(raw.format,'remontsmeta-backup');assert.equal(raw.receipts.length,1);assert.equal(raw.receipts[0].data_base64,validWebp);assert.match(raw.receipts[0].sha256,/^[a-f0-9]{64}$/);
 const prepared=await prepareSnapshot(json);assert.deepEqual(prepared.project,f.repo.get());assert.equal(await prepared.receipts[0].blob_data.text(),await photo().blob.text());
});
test('смета без фото экспортируется даже при недоступном IndexedDB',async()=>{
 const f=setup();f.receipts.get=async()=>{throw Error('blocked')};const raw=JSON.parse(await f.service.exportSnapshot());assert.deepEqual(raw.receipts,[]);
});
test('экспорт отказывается выдавать неполную копию при отсутствующем чеке',async()=>{
 const f=await withPhoto();f.receipts.data.clear();await assert.rejects(()=>f.service.exportSnapshot(),e=>e.code==='MISSING_RECEIPT');
});
test('изменение контрольной суммы, байтов, связей и версии отклоняется до импорта',async()=>{
 const f=await withPhoto(),raw=JSON.parse(await f.service.exportSnapshot()),before=f.repo.get();
 for(const change of [d=>d.receipts[0].sha256='0'.repeat(64),d=>d.receipts[0].data_base64='AAAA',d=>d.receipts[0].size_bytes=1,d=>d.receipts[0].id=crypto.randomUUID(),d=>d.receipts=[],d=>d.schema_version=999,d=>d.data.project.total_budget_cents=1.5,d=>d.receipts[0].width=1281]){const d=structuredClone(raw);change(d);await assert.rejects(()=>prepareSnapshot(JSON.stringify(d)));assert.deepEqual(f.repo.get(),before)}
});
test('дубли и лишние фотографии отклоняются',async()=>{
 const f=await withPhoto(),raw=JSON.parse(await f.service.exportSnapshot());raw.receipts.push(structuredClone(raw.receipts[0]));await assert.rejects(()=>prepareSnapshot(JSON.stringify(raw)));raw.receipts[1].id=crypto.randomUUID();await assert.rejects(()=>prepareSnapshot(JSON.stringify(raw)));
});
test('повреждённый JSON и несвязанный обычный JSON отклоняются',async()=>{
 for(const raw of ['{','null','[]','{}',JSON.stringify({version:'1.1.0',project:{}})])await assert.rejects(()=>prepareSnapshot(raw));
});
test('импорт в пустое хранилище восстанавливает все сущности и читаемые фото',async()=>{
 const source=await withPhoto(),snapshot=await prepareSnapshot(await source.service.exportSnapshot());const storage=memory(),repo=new ProjectRepository(storage),receipts=images();repo.load();const service=new ProjectService(repo,receipts,lock);await service.importSnapshot(snapshot);assert.equal(repo.get().id,source.repo.get().id);assert.equal(projectAnalytics(repo.get()).fact,500);assert.equal(receipts.data.size,1);const e=allExpenses(repo.get())[0].expense;assert.ok(receipts.data.has(e.receipt_id));assert.notEqual(e.receipt_id,snapshot.receipts[0].id);
 const reopened=new ProjectRepository(storage);assert.equal(projectAnalytics(reopened.load()).fact,500);
});
test('импорт заменяет текущий проект и убирает старые фото только после сохранения',async()=>{
 const old=await withPhoto(),source=await withPhoto();source.repo.updateProject('Новая смета',20000000);const prepared=await prepareSnapshot(await source.service.exportSnapshot());const oldId=[...old.receipts.data.keys()][0];const originalSet=old.storage.setItem;old.storage.setItem=(key,next)=>{assert.ok(old.receipts.data.has(oldId));originalSet(key,next)};await old.service.importSnapshot(prepared);assert.equal(old.repo.get().title,'Новая смета');assert.equal(old.receipts.data.size,1);assert.ok(!old.receipts.data.has(oldId));
});
test('ошибка записи метаданных при импорте оставляет исходный проект и чек',async()=>{
 const f=await withPhoto(),snapshot=await prepareSnapshot(await f.service.exportSnapshot()),before=f.repo.get(),ids=[...f.receipts.data.keys()];f.storage.setItem=()=>{throw new DOMException('quota','QuotaExceededError')};await assert.rejects(()=>f.service.importSnapshot(snapshot),e=>e.code==='STORAGE_QUOTA_EXCEEDED');assert.deepEqual(f.repo.get(),before);assert.deepEqual([...f.receipts.data.keys()],ids);
});
test('ошибка второго фото при импорте удаляет уже подготовленное первое',async()=>{
 const source=await withPhoto();await source.service.saveExpense(dto(source.item,600),photo());const snapshot=await prepareSnapshot(await source.service.exportSnapshot());const f=await withPhoto(),before=f.repo.get(),ids=[...f.receipts.data.keys()];let writes=0;const put=f.receipts.put;f.receipts.put=async r=>{if(++writes===2)throw Error('quota');await put(r)};await assert.rejects(()=>f.service.importSnapshot(snapshot));assert.deepEqual(f.repo.get(),before);assert.deepEqual([...f.receipts.data.keys()],ids);
});
test('устаревшая форма восстановления не начинает запись новых фото',async()=>{
 const f=await withPhoto(),snapshot=await prepareSnapshot(await f.service.exportSnapshot()),revision=f.repo.revision();f.repo.updateProject('Изменено',10000000);let writes=0;f.receipts.put=async()=>{writes++};await assert.rejects(()=>f.service.importSnapshot(snapshot,revision),e=>e.code==='STALE_DATA');assert.equal(writes,0);assert.equal(f.repo.get().title,'Изменено');
});
test('повторный старт очищает подготовленные фото после прерванного первого импорта',async()=>{
 const repo=new ProjectRepository(memory()),receipts=images();repo.load();await receipts.put({id:crypto.randomUUID(),size_bytes:44,blob_data:photo().blob});await new ProjectService(repo,receipts,lock).recover();assert.equal(receipts.data.size,0);assert.equal(repo.get(),null);
});
test('CSV использует BOM, запятую, CRLF и экранирует кавычки и переводы строк',()=>{
 const f=setup();f.repo.updateRoom(f.repo.get().rooms[0].id,'Кухня, "белая"');f.repo.saveItem(f.repo.get().rooms[0].id,f.item,'Плитка\nновая','material',10005);const csv=estimateCsv(f.repo.get());assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"Кухня, ""белая"""'));assert.ok(csv.includes('"Плитка\nновая"'));assert.ok(csv.includes('"100.05"'));assert.ok(csv.endsWith('\r\n'));
});
test('CSV защищает текстовые ячейки от формул, сохраняя числовые отрицательные остатки',()=>{
 const f=setup();f.repo.saveItem(f.repo.get().rooms[0].id,f.item,'=HYPERLINK("x")','material',100);f.repo.saveExpense({...dto(f.item,200),note:'\t=1+1'});const csv=estimateCsv(f.repo.get());assert.ok(csv.includes('"\'=HYPERLINK'));assert.ok(csv.includes('"-1.00"'));assert.ok(paymentsCsv(f.repo.get()).includes('"\'=1+1"'));const imported=f.repo.get();imported.rooms[0].items[0].expenses[0].note='\t=1+1';assert.ok(paymentsCsv(imported).includes('"\'\t=1+1"'));
});
test('CSV экспортирует все записи независимо от экранных фильтров',()=>{
 const f=setup();for(let i=0;i<35;i++)f.repo.saveExpense(dto(f.item,100));const csv=paymentsCsv(f.repo.get());assert.equal(csv.split('\r\n').length,37);
});
test('печатная форма содержит полную смету, правильные итоги и безопасный текст',()=>{
 const f=setup();f.repo.updateProject('<img onerror=alert(1)>',10000000);f.repo.saveExpense(dto(f.item,10000));const html=printMarkup(f.repo.get());assert.ok(!html.includes('<img onerror'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('Плитка'));assert.ok(html.includes('Итого по смете'));assert.ok(html.includes('Осталось от бюджета'));assert.ok(html.includes('thead'));
});
test('повторный экспорт после импорта воспроизводит байты чеков и финансовые итоги',async()=>{
 const source=await withPhoto(),snapshot=await prepareSnapshot(await source.service.exportSnapshot()),target=setup();await target.service.importSnapshot(snapshot);const second=await prepareSnapshot(await target.service.exportSnapshot());assert.equal(projectAnalytics(second.project).fact,projectAnalytics(snapshot.project).fact);assert.equal(await second.receipts[0].blob_data.text(),await snapshot.receipts[0].blob_data.text());assert.equal(receiptIds(second.project).size,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { ProjectRepository } from '../src/repository.ts';
import { ProjectService } from '../src/service.ts';
import { IndexedDbReceiptStore, RECEIPT_LIMIT } from '../src/receipts.ts';
import { projectAnalytics, evaluateItemStatus, allExpenses, receiptIds, validateStored, isCalendarDate, validateExpenseInput, todayLocal, STORAGE_KEY } from '../src/domain.ts';
import { fitDimensions, encodeToLimit, compressReceipt } from '../src/image.ts';
import { overview, estimate, history } from '../src/views.ts';
import { percentageLabel, statusLabel } from '../src/ui.ts';
function memory(){let value=null;return {getItem:()=>value,setItem:(key,next)=>{value=next}}}
function fixture(){const store=memory(),repo=new ProjectRepository(store);repo.load();repo.createProject('Квартира',120000000);repo.addRoom('Кухня');const room=repo.get().rooms[0];repo.saveItem(room.id,null,'Плитка','material',6000000);return {store,repo,item:repo.get().rooms[0].items[0].id,room:room.id}}
function receiptMemory(){const data=new Map();return {data,async put(r){data.set(r.id,structuredClone(r))},async get(id){return data.get(id)||null},async delete(ids){ids.forEach(id=>data.delete(id))},async list(){return [...data.values()].map(r=>({id:r.id,size_bytes:r.size_bytes}))}}}
const noLock=async task=>task();
const photo=()=>({blob:new Blob(['receipt'],{type:'image/webp'}),width:320,height:900});
const dto=(item,amount=10000)=>({budgetItemId:item,amountCents:amount,spentAt:'2026-01-01',note:'Покупка'});
const currentExpense=repo=>allExpenses(repo.get())[0].expense;
test('миграция старого формата не меняет UUID, план и дату создания',()=>{
 const {repo,store,item}=fixture();const old=JSON.parse(store.getItem(STORAGE_KEY));old.version='1.0.0';store.setItem(STORAGE_KEY,JSON.stringify(old));const next=new ProjectRepository(store);assert.deepEqual(next.load(),old.project);
 next.saveExpense(dto(item,29));const updated=JSON.parse(store.getItem(STORAGE_KEY));assert.equal(updated.version,'1.1.0');assert.equal(updated.project.id,old.project.id);assert.equal(updated.project.created_at,old.project.created_at);assert.equal(updated.project.rooms[0].items[0].planned_cents,6000000);
});
test('несколько платежей на статью, редактирование и удаление пересчитывают факт',()=>{
 const {repo,item}=fixture();repo.saveExpense(dto(item,10001));const first=currentExpense(repo);repo.saveExpense(dto(item,20002));assert.equal(projectAnalytics(repo.get()).fact,30003);
 repo.saveExpense({...dto(item,999),id:first.id,spentAt:'2026-02-01',note:' Исправлено '});assert.equal(projectAnalytics(repo.get()).fact,21001);assert.equal(currentExpense(repo).created_at,first.created_at);assert.equal(currentExpense(repo).note,'Исправлено');
 repo.deleteExpense(first.id);assert.equal(projectAnalytics(repo.get()).fact,20002);assert.throws(()=>repo.deleteExpense('missing'));
});
test('календарь, високосный год, локальная дата и запрет будущего',()=>{
 assert.equal(isCalendarDate('2024-02-29'),true);for(const date of ['2025-02-29','2026-02-30','2026-13-01','2026-00-10','2026-1-1','0000-01-01'])assert.equal(isCalendarDate(date),false);
 assert.equal(todayLocal(new Date(2026,9,17,23,30)),'2026-10-17');assert.throws(()=>validateExpenseInput(1,'2026-10-18','','2026-10-17'),e=>e.code==='INVALID_DATE_RANGE');assert.doesNotThrow(()=>validateExpenseInput(1,'2026-10-17','','2026-10-17'));
});
test('нулевые/отрицательные расходы, неверные даты, длинные заметки и неизвестные связи отклоняются',()=>{
 const {repo,item}=fixture();for(const change of [{amountCents:0},{amountCents:-1},{amountCents:1.1},{spentAt:'2026-02-30'},{spentAt:'9999-01-01'},{note:'x'.repeat(251)},{budgetItemId:'missing'},{id:'missing'}])assert.throws(()=>repo.saveExpense({...dto(item),...change}));assert.equal(projectAnalytics(repo.get()).fact,0);
});
test('точные пороги риска: ниже 90%, 90%, 100%, свыше 100%',()=>{
 for(const [fact,status]of [[8999,'ok'],[9000,'warning'],[10000,'warning'],[10001,'danger']])assert.equal(evaluateItemStatus(10000,fact).status,status);
 assert.equal(evaluateItemStatus(1000000000000000,899999999999999).status,'ok');assert.equal(evaluateItemStatus(1000000000000000,900000000000000).status,'warning');
});
test('нулевой план не даёт NaN, Infinity или скрытого перерасхода',()=>{
 assert.deepEqual(evaluateItemStatus(0,0),{status:'ok',percentage:0,deltaCents:0});const v=evaluateItemStatus(0,1);assert.equal(v.status,'danger');assert.equal(v.percentage,null);assert.equal(percentageLabel(v),'Без плановой суммы');assert.equal(statusLabel(v),'Перерасход');
});
test('сводка различает остаток денег, остаток сметы и нераспределённый план',()=>{
 const {repo,item}=fixture();repo.addRoom('Ванная');const bath=repo.get().rooms[1];repo.saveItem(bath.id,null,'Сантехника','work',9000000);const bathItem=repo.get().rooms[1].items[0].id;
 repo.saveExpense(dto(item,6000000));repo.saveExpense(dto(item,850000));repo.saveExpense(dto(bathItem,8550000));const a=projectAnalytics(repo.get());
 assert.equal(a.planned,15000000);assert.equal(a.fact,15400000);assert.equal(a.budgetRemaining,104600000);assert.equal(a.planRemaining,-400000);assert.equal(a.unallocated,105000000);assert.equal(a.risks.length,2);assert.equal(a.risks[0].status,'danger');assert.equal(a.risks[1].status,'warning');assert.equal(a.rooms[0].fact,6850000);
});
test('каскадное удаление статьи и комнаты исключает их расходы из аналитики',()=>{
 const {repo,item,room}=fixture();repo.saveExpense(dto(item,500));repo.deleteItem(item);assert.equal(projectAnalytics(repo.get()).fact,0);repo.saveItem(room,null,'Новая','work',100);repo.saveExpense(dto(repo.get().rooms[0].items[0].id,200));repo.deleteRoom(room);assert.equal(projectAnalytics(repo.get()).fact,0);assert.equal(projectAnalytics(repo.get()).risks.length,0);
});
test('платёж без фото не зависит от доступности IndexedDB',async()=>{
 const {repo,item}=fixture();const service=new ProjectService(repo,{async list(){throw Error('blocked')},async delete(){},async put(){throw Error('blocked')},async get(){throw Error('blocked')}},noLock);
 await service.saveExpense(dto(item),undefined);assert.equal(projectAnalytics(repo.get()).fact,10000);assert.equal(currentExpense(repo).receipt_id,null);
});
test('сначала сохраняется фото, затем метаданные; чтение после нового репозитория',async()=>{
 const {repo,store,item}=fixture();const images=receiptMemory();const service=new ProjectService(repo,images,noLock);const originalPut=images.put;images.put=async r=>{assert.equal(projectAnalytics(repo.get()).fact,0);await originalPut(r)};
 await service.saveExpense(dto(item),photo());const next=new ProjectRepository(store);next.load();const expense=currentExpense(next);assert.ok(expense.receipt_id);assert.equal(images.data.size,1);assert.equal((await images.get(expense.receipt_id)).blob_data.type,'image/webp');
});
test('ошибка записи фото не создаёт платёж',async()=>{
 const {repo,item}=fixture();const images=receiptMemory();images.put=async()=>{throw Error('quota')};const service=new ProjectService(repo,images,noLock);await assert.rejects(()=>service.saveExpense(dto(item),photo()));assert.equal(projectAnalytics(repo.get()).expenseCount,0);assert.equal(images.data.size,0);
});
test('ошибка LocalStorage после записи фото удаляет новый файл и сохраняет старое состояние',async()=>{
 const {repo,store,item}=fixture();const images=receiptMemory();const service=new ProjectService(repo,images,noLock);const before=repo.get();store.setItem=()=>{throw new DOMException('quota','QuotaExceededError')};
 await assert.rejects(()=>service.saveExpense(dto(item),photo()),e=>e.code==='STORAGE_QUOTA_EXCEEDED');assert.deepEqual(repo.get(),before);assert.equal(images.data.size,0);
});
test('замена фото не удаляет старое до подтверждения метаданных',async()=>{
 const {repo,store,item}=fixture();const images=receiptMemory(),service=new ProjectService(repo,images,noLock);await service.saveExpense(dto(item),photo());const old=currentExpense(repo);const put=images.put;images.put=async r=>{assert.equal(currentExpense(repo).receipt_id,old.receipt_id);assert.ok(images.data.has(old.receipt_id));await put(r)};
 const save=store.setItem;store.setItem=()=>{throw Error('denied')};await assert.rejects(()=>service.saveExpense({...dto(item,222),id:old.id},photo()));assert.equal(images.data.size,1);assert.ok(images.data.has(old.receipt_id));assert.equal(currentExpense(repo).amount_cents,10000);
 store.setItem=save;await service.saveExpense({...dto(item,222),id:old.id},photo());assert.equal(images.data.size,1);assert.ok(!images.data.has(old.receipt_id));assert.equal(currentExpense(repo).amount_cents,222);
});
test('редактирование без нового файла сохраняет чек, явное удаление убирает его',async()=>{
 const {repo,item}=fixture();const images=receiptMemory(),service=new ProjectService(repo,images,noLock);await service.saveExpense(dto(item),photo());const e=currentExpense(repo);await service.saveExpense({...dto(item,42),id:e.id},undefined);assert.equal(currentExpense(repo).receipt_id,e.receipt_id);assert.equal(images.data.size,1);await service.saveExpense({...dto(item,42),id:e.id},null);assert.equal(currentExpense(repo).receipt_id,null);assert.equal(images.data.size,0);
});
test('удаление платежа и комнаты очищает только непривязанные фото',async()=>{
 const {repo,item,room}=fixture();repo.addRoom('Другая');repo.saveItem(repo.get().rooms[1].id,null,'Работа','work',10000);const second=repo.get().rooms[1].items[0].id;
 const images=receiptMemory(),service=new ProjectService(repo,images,noLock);await service.saveExpense(dto(item),photo());await service.saveExpense(dto(second),photo());const e=currentExpense(repo);await service.remove(()=>repo.deleteExpense(e.id));assert.equal(images.data.size,1);assert.equal(projectAnalytics(repo.get()).fact,10000);await service.remove(()=>repo.deleteRoom(repo.get().rooms[1].id));assert.equal(images.data.size,0);
});
test('перезапуск удаляет фото, оставшееся при прерывании до записи метаданных',async()=>{
 const {repo,item}=fixture();const images=receiptMemory(),service=new ProjectService(repo,images,noLock);await service.saveExpense(dto(item),photo());const id=currentExpense(repo).receipt_id;
 await images.put({id:crypto.randomUUID(),size_bytes:5,blob_data:photo().blob});assert.equal(images.data.size,2);await service.recover();assert.equal(images.data.size,1);assert.ok(images.data.has(id));
});
test('сбой очистки после удаления не отменяет совершённую операцию; повторный запуск завершает очистку',async()=>{
 const {repo,item}=fixture();const images=receiptMemory(),service=new ProjectService(repo,images,noLock);await service.saveExpense(dto(item),photo());const remove=images.delete;images.delete=async()=>{throw Error('blocked')};await service.remove(()=>repo.deleteItem(item));assert.equal(projectAnalytics(repo.get()).fact,0);assert.match(service.notice,/сохранены/);assert.equal(images.data.size,1);images.delete=remove;await service.recover();assert.equal(images.data.size,0);
});
test('недостающий чек не удаляет платёж и явно отмечается при восстановлении',async()=>{
 const {repo,item}=fixture();const images=receiptMemory(),service=new ProjectService(repo,images,noLock);await service.saveExpense(dto(item),photo());images.data.clear();await service.recover();assert.match(service.notice,/не все фото/i);assert.equal(projectAnalytics(repo.get()).fact,10000);
});
test('устаревшая форма отклоняется до записи фото',async()=>{
 const {repo,item}=fixture();const images=receiptMemory(),service=new ProjectService(repo,images,noLock);const revision=repo.revision();repo.updateProject('Изменено',120000000);await assert.rejects(()=>service.saveExpense(dto(item),photo(),revision),e=>e.code==='STALE_DATA');assert.equal(images.data.size,0);assert.equal(projectAnalytics(repo.get()).fact,0);
});
test('IndexedDB: добавление, чтение после открытия нового адаптера, метаданные и удаление',async()=>{
 const factory=new IDBFactory(),name='receipts-test';const store=new IndexedDbReceiptStore(factory,name);const image=photo(),id=crypto.randomUUID();const record={id,mime_type:'image/webp',size_bytes:image.blob.size,width:image.width,height:image.height,created_at:new Date().toISOString(),blob_data:image.blob};
 await store.put(record);await store.close();const next=new IndexedDbReceiptStore(factory,name);assert.equal((await next.get(id)).id,id);assert.equal(await (await next.get(id)).blob_data.text(),'receipt');assert.deepEqual(await next.list(),[{id,size_bytes:7}]);await next.delete([id]);assert.equal(await next.get(id),null);await next.close();
});
test('IndexedDB: повторный ID откатывает транзакцию и сохраняет старый файл',async()=>{
 const store=new IndexedDbReceiptStore(new IDBFactory(),'duplicate');const image=photo(),id=crypto.randomUUID(),record={id,mime_type:'image/webp',size_bytes:7,width:320,height:900,created_at:new Date().toISOString(),blob_data:image.blob};await store.put(record);await assert.rejects(()=>store.put({...record,blob_data:new Blob(['other'],{type:'image/webp'})}));assert.equal(await (await store.get(id)).blob_data.text(),'receipt');await store.close();
});
test('IndexedDB: запрещает слишком большие и неподготовленные фото',async()=>{
 const store=new IndexedDbReceiptStore(new IDBFactory(),'invalid');for(const blob of [new Blob(['x'],{type:'image/png'}),new Blob([new Uint8Array(RECEIPT_LIMIT+1)],{type:'image/webp'}),new Blob([],{type:'image/webp'})])await assert.rejects(()=>store.put({id:crypto.randomUUID(),blob_data:blob,width:320,height:900}));assert.equal((await store.list()).length,0);await store.close();
});
test('сжатие соблюдает пропорции, предел 1280 и не увеличивает маленькое фото',()=>{
 assert.deepEqual(fitDimensions(4000,2000),{width:1280,height:640});assert.deepEqual(fitDimensions(600,1200),{width:600,height:1200});assert.throws(()=>fitDimensions(10000,10000));assert.throws(()=>fitDimensions(0,1));
});
test('сжатие проверяет фактический размер и уменьшает разрешение при необходимости',async()=>{
 const calls=[];const result=await encodeToLimit(2560,1280,async(w,h,q)=>{calls.push({w,h,q});return new Blob([new Uint8Array(w>1100?400000:200000)],{type:'image/webp'})});assert.ok(result.blob.size<=RECEIPT_LIMIT);assert.deepEqual({width:result.width,height:result.height},{width:1024,height:512});assert.equal(calls[0].q,.75);assert.equal(calls.length,5);
});
test('сжатие отклоняет неподдерживаемый WebP, пустой результат и превышение лимита',async()=>{
 await assert.rejects(()=>encodeToLimit(800,600,async()=>new Blob(['x'],{type:'image/png'})),e=>e.code==='IMAGE_PROCESSING_ERROR');await assert.rejects(()=>encodeToLimit(800,600,async()=>new Blob([],{type:'image/webp'})));await assert.rejects(()=>encodeToLimit(800,600,async()=>new Blob([new Uint8Array(RECEIPT_LIMIT+1)],{type:'image/webp'})));
});
test('файлы неподдерживаемых типов и слишком большого размера отсекаются до декодирования',async()=>{
 await assert.rejects(()=>compressReceipt(new File(['x'],'bad.svg',{type:'image/svg+xml'})),e=>e.code==='UNSUPPORTED_MEDIA_TYPE');await assert.rejects(()=>compressReceipt(new File([],'empty.jpg',{type:'image/jpeg'})));await assert.rejects(()=>compressReceipt(new File([new Uint8Array(25*1024*1024+1)],'huge.jpg',{type:'image/jpeg'})));
});
test('полная схема платежа проверяет FK, дату, копейки и уникальность чека',()=>{
 const {repo,store,item}=fixture();repo.saveExpense(dto(item));const base=JSON.parse(store.getItem(STORAGE_KEY));for(const change of [d=>d.project.rooms[0].items[0].expenses[0].spent_at='2026-02-30',d=>d.project.rooms[0].items[0].expenses[0].budget_item_id='missing',d=>d.project.rooms[0].items[0].expenses[0].amount_cents=0,d=>d.project.rooms[0].items[0].expenses[0].receipt_id='bad',d=>d.version='1.0.0']){const next=structuredClone(base);change(next);assert.throws(()=>validateStored(next))}
});
test('платежи не допускают переполнения агрегатов',()=>{
 const {repo,item}=fixture();repo.saveExpense(dto(item,Number.MAX_SAFE_INTEGER));assert.throws(()=>repo.saveExpense(dto(item,1)));assert.equal(allExpenses(repo.get()).length,1);
});
test('шаблоны сводки, сметы и истории экранируют данные и отображают реальные суммы',()=>{
 const {repo,item}=fixture();repo.updateProject('<script>alert(1)</script>',120000000);repo.updateRoom(repo.get().rooms[0].id,'<img src=x>');repo.saveItem(repo.get().rooms[0].id,item,'<script>x</script>','material',100);repo.saveExpense({...dto(item,101),note:'<img onerror=alert(1)>'});const p=repo.get(),s={selected:'all',filter:'all',query:'',historyItem:'',historyPage:1};for(const html of [overview(p),estimate(p,s),history(p,s)]){assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img onerror'));assert.match(html,/&lt;script&gt;x/)}assert.match(overview(p),/Перерасход/);assert.match(history(p,s),/01\.01\.2026/);
});
test('история ограничивает число строк и поддерживает фильтр статьи',()=>{
 const {repo,item}=fixture();const p=repo.get();p.rooms[0].items[0].expenses=Array.from({length:65},(_,i)=>({id:crypto.randomUUID(),budget_item_id:item,amount_cents:1,spent_at:'2026-01-01',created_at:`2026-01-01T00:00:${String(i%60).padStart(2,'0')}.000Z`,note:'',receipt_id:null}));
 const state={selected:'all',filter:'all',query:'',historyItem:'',historyPage:1};assert.equal((history(p,state).match(/class="payment-row"/g)||[]).length,30);state.historyPage=3;assert.equal((history(p,state).match(/class="payment-row"/g)||[]).length,5);assert.equal(receiptIds(p).size,0);
});
test('схема допускает 10 000 платежей и отклоняет 10 001, суммы остаются точными',()=>{
 const {repo,store,item}=fixture();const data=JSON.parse(store.getItem(STORAGE_KEY));data.project.rooms[0].items[0].expenses=Array.from({length:10000},()=>({id:crypto.randomUUID(),budget_item_id:item,amount_cents:1,spent_at:'2026-01-01',created_at:'2026-01-01T00:00:00.000Z',note:'',receipt_id:null}));assert.doesNotThrow(()=>validateStored(data));assert.equal(projectAnalytics(data.project).fact,10000);data.project.rooms[0].items[0].expenses.push({...data.project.rooms[0].items[0].expenses[0],id:crypto.randomUUID()});assert.throws(()=>validateStored(data));
});
test('один чек не может быть привязан к двум платежам',()=>{
 const {repo,store,item}=fixture();repo.saveExpense(dto(item));repo.saveExpense(dto(item));const data=JSON.parse(store.getItem(STORAGE_KEY)),id=crypto.randomUUID();data.project.rooms[0].items[0].expenses.forEach(e=>e.receipt_id=id);assert.throws(()=>validateStored(data));
});
test('синхронный отказ открытия IndexedDB локализован, повторная попытка не зависает',async()=>{
 const store=new IndexedDbReceiptStore({open(){throw new DOMException('denied','SecurityError')}},'blocked');for(let i=0;i<2;i++)await assert.rejects(()=>store.list(),e=>e.code==='RECEIPT_STORAGE_ERROR');
});
test('округление процента не маскирует переход через порог',()=>{
 assert.equal(percentageLabel(evaluateItemStatus(100000,89999)),'менее 90%');assert.equal(percentageLabel(evaluateItemStatus(100000,100001)),'более 100%');
});

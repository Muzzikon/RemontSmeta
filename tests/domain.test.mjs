import test from 'node:test';
import assert from 'node:assert/strict';
import { MoneyEngine, sumCents, totals, validateStored, STORAGE_KEY } from '../src/domain.ts';
import { ProjectRepository } from '../src/repository.ts';
function memory() { let raw=null;return {getItem:()=>raw,setItem:(key,value)=>{raw=value}} }
function fixture() { const store=memory(); const repo=new ProjectRepository(store);repo.load();repo.createProject('Квартира',120000000);return {store,repo} }
test('точный разбор рублей и копеек без ошибок float',()=>{
 for(const [raw,cents] of [['1,01',101],['0,29',29],['12.4',1240],[' 1 250,50 р ',125050],['1\u202f200\u00a0000 ₽',120000000],['10 руб.',1000],['0001.05',105]]) assert.equal(MoneyEngine.parseToCents(raw),cents);
});
test('не принимает мусор, отрицательные и неоднозначные суммы',()=>{
 for(const raw of ['', ' ', '0', '-1', 'Infinity', '12abc', '1.005', '1e5', '1,2,3', '.5', '1.', '1000000000000000']) assert.throws(()=>MoneyEngine.parseToCents(raw));
 assert.equal(MoneyEngine.parseToCents('0',true),0);
});
test('точный расчёт на пределе безопасного целого',()=>{
 assert.equal(MoneyEngine.parseToCents('90071992547409.91'),Number.MAX_SAFE_INTEGER);
 assert.throws(()=>MoneyEngine.parseToCents('90071992547409.92'));
 assert.equal(sumCents([10,20,70]),100);assert.throws(()=>sumCents([Number.MAX_SAFE_INTEGER,1]));
});
test('нулевое и заполненное состояние',()=>{
 const store=memory(),repo=new ProjectRepository(store);assert.equal(repo.load(),null);
 repo.createProject('  Квартира  ',120000000);assert.equal(repo.get().title,'Квартира');
 assert.throws(()=>repo.createProject('Другой ремонт',100));
 assert.deepEqual(totals(repo.get()),{planned:0,work:0,material:0,unallocated:120000000,count:0});
});
test('CRUD комнат и статей, правильные итоги и категории',()=>{
 const {repo}=fixture();repo.addRoom('Кухня');const room=repo.get().rooms[0];
 repo.saveItem(room.id,null,'Плитка','material',10001);repo.saveItem(room.id,null,'Укладка','work',20002);
 let p=repo.get();assert.equal(totals(p).planned,30003);assert.equal(totals(p).material,10001);assert.equal(totals(p).work,20002);
 repo.updateRoom(room.id,'Санузел');const item=p.rooms[0].items[0];
 repo.saveItem(room.id,item.id,'Грунтовка','work',5025);p=repo.get();assert.equal(p.rooms[0].name,'Санузел');assert.equal(totals(p).work,25027);assert.equal(totals(p).material,0);
 repo.deleteItem(item.id);assert.equal(totals(repo.get()).planned,20002);
 repo.deleteRoom(room.id);assert.equal(repo.get().rooms.length,0);assert.equal(totals(repo.get()).planned,0);
});
test('перераспределение бюджета не блокируется, превышение видно в дельте',()=>{
 const {repo}=fixture();repo.addRoom('Кухня');repo.saveItem(repo.get().rooms[0].id,null,'Материалы','material',120000001);
 assert.equal(totals(repo.get()).unallocated,-1);repo.updateProject('Дом',130000000);assert.equal(totals(repo.get()).unallocated,9999999);
});
test('перезагрузка сохраняет все сущности и UUID v4',()=>{
 const {store,repo}=fixture();repo.addRoom('Кухня');const id=repo.get().rooms[0].id;repo.saveItem(id,null,'Плитка','material',19999);
 const next=new ProjectRepository(store);assert.deepEqual(next.load(),repo.get());assert.match(id,/^[\da-f-]{14}4/);
});
test('возвращаемый объект не позволяет изменить внутреннее состояние',()=>{
 const {repo}=fixture();const p=repo.get();p.title='Извне';p.rooms.push({});assert.equal(repo.get().title,'Квартира');assert.equal(repo.get().rooms.length,0);
});
test('ошибка квоты не меняет состояние ни в памяти, ни в хранилище',()=>{
 const {store,repo}=fixture();const before=repo.get(),raw=store.getItem(STORAGE_KEY);
 store.setItem=()=>{throw new DOMException('quota','QuotaExceededError')};
 assert.throws(()=>repo.addRoom('Кухня'),e=>e.code==='STORAGE_QUOTA_EXCEEDED');assert.deepEqual(repo.get(),before);assert.equal(store.getItem(STORAGE_KEY),raw);
});
test('ошибка доступа к хранилищу получает понятный код',()=>{
 const repo=new ProjectRepository({getItem(){throw new Error('denied')},setItem(){}});assert.throws(()=>repo.load(),e=>e.code==='STORAGE_UNAVAILABLE');
});
test('испорченный JSON не затирается при запуске',()=>{
 const store=memory();store.setItem(STORAGE_KEY,'{broken');const repo=new ProjectRepository(store);assert.throws(()=>repo.load(),e=>e.code==='CORRUPTED_BACKUP_SCHEMA');assert.equal(store.getItem(STORAGE_KEY),'{broken');
});
test('отклоняет неизвестную версию, неверную категорию, связи и дубли ID',()=>{
 const {store,repo}=fixture();repo.addRoom('Кухня');repo.saveItem(repo.get().rooms[0].id,null,'Плитка','material',100);
 const base=JSON.parse(store.getItem(STORAGE_KEY));
 for(const change of [d=>d.version='2',d=>d.project.rooms[0].project_id='wrong',d=>d.project.rooms[0].items[0].type='bad',d=>d.project.rooms[0].items[0].id=d.project.rooms[0].id,d=>d.project.rooms[0].items[0].planned_cents=1.1,d=>d.project.rooms[0].items[0].expenses.push({})]){
 const d=structuredClone(base);change(d);assert.throws(()=>validateStored(d));
 }
});
test('валидация имени применяется и в сервисе, без UI',()=>{
 const {repo}=fixture();assert.throws(()=>repo.addRoom('   '));assert.throws(()=>repo.addRoom('a'.repeat(51)));assert.equal(repo.get().rooms.length,0);assert.throws(()=>repo.updateProject('',100));
});
test('не сохраняет некорректные суммы и переполнение агрегата',()=>{
 const {repo}=fixture();repo.addRoom('Кухня');const room=repo.get().rooms[0].id;
 for (const cents of [-1,NaN,Infinity,1.1,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>repo.saveItem(room,null,'Работа','work',cents));
 repo.saveItem(room,null,'Предел','work',Number.MAX_SAFE_INTEGER);assert.throws(()=>repo.saveItem(room,null,'Ещё','work',1));assert.equal(repo.get().rooms[0].items.length,1);
});
test('проверка устаревшего состояния между вкладками',()=>{
 const {store,repo}=fixture();const tab=new ProjectRepository(store);tab.load();repo.addRoom('Кухня');assert.throws(()=>tab.addRoom('Ванная'),e=>e.code==='STALE_DATA');assert.equal(JSON.parse(store.getItem(STORAGE_KEY)).project.rooms.length,1);
});
test('удаление перенумеровывает комнаты и неизвестные ID отклоняются',()=>{
 const {repo}=fixture();repo.addRoom('Кухня');repo.addRoom('Ванная');repo.deleteRoom(repo.get().rooms[0].id);assert.equal(repo.get().rooms[0].order_index,0);assert.throws(()=>repo.deleteRoom('missing'));assert.throws(()=>repo.deleteItem('missing'));
});
test('демо создаётся явно, имеет ожидаемые итоги и не перезаписывает смету',()=>{
 const repo=new ProjectRepository(memory());repo.load();repo.createDemo();assert.equal(repo.get().rooms.length,4);assert.equal(totals(repo.get()).count,12);assert.equal(totals(repo.get()).planned,88000000);assert.equal(totals(repo.get()).unallocated,32000000);assert.throws(()=>repo.createDemo());
});

test('форматирование не теряет копейки на верхней границе',()=>{
 assert.equal(MoneyEngine.formatCents(Number.MAX_SAFE_INTEGER).replace(/[\s\u00a0\u202f]/g,''),'90071992547409,91₽');
 assert.equal(MoneyEngine.input(Number.MAX_SAFE_INTEGER),'90071992547409,91');
 assert.equal(MoneyEngine.formatCents(29).replace(/[\s\u00a0\u202f]/g,''),'0,29₽');
});

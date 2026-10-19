import { AppError, STORAGE_KEY, textField, validateStored, DATA_VERSION, validateExpenseInput, allExpenses, type RepairProject, type ItemType } from './domain.ts';
export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
export class ProjectRepository {
 private raw: string | null = null;
 private project: RepairProject | null = null;
 private storage: StoragePort;
 constructor(storage: StoragePort) { this.storage = storage }
 load(): RepairProject | null {
  let raw: string | null;
  try { raw = this.storage.getItem(STORAGE_KEY) } catch { throw new AppError('STORAGE_UNAVAILABLE', 'Браузер запретил доступ к хранилищу. Разрешите хранение данных или откройте приложение в обычном окне.') }
  if (raw === null) { this.raw = null; this.project = null; return null }
  // Retain the actual revision even on corruption, so an explicitly confirmed
  // restore can replace it without clearing storage first.
  this.raw=raw;this.project=null;
  try { const parsed: unknown = JSON.parse(raw); validateStored(parsed); this.raw = raw; this.project = parsed.project; return this.get() }
  catch (e) { if (e instanceof AppError) throw e; throw new AppError('CORRUPTED_BACKUP_SCHEMA', 'Не удалось прочитать смету. Исходные данные не изменены.') }
 }
 get(): RepairProject | null { return this.project ? structuredClone(this.project) : null }
 revision(): string | null { return this.raw }
 assertRevision(expected: string | null = this.raw): void {
  if (this.storage.getItem(STORAGE_KEY) !== expected) throw new AppError('STALE_DATA','Смета изменилась в другой вкладке. Закройте форму и откройте её заново.');
 }
 private commit(next: RepairProject): void {
  next.updated_at = new Date().toISOString();
  const envelope = {version:DATA_VERSION, project:next}; validateStored(envelope);
  try {
   if (this.storage.getItem(STORAGE_KEY) !== this.raw) throw new AppError('STALE_DATA', 'Смета изменилась в другой вкладке. Обновите страницу и повторите действие.');
   const serialized = JSON.stringify(envelope);
   this.storage.setItem(STORAGE_KEY, serialized);
   this.raw = serialized; this.project = structuredClone(next);
  } catch (e) {
   if (e instanceof AppError) throw e;
   if (e instanceof Error && e.name === 'QuotaExceededError') throw new AppError('STORAGE_QUOTA_EXCEEDED', 'Память браузера заполнена. Изменения не сохранены. Освободите место и повторите.');
   throw new AppError('STORAGE_UNAVAILABLE', 'Не удалось сохранить изменения. Проверьте разрешение на хранение данных.');
  }
 }
 private mutate(action: (draft: RepairProject) => void): void {
  const draft = this.get(); if (!draft) throw new AppError('ENTITY_NOT_FOUND', 'Сначала создайте ремонт.');
  action(draft); this.commit(draft);
 }
 createProject(title: string, totalBudgetCents: number): void {
  if (this.project) throw new AppError('ALREADY_EXISTS', 'Уже есть активный ремонт.');
  const now = new Date().toISOString();
  this.commit({id:crypto.randomUUID(),title:textField(title,100),total_budget_cents:totalBudgetCents,created_at:now,updated_at:now,rooms:[]});
 }
 updateProject(title: string, budget: number): void { this.mutate(p => { p.title = textField(title,100); p.total_budget_cents = budget }) }
 addRoom(name: string): void { this.mutate(p => { p.rooms.push({id:crypto.randomUUID(),project_id:p.id,name:textField(name,50),order_index:p.rooms.length,items:[]}) }) }
 updateRoom(id: string, name: string): void { this.mutate(p => { const r = p.rooms.find(r=>r.id===id); if (!r) throw new AppError('ENTITY_NOT_FOUND','Комната не найдена.'); r.name=textField(name,50) }) }
 deleteRoom(id: string): void { this.mutate(p=>{ if (!p.rooms.some(r=>r.id===id)) throw new AppError('ENTITY_NOT_FOUND','Комната не найдена.'); p.rooms=p.rooms.filter(r=>r.id!==id); p.rooms.forEach((r,i)=>r.order_index=i) }) }
 saveItem(roomId: string, id: string | null, name: string, type: ItemType, cents: number): void {
  this.mutate(p=>{
   const room=p.rooms.find(r=>r.id===roomId); if (!room) throw new AppError('ENTITY_NOT_FOUND','Комната не найдена.');
   if (id) { const item=room.items.find(i=>i.id===id); if (!item) throw new AppError('ENTITY_NOT_FOUND','Статья не найдена.'); Object.assign(item,{name:textField(name,80),type,planned_cents:cents}) }
   else { if (p.rooms.reduce((n,r)=>n+r.items.length,0)>=1000) throw new AppError('LIMIT_REACHED','Достигнут лимит 1000 статей.'); room.items.push({id:crypto.randomUUID(),room_id:roomId,name:textField(name,80),type,planned_cents:cents,expenses:[]}) }
  });
 }
 deleteItem(id: string): void { this.mutate(p=>{ const room=p.rooms.find(r=>r.items.some(i=>i.id===id)); if (!room) throw new AppError('ENTITY_NOT_FOUND','Статья не найдена.'); room.items=room.items.filter(i=>i.id!==id) }) }
 saveExpense(dto: { id?: string; budgetItemId: string; amountCents: number; spentAt: string; note?: string; receiptId?: string | null }): void {
  const note = (dto.note || '').trim(); validateExpenseInput(dto.amountCents,dto.spentAt,note);
  this.mutate(p=>{
   const item=p.rooms.flatMap(r=>r.items).find(i=>i.id===dto.budgetItemId);
   if (!item) throw new AppError('ENTITY_NOT_FOUND','Статья не найдена.');
   if (dto.id) {
    const expense=item.expenses.find(e=>e.id===dto.id);
    if (!expense) throw new AppError('ENTITY_NOT_FOUND','Платёж не найден.');
    Object.assign(expense,{amount_cents:dto.amountCents,spent_at:dto.spentAt,note});
    if (dto.receiptId !== undefined) expense.receipt_id=dto.receiptId;
   } else {
    if (allExpenses(p).length >= 10000) throw new AppError('LIMIT_REACHED','Достигнут лимит 10 000 платежей.');
    item.expenses.push({id:crypto.randomUUID(),budget_item_id:item.id,amount_cents:dto.amountCents,spent_at:dto.spentAt,note,receipt_id:dto.receiptId || null,created_at:new Date().toISOString()});
   }
  });
 }
 deleteExpense(id: string): void { this.mutate(p=>{
  const item=p.rooms.flatMap(r=>r.items).find(i=>i.expenses.some(e=>e.id===id));
  if (!item) throw new AppError('ENTITY_NOT_FOUND','Платёж не найден.');
  item.expenses=item.expenses.filter(e=>e.id!==id);
 }) }
 replaceProject(project: RepairProject): void { this.commit(structuredClone(project)) }
 createDemo(): void {
  if (this.project) throw new AppError('ALREADY_EXISTS','Демонстрационный пример можно открыть только до создания ремонта.');
  const now=new Date().toISOString(); const p: RepairProject={id:crypto.randomUUID(),title:'Квартира на Ленина',total_budget_cents:120000000,created_at:now,updated_at:now,rooms:[]};
  const example: [string,[string,ItemType,number][]][]=[['Кухня',[['Подготовка стен','work',55000],['Кухонный гарнитур','material',210000],['Плитка для фартука','material',35000],['Укладка плитки','work',25000]]],['Гостиная',[['Покраска стен','work',45000],['Напольное покрытие','material',85000],['Освещение','material',40000]]],['Санузел',[['Разводка сантехники','work',65000],['Сантехника','material',120000],['Керамогранит','material',80000]]],['Прихожая',[['Подготовка и отделка','work',50000],['Входная дверь','material',70000]]]];
  for (const [name,items] of example) { const id=crypto.randomUUID(); p.rooms.push({id,project_id:p.id,name,order_index:p.rooms.length,items:items.map(([name,type,rubles])=>({id:crypto.randomUUID(),room_id:id,name,type,planned_cents:rubles*100,expenses:[]}))}) }
  this.commit(p);
 }
}

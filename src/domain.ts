export type ItemType = 'work' | 'material';
export interface ExpenseTransaction { id: string; budget_item_id: string; amount_cents: number; spent_at: string; note: string; receipt_id: string | null; created_at: string }
export interface BudgetItem { id: string; room_id: string; name: string; type: ItemType; planned_cents: number; expenses: ExpenseTransaction[] }
export interface Room { id: string; project_id: string; name: string; order_index: number; items: BudgetItem[] }
export interface RepairProject { id: string; title: string; total_budget_cents: number; created_at: string; updated_at: string; rooms: Room[] }
export const STORAGE_KEY = 'remont_smeta_v1_project';
export class AppError extends Error { code: string; constructor(code: string, message: string) { super(message); this.name = 'AppError'; this.code = code } }
export function textField(raw: string, max: number): string {
 const text = raw.trim();
 if (!text || text.length > max) throw new AppError('VALIDATION_FAILED', `Введите от 1 до ${max} символов.`);
 return text;
}
const currencyFormatter = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
// Parse digits directly. No parseFloat or binary fraction multiplication.
export class MoneyEngine {
 static parseToCents(raw: string, allowZero = false): number {
  const value = raw.trim().replace(/[\s\u00a0\u202f]/g, '').replace(/(?:₽|руб\.?|р\.?)$/iu, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new AppError('VALIDATION_FAILED', 'Введите сумму в рублях, не более двух знаков после запятой.');
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || (allowZero ? cents < 0n : cents <= 0n)) throw new AppError('VALIDATION_FAILED', 'Укажите допустимую положительную сумму.');
  return Number(cents);
 }
 static formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new AppError('VALIDATION_FAILED', 'Некорректная сумма.');
  const amount = BigInt(cents); const absolute = amount < 0n ? -amount : amount;
  const parts = currencyFormatter.formatToParts(absolute / 100n);
  const lastInteger = parts.map(p => p.type).lastIndexOf('integer');
  const fraction = absolute % 100n;
  return (amount < 0n ? '−' : '') + parts.map((p,i) => p.value + (i === lastInteger && fraction ? ',' + String(fraction).padStart(2, '0') : '')).join('');
 }
 static input(cents: number): string { const amount = BigInt(cents); return `${amount / 100n},${String(amount % 100n).padStart(2, '0')}` }
}
export function sumCents(values: number[]): number {
 const result = values.reduce((a, b) => a + BigInt(b), 0n);
 if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError('VALIDATION_FAILED', 'Общая сумма слишком велика для точного расчёта.');
 return Number(result);
}
export function totals(project: RepairProject) {
 const items = project.rooms.flatMap(r => r.items);
 const planned = sumCents(items.map(i => i.planned_cents));
 return { planned, work: sumCents(items.filter(i => i.type === 'work').map(i => i.planned_cents)), material: sumCents(items.filter(i => i.type === 'material').map(i => i.planned_cents)), unallocated: project.total_budget_cents - planned, count: items.length };
}
// A versioned envelope keeps room for storage migrations. Validate before use.
export const DATA_VERSION = '1.1.0' as const;
export interface StoredData { version: '1.0.0' | '1.1.0'; project: RepairProject }
export function validateStored(value: unknown): asserts value is StoredData {
 const invalid = () => { throw new AppError('CORRUPTED_BACKUP_SCHEMA', 'Сохранённая смета имеет неподдерживаемый или повреждённый формат. Исходные данные сохранены.'); };
 if (!value || typeof value !== 'object') invalid();
 const data = value as StoredData;
 if (!['1.0.0','1.1.0'].includes(data.version) || !data.project || typeof data.project !== 'object') invalid();
 const ids = new Set<string>();
 const id = (v: unknown) => { if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) || ids.has(v)) invalid(); ids.add(v as string) };
 const text = (v: unknown, max: number) => { if (typeof v !== 'string' || !v.trim() || v.length > max) invalid() };
 const money = (v: unknown, zero = false) => { if (!Number.isSafeInteger(v) || (v as number) < (zero ? 0 : 1)) invalid() };
 const timestamp = (v: unknown) => { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(v) || !Number.isFinite(Date.parse(v))) invalid() };
 const p = data.project; id(p.id); text(p.title, 100); money(p.total_budget_cents); timestamp(p.created_at); timestamp(p.updated_at);
 if (!Array.isArray(p.rooms)) invalid();
 let count = 0; let expenseCount = 0;
 for (const room of p.rooms) {
  if (!room || typeof room !== 'object') invalid();
  id(room.id); text(room.name, 50);
  if (room.project_id !== p.id || !Number.isSafeInteger(room.order_index) || room.order_index < 0 || !Array.isArray(room.items)) invalid();
  for (const item of room.items) {
   if (!item || typeof item !== 'object') invalid();
   id(item.id); text(item.name, 80); money(item.planned_cents, true);
   if (item.room_id !== room.id || !['work', 'material'].includes(item.type) || !Array.isArray(item.expenses)) invalid();
   if (data.version === '1.0.0' && item.expenses.length) invalid();
   for (const expense of item.expenses) {
    if (!expense || typeof expense !== 'object') invalid();
    id(expense.id); money(expense.amount_cents); timestamp(expense.created_at);
    if (expense.budget_item_id !== item.id || !isCalendarDate(expense.spent_at) || typeof expense.note !== 'string' || expense.note.length > 250) invalid();
    if (expense.receipt_id !== null) id(expense.receipt_id);
    expenseCount++;
   }
   count++;
  }
 }
 if (count > 1000 || expenseCount > 10000) invalid();
 totals(p);
 projectAnalytics(p);
}

export function todayLocal(now = new Date()): string {
 return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
export function isCalendarDate(value: unknown): value is string {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') return false;
 const d = new Date(`${value}T12:00:00Z`);
 return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
export function validateExpenseInput(amount: number, date: string, note: string, today = todayLocal()) {
 if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError('VALIDATION_FAILED','Сумма расхода должна быть больше нуля.');
 if (!isCalendarDate(date)) throw new AppError('INVALID_DATE_RANGE','Укажите существующую дату платежа.');
 if (date > today) throw new AppError('INVALID_DATE_RANGE','Дата платежа не может быть в будущем.');
 if (note.length > 250) throw new AppError('VALIDATION_FAILED','Заметка должна содержать не более 250 символов.');
}
export type BudgetStatus = 'ok' | 'warning' | 'danger';
export interface BudgetEvaluation { status: BudgetStatus; percentage: number | null; deltaCents: number }
export function evaluateItemStatus(planned: number, fact: number): BudgetEvaluation {
 const status = fact > planned ? 'danger' : BigInt(fact)*10n >= BigInt(planned)*9n && planned > 0 ? 'warning' : 'ok';
 return { status, percentage: planned ? fact/planned*100 : fact ? null : 0, deltaCents: planned-fact };
}
export function itemFact(item: BudgetItem): number { return sumCents(item.expenses.map(e=>e.amount_cents)) }
export function allExpenses(project: RepairProject) {
 return project.rooms.flatMap(room=>room.items.flatMap(item=>item.expenses.map(expense=>({room,item,expense}))));
}
export function receiptIds(project: RepairProject | null): Set<string> {
 return new Set(project ? allExpenses(project).flatMap(e=>e.expense.receipt_id ? [e.expense.receipt_id] : []) : []);
}
export function projectAnalytics(project: RepairProject) {
 const rooms = project.rooms.map(room=>{
  const items = room.items.map(item=>{const fact=itemFact(item);return {item,fact,...evaluateItemStatus(item.planned_cents,fact)}});
  const planned=sumCents(items.map(i=>i.item.planned_cents));
  const fact=sumCents(items.map(i=>i.fact));
  return { room, items, planned, fact, ...evaluateItemStatus(planned,fact) };
 });
 const planned=sumCents(rooms.map(r=>r.planned)), fact=sumCents(rooms.map(r=>r.fact));
 const risks=rooms.flatMap(r=>r.items.filter(i=>i.status!=='ok').map(i=>({...i,room:r.room}))).sort((a,b)=>(a.status===b.status ? a.deltaCents-b.deltaCents : a.status==='danger'?-1:1));
 return { rooms, planned, fact, budgetRemaining:project.total_budget_cents-fact, planRemaining:planned-fact, unallocated:project.total_budget_cents-planned, risks, expenseCount:rooms.reduce((n,r)=>n+r.items.reduce((m,i)=>m+i.item.expenses.length,0),0), ...evaluateItemStatus(project.total_budget_cents,fact) };
}

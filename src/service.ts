import { exportArchive, type BackupOperation } from './archive.ts';
import { exportFullSnapshot, type PreparedSnapshot } from './backup.ts';
import { receiptIds, allExpenses, AppError, validateExpenseInput } from './domain.ts';
import { ProjectRepository } from './repository.ts';
import { validateReceiptImage, type ReceiptStore, type ReceiptImage } from './receipts.ts';
export type ExclusiveLock = <T>(task:()=>Promise<T>)=>Promise<T>;
export const browserLock: ExclusiveLock = async task => {
 if(!globalThis.navigator?.locks) throw new AppError('LOCKS_UNAVAILABLE','Для сохранения используйте HTTPS или localhost и современный браузер с Web Locks.');
 return navigator.locks.request('remont_smeta_v1_write',task);
};
export class ProjectService {
 private repo: ProjectRepository;private receipts:ReceiptStore;private lock:ExclusiveLock;
 notice='';
 constructor(repo:ProjectRepository,receipts:ReceiptStore,lock:ExclusiveLock=browserLock){this.repo=repo;this.receipts=receipts;this.lock=lock}
 async run<T>(action:()=>T|Promise<T>,expected=this.repo.revision()):Promise<T>{
  return this.lock(async()=>{this.repo.assertRevision(expected);this.notice='';return await action()});
 }
 private async collect():Promise<void>{
  const refs=receiptIds(this.repo.get());const list=await this.receipts.list();
  await this.receipts.delete(list.filter(r=>!refs.has(r.id)).map(r=>r.id));
  const available=new Set(list.map(r=>r.id));
  if([...refs].some(id=>!available.has(id))) this.notice='Не все фото чеков найдены. Сами платежи сохранены; недостающий чек можно прикрепить заново.';
 }
 private async tryCollect():Promise<void>{try{await this.collect()}catch{this.notice='Изменения сохранены. Очистка старых фото будет повторена при следующем запуске.'}}
 async recover():Promise<void>{
  await this.lock(async()=>{this.notice='';this.repo.load();await this.collect()});
 }
 async remove(action:()=>void,expected=this.repo.revision()):Promise<void>{
  await this.run(async()=>{action();await this.tryCollect()},expected);
 }
 async exportSnapshot(expected=this.repo.revision()):Promise<string>{
  return this.run(async()=>{const project=this.repo.get();if(!project)throw new AppError('ENTITY_NOT_FOUND','Сначала создайте смету.');return exportFullSnapshot(project,this.receipts)},expected);
 }
 async exportArchive(options:BackupOperation={},expected=this.repo.revision()):Promise<Blob>{return this.run(async()=>{const project=this.repo.get();if(!project)throw new AppError('ENTITY_NOT_FOUND','Сначала создайте смету.');return exportArchive(project,this.receipts,options)},expected)}
 async importSnapshot(snapshot:PreparedSnapshot,expected=this.repo.revision()):Promise<void>{
  await this.run(async()=>{
   const project=structuredClone(snapshot.project),map=new Map<string,string>();const staged:string[]=[];
   try {
    for(const r of snapshot.receipts){const id=crypto.randomUUID();await this.receipts.put({...r,id});staged.push(id);map.set(r.id,id)}
    for(const {expense} of allExpenses(project))if(expense.receipt_id){const id=map.get(expense.receipt_id);if(!id)throw new AppError('CORRUPTED_BACKUP_SCHEMA','В копии не хватает фото чека.');expense.receipt_id=id}
    this.repo.replaceProject(project);
   }catch(error){try{await this.receipts.delete(staged)}catch{/* Old metadata remains authoritative; recover will clean staged files. */}throw error}
   await this.tryCollect();
  },expected);
 }
 async saveExpense(dto:{id?:string;budgetItemId:string;amountCents:number;spentAt:string;note?:string},image:ReceiptImage|null|undefined,expected=this.repo.revision()):Promise<void>{
  validateExpenseInput(dto.amountCents,dto.spentAt,(dto.note||'').trim());
  if(image)validateReceiptImage(image);
  await this.run(async()=>{
   const project=this.repo.get();
   if(!project || !project.rooms.some(r=>r.items.some(i=>i.id===dto.budgetItemId)))throw new AppError('ENTITY_NOT_FOUND','Статья не найдена.');
   if(dto.id&&!allExpenses(project).some(e=>e.expense.id===dto.id&&e.item.id===dto.budgetItemId))throw new AppError('ENTITY_NOT_FOUND','Платёж не найден.');
   let receiptId:string|null|undefined=image===null?null:undefined;
   if(image){receiptId=crypto.randomUUID();await this.receipts.put({id:receiptId,mime_type:image.blob.type,size_bytes:image.blob.size,width:image.width,height:image.height,created_at:new Date().toISOString(),blob_data:image.blob})}
   try {this.repo.saveExpense({...dto,receiptId})}
   catch(error){if(image&&receiptId){try{await this.receipts.delete([receiptId])}catch{/* Startup reconciliation removes this unreferenced staged file. */}}throw error}
   if(image!==undefined)await this.tryCollect();
  },expected);
 }
}

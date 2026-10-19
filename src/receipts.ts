import { AppError } from './domain.ts';
export const RECEIPT_LIMIT = 300 * 1024;
export interface ReceiptImage { blob: Blob; width: number; height: number }
export interface ReceiptAttachment { id: string; mime_type: string; size_bytes: number; width: number; height: number; created_at: string; blob_data: Blob }
export interface ReceiptInfo { id: string; size_bytes: number }
export interface ReceiptStore {
 put(value: ReceiptAttachment): Promise<void>;
 get(id: string): Promise<ReceiptAttachment | null>;
 delete(ids: string[]): Promise<void>;
 list(): Promise<ReceiptInfo[]>;
}
export function validateReceiptImage(image: ReceiptImage): void {
 if (!(image.blob instanceof Blob) || image.blob.type !== 'image/webp' || image.blob.size <= 0 || image.blob.size > RECEIPT_LIMIT || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 1280 || image.height > 1280) throw new AppError('IMAGE_PROCESSING_ERROR','Не удалось подготовить фото. Выберите другое изображение.');
}
function storageError(error: unknown): AppError {
 return new AppError(error instanceof DOMException && error.name === 'QuotaExceededError' ? 'STORAGE_QUOTA_EXCEEDED' : 'RECEIPT_STORAGE_ERROR', error instanceof DOMException && error.name === 'QuotaExceededError' ? 'Для фото не хватает памяти. Освободите место или сохраните платёж без чека.' : 'Хранилище чеков недоступно. Повторите попытку или сохраните платёж без фото.');
}
export class IndexedDbReceiptStore implements ReceiptStore {
 private factory: IDBFactory | undefined;
 private database: Promise<IDBDatabase> | null = null;
 private name: string;
 constructor(factory: IDBFactory | undefined = globalThis.indexedDB, name='remont_smeta_v1_receipts') { this.factory=factory; this.name=name }
 private open(): Promise<IDBDatabase> {
  if (!this.factory) return Promise.reject(storageError(null));
  if (!this.database) this.database = new Promise<IDBDatabase>((resolve,reject)=>{
   let request:IDBOpenDBRequest;try{request=this.factory!.open(this.name,1)}catch(e){reject(storageError(e));return}let blocked=false;
   request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('receipt_blobs'))request.result.createObjectStore('receipt_blobs',{keyPath:'id'})};
   request.onerror=()=>{this.database=null;reject(storageError(request.error))};
   request.onblocked=()=>{blocked=true;this.database=null;reject(new AppError('RECEIPT_STORAGE_ERROR','Закройте другие вкладки приложения и повторите сохранение фото.'))};
   request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return}db.onversionchange=()=>{db.close();this.database=null};resolve(db)};
  });
  const pending=this.database;
  void pending.catch(()=>{if(this.database===pending)this.database=null});
  return pending;
 }
 private async transaction<T>(mode: IDBTransactionMode, action:(store:IDBObjectStore, result:(value:T)=>void)=>void): Promise<T> {
  const db=await this.open();
  return new Promise<T>((resolve,reject)=>{
   let value:T;let transaction:IDBTransaction;
   try { transaction=db.transaction('receipt_blobs',mode,mode==='readwrite'?{durability:'strict'}:{}); }
   catch { try {transaction=db.transaction('receipt_blobs',mode)} catch(e){reject(storageError(e));return} }
   transaction.oncomplete=()=>resolve(value);
   transaction.onabort=()=>reject(storageError(transaction.error));
   transaction.onerror=()=>{}; // Request errors abort the transaction; resolve only on complete.
   try {action(transaction.objectStore('receipt_blobs'),v=>{value=v})} catch(e){transaction.abort();reject(storageError(e))}
  });
 }
 async put(value: ReceiptAttachment): Promise<void> {
  validateReceiptImage({blob:value.blob_data,width:value.width,height:value.height});
  await this.transaction<void>('readwrite',store=>{store.add(value)});
 }
 async get(id:string): Promise<ReceiptAttachment|null> {
  return this.transaction('readonly',(store,result)=>{const r=store.get(id);r.onsuccess=()=>result(r.result??null)});
 }
 async delete(ids:string[]):Promise<void> {if(ids.length) await this.transaction<void>('readwrite',store=>{ids.forEach(id=>store.delete(id))})}
 async list():Promise<ReceiptInfo[]> {
  return this.transaction('readonly',(store,result)=>{
   const info:ReceiptInfo[]=[];const request=store.openCursor();
   request.onsuccess=()=>{const cursor=request.result;if(!cursor){result(info);return} info.push({id:String(cursor.key),size_bytes:cursor.value.size_bytes});cursor.continue()};
  });
 }
 async close():Promise<void> {if(this.database){const db=await this.database;db.close();this.database=null}}
}

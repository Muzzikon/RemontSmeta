import { AppError, DATA_VERSION, receiptIds, validateStored, type RepairProject, type StoredData } from './domain.ts';
import { validateReceiptImage, type ReceiptStore, type ReceiptAttachment } from './receipts.ts';
export const BACKUP_LIMIT=64*1024*1024;
interface BackupReceipt {id:string;mime_type:string;size_bytes:number;width:number;height:number;created_at:string;sha256:string;data_base64:string}
export interface FullSnapshot {format:'remontsmeta-backup';schema_version:1;exported_at:string;data:StoredData;receipts:BackupReceipt[]}
export interface PreparedSnapshot {project:RepairProject;receipts:ReceiptAttachment[];exportedAt:string}
const invalid=()=>new AppError('CORRUPTED_BACKUP_SCHEMA','Файл резервной копии повреждён или имеет неподдерживаемый формат. Текущая смета не изменена.');
function base64(bytes:Uint8Array):string{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text)}
function decode(value:string):Uint8Array<ArrayBuffer>{
 if(value.length>410000||!value.length||value.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw invalid();
 const raw=atob(value);const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(base64(bytes)!==value)throw invalid();return bytes;
}
export async function digest(bytes:Uint8Array<ArrayBuffer>):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('')}
export function isWebp(bytes:Uint8Array):boolean{return bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'}
export async function exportFullSnapshot(project:RepairProject,store:ReceiptStore):Promise<string>{
 const receipts:BackupReceipt[]=[];let estimated=JSON.stringify(project).length;
 for(const id of receiptIds(project)){
  const record=await store.get(id);if(!record)throw new AppError('MISSING_RECEIPT','Не удалось создать полную копию: одно из фото чеков отсутствует. Прикрепите его заново или уберите связь с чеком.');
  validateReceiptImage({blob:record.blob_data,width:record.width,height:record.height});
  const bytes=new Uint8Array(await record.blob_data.arrayBuffer());if(!isWebp(bytes))throw new AppError('IMAGE_PROCESSING_ERROR','Сохранённый чек повреждён. Замените фото перед созданием копии.');
  estimated+=Math.ceil(bytes.length/3)*4+500;if(estimated>BACKUP_LIMIT)throw new AppError('BACKUP_TOO_LARGE','Копия с фото превышает 64 МБ. Для этой версии уменьшите число фото перед экспортом.');
  receipts.push({id,mime_type:'image/webp',size_bytes:bytes.length,width:record.width,height:record.height,created_at:record.created_at,sha256:await digest(bytes),data_base64:base64(bytes)});
 }
 const snapshot:FullSnapshot={format:'remontsmeta-backup',schema_version:1,exported_at:new Date().toISOString(),data:{version:DATA_VERSION,project},receipts};
 const json=JSON.stringify(snapshot);if(new Blob([json]).size>BACKUP_LIMIT)throw new AppError('BACKUP_TOO_LARGE','Полная копия превышает 64 МБ.');return json;
}
export async function prepareSnapshot(json:string):Promise<PreparedSnapshot>{
 if(new Blob([json]).size>BACKUP_LIMIT)throw new AppError('BACKUP_TOO_LARGE','Выберите резервную копию не более 64 МБ.');
 let value:FullSnapshot;try{value=JSON.parse(json)}catch{throw invalid()}
 if(!value||value.format!=='remontsmeta-backup'||value.schema_version!==1||typeof value.exported_at!=='string'||!Number.isFinite(Date.parse(value.exported_at))||!Array.isArray(value.receipts)||value.receipts.length>10000)throw invalid();
 validateStored(value.data);const refs=receiptIds(value.data.project),seen=new Set<string>(),receipts:ReceiptAttachment[]=[];
 for(const r of value.receipts){
  if(!r||typeof r.id!=='string'||!refs.has(r.id)||seen.has(r.id)||r.mime_type!=='image/webp'||typeof r.data_base64!=='string'||typeof r.sha256!=='string'||!/^[0-9a-f]{64}$/.test(r.sha256)||typeof r.created_at!=='string'||!Number.isFinite(Date.parse(r.created_at)))throw invalid();
  const bytes=decode(r.data_base64);if(bytes.length!==r.size_bytes||!isWebp(bytes)||await digest(bytes)!==r.sha256)throw invalid();
  const blob=new Blob([bytes],{type:'image/webp'});validateReceiptImage({blob,width:r.width,height:r.height});seen.add(r.id);
  receipts.push({id:r.id,mime_type:r.mime_type,size_bytes:r.size_bytes,width:r.width,height:r.height,created_at:r.created_at,blob_data:blob});
 }
 if(seen.size!==refs.size)throw invalid();
 return {project:structuredClone(value.data.project),receipts,exportedAt:value.exported_at};
}

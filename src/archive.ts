import { AppError, DATA_VERSION, receiptIds, validateStored, type RepairProject, type StoredData } from './domain.ts';
import { digest, isWebp, prepareSnapshot, BACKUP_LIMIT, type PreparedSnapshot } from './backup.ts';
import { validateReceiptImage, type ReceiptStore, type ReceiptAttachment } from './receipts.ts';
const MAGIC='RMSBKP01';const HEADER_LIMIT=16*1024*1024;
// 10 000 receipts × 300 KiB plus metadata fit below this bound.
export const ARCHIVE_LIMIT=4*1024*1024*1024;
interface PhotoMeta {id:string;mime_type:string;size_bytes:number;width:number;height:number;created_at:string;sha256:string}
interface Manifest {sha256:string;format:'remontsmeta-archive';schema_version:1;exported_at:string;data:StoredData;receipts:PhotoMeta[]}
export interface BackupOperation {signal?:AbortSignal;progress?:(done:number,total:number)=>void}
const invalid=()=>new AppError('CORRUPTED_BACKUP_SCHEMA','Полная копия повреждена или имеет неподдерживаемый формат. Текущая смета не изменена.');
function active(options:BackupOperation){if(options.signal?.aborted)throw new DOMException('Отменено','AbortError')}
export async function exportArchive(project:RepairProject,store:ReceiptStore,options:BackupOperation={}):Promise<Blob>{
 active(options);validateStored({version:DATA_VERSION,project});
 const ids=[...receiptIds(project)],receipts:PhotoMeta[]=[],photos:Blob[]=[];let size=12;
 for(const id of ids){
  active(options);const r=await store.get(id);if(!r)throw new AppError('MISSING_RECEIPT','Одно из фото отсутствует. Прикрепите его заново или уберите связь с чеком.');
  const blob=r.blob_data;validateReceiptImage({blob,width:r.width,height:r.height});
  const bytes=new Uint8Array(await blob.arrayBuffer());if(!isWebp(bytes))throw invalid();
  receipts.push({id,mime_type:'image/webp',size_bytes:blob.size,width:r.width,height:r.height,created_at:r.created_at,sha256:await digest(bytes)});photos.push(blob);size+=blob.size;
  options.progress?.(photos.length,ids.length);
 }
 active(options);const body={format:'remontsmeta-archive' as const,schema_version:1 as const,exported_at:new Date().toISOString(),data:{version:DATA_VERSION,project},receipts};const checksum=await digest(new TextEncoder().encode(JSON.stringify(body)));const header=new TextEncoder().encode(JSON.stringify({...body,sha256:checksum} satisfies Manifest));
 if(header.length>HEADER_LIMIT||size+header.length>ARCHIVE_LIMIT)throw new AppError('BACKUP_TOO_LARGE','Полная копия превышает возможности этой версии.');
 const prefix=new Uint8Array(12);prefix.set(new TextEncoder().encode(MAGIC));new DataView(prefix.buffer).setUint32(8,header.length,true);
 // Blob parts reference photos directly; there is no multi-gigabyte base64 string.
 return new Blob([prefix,header,...photos],{type:'application/octet-stream'});
}
export async function prepareArchive(file:Blob,options:BackupOperation={}):Promise<PreparedSnapshot>{
 active(options);if(file.size<12||file.size>ARCHIVE_LIMIT)throw invalid();
 const prefix=new Uint8Array(await file.slice(0,12).arrayBuffer());if(new TextDecoder().decode(prefix.slice(0,8))!==MAGIC)throw invalid();
 const length=new DataView(prefix.buffer).getUint32(8,true);if(!length||length>HEADER_LIMIT||length+12>file.size)throw invalid();
 let value:Manifest;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.slice(12,12+length).arrayBuffer()))}catch{throw invalid()}
 if(!value||value.format!=='remontsmeta-archive'||value.schema_version!==1||typeof value.exported_at!=='string'||!Number.isFinite(Date.parse(value.exported_at))||!Array.isArray(value.receipts)||value.receipts.length>10000)throw invalid();
 if(typeof value.sha256!=='string'||! /^[0-9a-f]{64}$/.test(value.sha256))throw invalid();
 const {sha256,...body}=value;if(await digest(new TextEncoder().encode(JSON.stringify(body)))!==sha256)throw invalid();
 validateStored(value.data);const refs=receiptIds(value.data.project),seen=new Set<string>(),receipts:ReceiptAttachment[]=[];let offset=12+length;
 for(const r of value.receipts){
  active(options);
  if(!r||typeof r.id!=='string'||!refs.has(r.id)||seen.has(r.id)||r.mime_type!=='image/webp'||!Number.isSafeInteger(r.size_bytes)||r.size_bytes<1||typeof r.sha256!=='string'||!/^[0-9a-f]{64}$/.test(r.sha256)||typeof r.created_at!=='string'||!Number.isFinite(Date.parse(r.created_at))||offset+r.size_bytes>file.size)throw invalid();
  const blob=file.slice(offset,offset+r.size_bytes,'image/webp');validateReceiptImage({blob,width:r.width,height:r.height});
  const bytes=new Uint8Array(await blob.arrayBuffer());if(!isWebp(bytes)||await digest(bytes)!==r.sha256)throw invalid();
  receipts.push({id:r.id,mime_type:'image/webp',size_bytes:r.size_bytes,width:r.width,height:r.height,created_at:r.created_at,blob_data:blob});seen.add(r.id);offset+=r.size_bytes;options.progress?.(receipts.length,value.receipts.length);
 }
 active(options);if(offset!==file.size||seen.size!==refs.size)throw invalid();
 return {project:structuredClone(value.data.project),receipts,exportedAt:value.exported_at};
}
export async function prepareBackupFile(file:Blob,options:BackupOperation={}):Promise<PreparedSnapshot>{
 active(options);const prefix=await file.slice(0,8).text();
 if(prefix===MAGIC)return prepareArchive(file,options);
 if(file.size>BACKUP_LIMIT)throw new AppError('BACKUP_TOO_LARGE','JSON-копия должна быть не больше 64 МБ. Для больших копий используйте формат .rmsbackup.');
 const result=await prepareSnapshot(await file.text());active(options);return result;
}
export async function validateSnapshotImages(snapshot:PreparedSnapshot,options:BackupOperation={}):Promise<void>{
 for(let i=0;i<snapshot.receipts.length;i++){
  active(options);const r=snapshot.receipts[i];let bitmap:ImageBitmap;
  try{bitmap=await createImageBitmap(r.blob_data)}catch{throw new AppError('CORRUPTED_BACKUP_SCHEMA','В копии есть фото, которое не удаётся открыть. Текущая смета не изменена.')}
  try{if(bitmap.width!==r.width||bitmap.height!==r.height)throw new AppError('CORRUPTED_BACKUP_SCHEMA','Размеры фото в копии не совпадают с данными изображения.')}finally{bitmap.close()}
  options.progress?.(i+1,snapshot.receipts.length);
 }
 active(options);
}

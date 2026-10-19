import { AppError } from './domain.ts';
import { RECEIPT_LIMIT, type ReceiptImage } from './receipts.ts';
export function fitDimensions(width:number,height:number,max=1280): {width:number;height:number} {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>40000000) throw new AppError('IMAGE_PROCESSING_ERROR','Слишком большое или повреждённое изображение. Выберите фото до 40 мегапикселей.');
 const scale=Math.min(1,max/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
// Exported for tests: every candidate is checked against the actual byte limit.
export async function encodeToLimit(width:number,height:number,encode:(w:number,h:number,q:number)=>Promise<Blob>):Promise<ReceiptImage> {
 let size=fitDimensions(width,height);
 for(let round=0;round<7;round++) {
  for(const quality of [.75,.6,.45,.3]) {
   const blob=await encode(size.width,size.height,quality);
   if(blob.type!=='image/webp') throw new AppError('IMAGE_PROCESSING_ERROR','Браузер не поддерживает сжатие WebP. Используйте актуальный браузер или сохраните без фото.');
   if(blob.size>0&&blob.size<=RECEIPT_LIMIT) return {blob,...size};
  }
  size={width:Math.max(1,Math.round(size.width*.8)),height:Math.max(1,Math.round(size.height*.8))};
 }
 throw new AppError('IMAGE_PROCESSING_ERROR','Не удалось уменьшить фото до 300 КБ. Выберите другое фото.');
}
export async function compressReceipt(file: File, signal?:AbortSignal): Promise<ReceiptImage> {
 if(!file.size || file.size>25*1024*1024) throw new AppError('IMAGE_PROCESSING_ERROR','Выберите непустое изображение размером до 25 МБ.');
 const mime=file.type.toLowerCase();
 if(!['image/jpeg','image/png','image/webp','image/heic','image/heif','image/heic-sequence','image/heif-sequence'].includes(mime)&&!((mime===''||mime==='application/octet-stream')&&/\.(jpe?g|png|webp|hei[cf])$/i.test(file.name))) throw new AppError('UNSUPPORTED_MEDIA_TYPE','Допустимы JPEG, PNG, WebP и HEIC.');
 let image:ImageBitmap|HTMLImageElement;let url:string|undefined;
 try {
  try {image=await createImageBitmap(file)} catch {
   url=URL.createObjectURL(file);image=new Image();image.src=url;await image.decode();
  }
 } catch { if(url){URL.revokeObjectURL(url);url=undefined}if(/hei[cf]/i.test(mime+file.name)){const {decodeHeic}=await import('./heic.ts');image=await decodeHeic(file,signal)}else throw new AppError('IMAGE_PROCESSING_ERROR','Фото повреждено или не поддерживается. Выберите другое изображение.') }
 try {
  if(signal?.aborted)throw new DOMException('Отменено','AbortError');
  const canvas=document.createElement('canvas');const context=canvas.getContext('2d');
  if(!context)throw new AppError('IMAGE_PROCESSING_ERROR','Не удалось подготовить изображение.');
  return await encodeToLimit(image.width,image.height,async(width,height,quality)=>{
   if(signal?.aborted)throw new DOMException('Отменено','AbortError');
   canvas.width=width;canvas.height=height;context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
   return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new AppError('IMAGE_PROCESSING_ERROR','Не удалось сжать фото.')),'image/webp',quality));
  });
 } finally {if('close' in image)image.close();if(url)URL.revokeObjectURL(url)}
}

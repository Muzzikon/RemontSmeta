import { AppError } from './domain.ts';
export async function decodeHeic(file:File,signal?:AbortSignal):Promise<ImageBitmap>{
 if(signal?.aborted)throw new DOMException('Отменено','AbortError');
 const buffer=await file.arrayBuffer();if(signal?.aborted)throw new DOMException('Отменено','AbortError');
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./heic-worker.ts',import.meta.url),{type:'module'});
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate()};
  const abort=()=>{cleanup();reject(new DOMException('Отменено','AbortError'))};
  const timer=setTimeout(()=>{cleanup();reject(new AppError('IMAGE_PROCESSING_ERROR','Обработка HEIC заняла слишком много времени. Выберите другое фото.'))},30000);
  signal?.addEventListener('abort',abort,{once:true});
  worker.onerror=e=>{e.preventDefault();cleanup();reject(new AppError('IMAGE_PROCESSING_ERROR','Не удалось открыть HEIC. Выберите другое изображение.'))};
  worker.onmessage=(e:MessageEvent<{bitmap?:ImageBitmap;error?:string}>)=>{cleanup();if(e.data.bitmap)resolve(e.data.bitmap);else reject(new AppError('IMAGE_PROCESSING_ERROR',e.data.error||'Не удалось открыть HEIC.'))};
  worker.postMessage(buffer,[buffer]);
 });
}

/// <reference lib="webworker" />
import initialize from 'libheif-js/libheif-wasm/libheif-bundle.mjs';
// A dedicated worker is destroyed after every decode, releasing all WASM memory.
self.onmessage=async(event:MessageEvent<ArrayBuffer>)=>{
 try{
  const lib=await initialize();const decoder=new lib.HeifDecoder();const images=decoder.decode(new Uint8Array(event.data));
  if(!images.length)throw Error('В HEIC не найдено доступное изображение.');
  const image=images.find(i=>i.is_primary())||images[0];const width=image.get_width(),height=image.get_height();
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>40000000)throw Error('Выберите HEIC до 40 мегапикселей.');
  const pixels=new ImageData(width,height);
  await new Promise<void>((resolve,reject)=>image.display(pixels,result=>result?resolve():reject(Error('Не удалось декодировать это HEIC-изображение.'))));
  const original=new OffscreenCanvas(width,height);const context=original.getContext('2d');if(!context)throw Error('Canvas недоступен.');context.putImageData(pixels,0,0);
  const scale=Math.min(1,1280/Math.max(width,height));const scaled=new OffscreenCanvas(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));
  const target=scaled.getContext('2d');if(!target)throw Error('Canvas недоступен.');target.drawImage(original,0,0,scaled.width,scaled.height);
  const bitmap=scaled.transferToImageBitmap();self.postMessage({bitmap},[bitmap]);
 }catch(error){self.postMessage({error:error instanceof Error?error.message:'Не удалось открыть HEIC.'})}
};

/// <reference types="vite/client" />
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
 interface HeifImage {get_width():number;get_height():number;is_primary():boolean;display(pixels:ImageData,callback:(result:ImageData|null)=>void):void}
 export default function initialize():Promise<{HeifDecoder:new()=>{decode(bytes:Uint8Array):HeifImage[]}}>;
}

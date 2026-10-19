interface InstallEvent extends Event {prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>}
export interface PwaState {ready:boolean;offline:boolean;canInstall:boolean;installed:boolean;update:boolean;error:boolean}
export class PwaController {
 state:PwaState={ready:false,offline:!navigator.onLine,canInstall:false,installed:matchMedia('(display-mode: standalone)').matches,update:false,error:false};
 private installEvent:InstallEvent|null=null;private registration:ServiceWorkerRegistration|null=null;private notify:()=>void;
 constructor(notify:()=>void){this.notify=notify}
 start():void{
  if(import.meta.env.VITE_DESKTOP==='1'){this.state.ready=true;this.state.installed=true;this.state.offline=false;this.notify();return}
  window.addEventListener('online',()=>{this.state.offline=false;this.notify()});window.addEventListener('offline',()=>{this.state.offline=true;this.notify()});
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();this.installEvent=e as InstallEvent;this.state.canInstall=true;this.notify()});
  window.addEventListener('appinstalled',()=>{this.state.installed=true;this.state.canInstall=false;this.installEvent=null;this.notify()});
  if(!('serviceWorker'in navigator)||!window.isSecureContext){this.state.error=true;this.notify();return}
  // Vite's development modules are not a complete offline build.
  if(!import.meta.env.PROD)return;
  void navigator.serviceWorker.register(new URL('sw.js',new URL(import.meta.env.BASE_URL,location.href)).href,{scope:import.meta.env.BASE_URL,updateViaCache:'none'}).then(reg=>{
   this.registration=reg;this.state.ready=!!reg.active;this.state.update=!!reg.waiting;this.notify();
   reg.addEventListener('updatefound',()=>{const worker=reg.installing;if(!worker)return;worker.addEventListener('statechange',()=>{if(worker.state==='installed'){this.state.update=!!navigator.serviceWorker.controller;this.notify()}if(worker.state==='redundant'){this.state.error=true;this.notify()}})});
   return navigator.serviceWorker.ready;
  }).then(()=>{this.state.ready=true;this.state.error=false;this.notify()}).catch(()=>{this.state.error=true;this.notify()});
 }
 async install():Promise<boolean>{if(!this.installEvent)return false;const prompt=this.installEvent;this.installEvent=null;this.state.canInstall=false;await prompt.prompt();const result=await prompt.userChoice;if(result.outcome==='accepted')this.state.installed=true;this.notify();return true}
 update():void{if(!this.registration?.waiting)return;let reloaded=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!reloaded){reloaded=true;location.reload()}},{once:true});this.registration.waiting.postMessage({type:'ACTIVATE_UPDATE'})}
}

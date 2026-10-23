import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/cyrillic-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/cyrillic-600.css';
import './style.css';
import { MoneyEngine as M, totals, projectAnalytics, allExpenses, STORAGE_KEY, AppError, todayLocal, type ItemType, type RepairProject } from './domain.ts';
import { ProjectRepository } from './repository.ts';
import { ProjectService } from './service.ts';
import { IndexedDbReceiptStore, type ReceiptImage } from './receipts.ts';
import { compressReceipt } from './image.ts';
import { icon } from './icons.ts';
import { escape, button, field, plural } from './ui.ts';
import { overview, estimate, history, type ViewState } from './views.ts';
import { onboarding } from './onboarding.ts';
import { applyTheme, themeControl } from './theme.ts';
import { PwaController } from './pwa.ts';
import { prepareBackupFile, validateSnapshotImages } from './archive.ts';
import { downloadFile, estimateCsv, paymentsCsv, printMarkup } from './export.ts';
const root=document.querySelector<HTMLDivElement>('#app')!;
const receipts=new IndexedDbReceiptStore();
let repository:ProjectRepository;
let service:ProjectService;
const state:ViewState={selected:'all',filter:'all',query:'',historyItem:'',historyPage:1,estimatePage:1,riskPage:1};
let page:'estimate'|'overview'|'payments'='overview';
let receiptUsage='0 КБ';
let toastTimer:ReturnType<typeof setTimeout>;
let booted=false;
const pwa=new PwaController(()=>{if(booted)render()});
function toast(message:string){const n=document.querySelector<HTMLDivElement>('#notifications')!;n.textContent=message;n.className='toast';clearTimeout(toastTimer);toastTimer=setTimeout(()=>{n.textContent='';n.className=''},6000)}
function showError(error:unknown){toast(error instanceof Error?error.message:'Не удалось выполнить действие. Повторите попытку.')}
async function refreshUsage(){try{const info=await receipts.list();const bytes=info.reduce((n,r)=>n+r.size_bytes,0);receiptUsage=bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} МБ`:`${Math.ceil(bytes/1024)} КБ`}catch{receiptUsage='хранилище недоступно'}}
function shell(content:string,sidebar:string,hasProject:boolean){
 const navigation=[['overview','Сводка','01'],['estimate','Смета','02'],['payments','Платежи','03']];
 const labels={overview:'Сводка',estimate:'Смета',payments:'Платежи'};
 const status=import.meta.env.VITE_DESKTOP==='1'?'Windows · локальные данные':pwa.state.offline?(pwa.state.ready?'Нет сети · работа офлайн':'Нет сети'):pwa.state.ready?'Офлайн готов':pwa.state.error?'Офлайн недоступен':'Локальное хранение';
 return `<div class="layout"><aside class="sidebar"><a class="brand" href="${import.meta.env.BASE_URL}">Ремонт<span>Смета</span></a><p class="nav-caption">РАБОЧИЙ ЖУРНАЛ</p><nav aria-label="Основная навигация">${navigation.map(([key,label,num])=>`<button type="button" class="nav-item ${page===key?'is-active':''}" data-action="${key}" ${hasProject?'':'disabled'}><small>${num}</small><span>${label}</span></button>`).join('')}</nav>${sidebar}<div class="sidebar-tools"><p class="section-label">ФАЙЛЫ И ДАННЫЕ</p>${button('files','Файлы и копии','folder','nav-item')}${import.meta.env.VITE_DESKTOP==='1'?'':button('install',pwa.state.installed?'Приложение установлено':'Установить приложение','install','nav-item')}</div><div class="sidebar-foot">${icon('lock')}<span>На этом устройстве<small>Смета и чеки сохраняются локально</small></span></div></aside><div class="workspace"><header class="topbar"><div class="crumb">Мой ремонт <span>/</span> ${labels[page]}</div><div class="topbar-tools">${themeControl()}<span class="local-badge ${pwa.state.offline?'is-offline':''}"><i></i> ${status}</span>${pwa.state.update?button('pwa-update','Обновить',undefined,'text-button'):''}${button('files','Файлы','folder','text-button')}</div></header>${content}<footer class="footer"><span>РемонтСмета <span class="footer-dot">/</span> v1.0</span>${button('help','Справка','info','text-button')}</footer></div></div><div id="print-root"></div>`;
}
let renderedRevision:string|null|undefined;
let renderedProject:RepairProject|null=null;
let renderedAnalytics:ReturnType<typeof projectAnalytics>|null=null;
let renderedTotals:ReturnType<typeof totals>|null=null;
function render(){
 const revision=repository.revision();
 if(revision!==renderedRevision){renderedProject=repository.get();renderedRevision=revision;renderedAnalytics=renderedProject?projectAnalytics(renderedProject):null;renderedTotals=renderedProject?totals(renderedProject):null}
 const p=renderedProject;if(!p){root.innerHTML=shell(onboarding(),'',false);return}
 if(state.selected!=='all'&&!p.rooms.some(r=>r.id===state.selected))state.selected='all';
 if(state.historyItem&&!p.rooms.some(r=>r.items.some(i=>i.id===state.historyItem)))state.historyItem='';
 const a=renderedAnalytics!,t=renderedTotals!,hasItems=t.count>0;state.riskPage=Math.max(1,Math.min(state.riskPage||1,Math.ceil(a.risks.length/25)||1));
 const sidebar=`<div class="room-nav"><div class="section-label">КОМНАТЫ ${button('room-add','Добавить комнату','plus','icon-button')}</div>${button('room-select','Все комнаты','home',`nav-item ${state.selected==='all'?'is-selected':''}`,'data-id="all"')}${p.rooms.map((r,i)=>`<button type="button" class="nav-item room-link ${state.selected===r.id?'is-selected':''}" data-action="room-select" data-id="${r.id}"><span class="room-index">${String(i+1).padStart(2,'0')}</span><span>${escape(r.name)}</span><small>${r.items.length}</small></button>`).join('')}<button type="button" class="add-room" data-action="room-add">${icon('plus')} Добавить комнату</button></div><div class="sidebar-note">${icon(a.risks.length?'info':'leaf')}<p>${a.risks.length?`${a.risks.length} ${plural(a.risks.length,'статья требует','статьи требуют','статей требуют')} внимания`:'Бюджет под наблюдением'}<br><span>Фиксируйте покупки и оплату мастерам.</span></p></div>`;
 const header=`<div class="page-heading"><div><div class="eyebrow">ОБЪЕКТ 01</div><h1>${escape(p.title)}</h1><p>${p.rooms.length} ${plural(p.rooms.length,'комната','комнаты','комнат')} · ${t.count} ${plural(t.count,'статья','статьи','статей')} · Все суммы в рублях</p></div><div class="heading-actions">${button('project-edit','Параметры ремонта','edit','button button--secondary')}${button(hasItems?'expense-add':p.rooms.length?'item-add':'room-add',hasItems?'Записать расход':'Дополнить смету','plus')}</div></div><section class="metrics metrics--four" aria-label="Бюджет и фактические расходы"><article class="metric"><span>Общий бюджет ${icon('wallet')}</span><strong>${M.formatCents(p.total_budget_cents)}</strong><small>Лимит на весь ремонт</small></article><article class="metric"><span>План по смете ${icon('grid')}</span><strong>${M.formatCents(t.planned)}</strong><small>${t.count} ${plural(t.count,'статья','статьи','статей')}</small></article><article class="metric"><span>Потрачено ${icon('receipt')}</span><strong>${M.formatCents(a.fact)}</strong><small>${a.expenseCount} ${plural(a.expenseCount,'платёж','платежа','платежей')}</small></article><article class="metric metric--accent ${a.budgetRemaining<0?'metric--over':''}"><span>${a.budgetRemaining<0?'Перерасход бюджета':'Осталось от бюджета'} ${icon(a.budgetRemaining<0?'info':'leaf')}</span><strong>${M.formatCents(Math.abs(a.budgetRemaining))}</strong><small>${a.budgetRemaining<0?'Факт превысил общий лимит':'Общий бюджет минус реальные траты'}</small></article></section>`;
 root.innerHTML=shell(`<main class="main">${header}<div class="project-note"><span>${a.unallocated<0?'План сверх общего бюджета':'Ещё не распределено'}: <strong>${M.formatCents(Math.abs(a.unallocated))}</strong></span><span>Фото чеков: ${escape(receiptUsage)}</span></div><div class="content-grid">${page==='overview'?overview(p,a,state.riskPage):page==='payments'?history(p,state):estimate(p,state,a,t)}</div></main>${hasItems?button('expense-add','Расход','plus','expense-fab'):''}`,sidebar,true);
}
const openDialogs=new Map<HTMLDialogElement,{close:()=>void;hasUnsaved:()=>boolean}>();
function closeDialogs(){for(const handle of [...openDialogs.values()])handle.close()}
interface DialogHandle {el:HTMLDialogElement;close:()=>void;onClose:(fn:()=>void)=>void;setProcessing:(busy:boolean)=>void}
function dialog(title:string,subtitle:string,body:string,onSave?:(data:FormData,revision:string|null)=>void|Promise<void>,submit='Сохранить',lock=true):DialogHandle {
 const el=document.createElement('dialog');el.className='dialog';const revision=repository?.revision()??null;
 el.innerHTML=`<form><div class="dialog-heading"><div><h2>${title}</h2><p>${subtitle}</p></div>${button('close-dialog','Закрыть','close','icon-button')}</div>${body}<p class="form-error" role="alert"></p><div class="saving-label" role="status" hidden>Сохраняем…</div><div class="dialog-footer">${button('close-dialog',onSave?'Отмена':'Закрыть',undefined,'button button--secondary')}${onSave?`<button class="button" type="submit">${submit}${icon('check')}</button>`:''}</div></form>`;
 const previous=document.activeElement as HTMLElement|null;let saving=false,processing=false,dirty=false;const cleanup:(()=>void)[]=[];
 document.body.append(el);el.showModal();
 const close=()=>{if(saving||!el.isConnected)return;el.close();el.remove();openDialogs.delete(el);cleanup.forEach(fn=>fn());if(previous?.isConnected)previous.focus()};
 openDialogs.set(el,{close,hasUnsaved:()=>!!onSave&&(dirty||saving||processing)});
 el.addEventListener('input',()=>{dirty=true});el.addEventListener('change',()=>{dirty=true});
 const updateBusy=()=>{const b=el.querySelector<HTMLButtonElement>('[type="submit"]');if(b)b.disabled=saving||processing;el.querySelector('form')!.setAttribute('aria-busy',String(saving||processing));el.querySelectorAll<HTMLButtonElement>('[data-action="close-dialog"]').forEach(b=>b.disabled=saving)};
 el.querySelectorAll('[data-action="close-dialog"]').forEach(b=>b.addEventListener('click',close));
 el.addEventListener('cancel',e=>{e.preventDefault();close()});
 el.addEventListener('click',e=>{if(e.target===el){const r=el.getBoundingClientRect();if(!dirty&&!processing&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))close()}});
 el.querySelector('form')!.addEventListener('submit',async e=>{
  e.preventDefault();if(!onSave||saving||processing)return;
  const data=new FormData(el.querySelector('form')!);saving=true;updateBusy();el.querySelector<HTMLElement>('.saving-label')!.hidden=false;
  el.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea').forEach(i=>i.disabled=true);
  try {
   if(lock)await service.run(()=>onSave(data,revision),revision);else await onSave(data,revision);
   saving=false;close();await refreshUsage();render();toast(service.notice||'Изменения сохранены');
  }catch(error){el.querySelector('.form-error')!.textContent=error instanceof Error?error.message:'Не удалось сохранить';saving=false;el.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea').forEach(i=>{if(i.dataset.keepDisabled!=='true')i.disabled=false});el.querySelector<HTMLElement>('.saving-label')!.hidden=true;updateBusy()}
 });
 return {el,close,onClose:fn=>cleanup.push(fn),setProcessing:busy=>{processing=busy;updateBusy()}};
}
function projectForm(edit=false){const p=repository.get();dialog(edit?'Параметры ремонта':'Создадим вашу смету','Название и общий бюджет можно изменить в любой момент.',field('Название ремонта','title',edit&&p?p.title:'',100,'Например, квартира на Ленина')+field('Общий бюджет, ₽','budget',edit&&p?M.input(p.total_budget_cents):'',30,'1 200 000',true)+'<p class="field-hint">Можно вводить суммы с пробелами и копейками: 12 500,50.</p>',d=>{const title=String(d.get('title')),budget=M.parseToCents(String(d.get('budget')));edit?repository.updateProject(title,budget):repository.createProject(title,budget)},edit?'Сохранить':'Создать смету')}
function roomForm(id?:string){const room=repository.get()?.rooms.find(r=>r.id===id);dialog(id?'Название комнаты':'Новая комната','Добавьте работы и материалы для этой части квартиры.',field('Название','name',room?.name,50,'Например, кухня'),d=>{id?repository.updateRoom(id,String(d.get('name'))):repository.addRoom(String(d.get('name')))},id?'Сохранить':'Добавить комнату')}
function itemForm(roomId?:string,id?:string){
 const p=repository.get()!,room=id?p.rooms.find(r=>r.items.some(i=>i.id===id)):p.rooms.find(r=>r.id===(roomId||state.selected)),item=room?.items.find(i=>i.id===id);
 if(!p.rooms.length){roomForm();return}
 dialog(id?'Изменить статью':'Новая статья сметы','Плановую сумму можно уточнять по мере ремонта.',`<label class="field"><span>Комната</span><select name="room" ${id?'disabled data-keep-disabled="true"':''}>${p.rooms.map(r=>`<option value="${r.id}" ${r.id===room?.id?'selected':''}>${escape(r.name)}</option>`).join('')}</select></label>`+field('Название статьи','name',item?.name,80,'Например, укладка плитки')+`<label class="field"><span>Категория</span><select name="type"><option value="work" ${item?.type==='work'?'selected':''}>Работы</option><option value="material" ${item?.type==='material'?'selected':''}>Материалы</option></select></label>`+field('Плановая сумма, ₽','amount',item?M.input(item.planned_cents):'',30,'25 000',true)+'<p class="field-hint">Можно указать 0. Любой платёж по статье без плана будет отмечен как перерасход.</p>',d=>repository.saveItem(id?room!.id:String(d.get('room')),id||null,String(d.get('name')),d.get('type') as ItemType,M.parseToCents(String(d.get('amount')),true)),id?'Сохранить':'Добавить статью');
}
function paymentForm(itemId?:string,id?:string){
 const p=repository.get()!;if(!p.rooms.some(r=>r.items.length)){toast('Сначала добавьте статью сметы');itemForm();return}
 const entry=id?allExpenses(p).find(e=>e.expense.id===id):undefined;
 if(id&&!entry)throw new AppError('ENTITY_NOT_FOUND','Платёж не найден.');
 const selectedItem=entry?.item.id||itemId||state.historyItem||'';const expense=entry?.expense;
 let image:ReceiptImage|null|undefined;let photoTask:AbortController|undefined;let generation=0;let previewUrl:string|undefined;let photoError='';
 const d=dialog(id?'Изменить платёж':'Записать расход','Выберите статью и сумму. Фото чека и заметка — по желанию.',field('Сумма, ₽','amount',expense?M.input(expense.amount_cents):'',30,'0,00',true)+`<label class="field"><span>Статья сметы</span><select name="item" required ${id?'disabled data-keep-disabled="true"':''}><option value="">Выберите статью</option>${p.rooms.map(r=>`<optgroup label="${escape(r.name)}">${r.items.map(i=>`<option value="${i.id}" ${i.id===selectedItem?'selected':''}>${escape(i.name)}</option>`).join('')}</optgroup>`).join('')}</select></label><label class="field"><span>Дата платежа</span><input type="date" name="date" required max="${todayLocal()}" value="${expense?.spent_at||todayLocal()}"></label><label class="field"><span>Заметка <small>необязательно</small></span><textarea name="note" maxlength="250" rows="2" placeholder="Например, аванс мастеру">${escape(expense?.note||'')}</textarea></label><div class="photo-field"><div class="photo-toolbar"><label class="photo-choose">${icon('camera')} <span>${expense?.receipt_id?'Заменить фото чека':'Добавить фото чека'}</span><input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,.heic,.heif" capture="environment"></label><button type="button" class="text-button" id="photo-remove">Убрать фото</button></div><p class="field-hint">Сжатие до 300 КБ. Фото остаётся на устройстве.</p><div class="photo-preview" role="status">${expense?.receipt_id?'Загружаем прикреплённое фото…':'Фото пока не прикреплено'}</div></div>`,async(data,revision)=>{
  if(photoError)throw new AppError('IMAGE_PROCESSING_ERROR',photoError);
  await service.saveExpense({id,budgetItemId:id?entry!.item.id:String(data.get('item')),amountCents:M.parseToCents(String(data.get('amount'))),spentAt:String(data.get('date')),note:String(data.get('note'))},image,revision);
 },id?'Сохранить изменения':'Сохранить расход',false);
 d.el.querySelector<HTMLInputElement>('[name="amount"]')?.focus();
 const preview=d.el.querySelector<HTMLDivElement>('.photo-preview')!;const input=d.el.querySelector<HTMLInputElement>('#photo-file')!;
 function showPreview(blob:Blob,label:string){if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);preview.innerHTML=`<img src="${previewUrl}" alt="Предпросмотр фото чека"><small>${escape(label)}</small>`}
 d.onClose(()=>{generation++;photoTask?.abort();if(previewUrl)URL.revokeObjectURL(previewUrl)});
 if(expense?.receipt_id){const token=generation;void receipts.get(expense.receipt_id).then(r=>{if(token!==generation||!d.el.isConnected)return;if(r)showPreview(r.blob_data,`Сохранено · ${Math.ceil(r.size_bytes/1024)} КБ`);else preview.textContent='Фото не найдено. Можно прикрепить его заново.'}).catch(()=>{if(token===generation&&d.el.isConnected)preview.textContent='Не удалось открыть фото. Можно оставить как есть или прикрепить заново.'})}
 input.addEventListener('change',async()=>{
  const file=input.files?.[0];if(!file)return;const token=++generation;photoTask?.abort();photoTask=new AbortController();photoError='';d.setProcessing(true);preview.textContent='Оптимизируем фото чека…';
  try {const result=await compressReceipt(file,photoTask.signal);if(token!==generation||!d.el.isConnected)return;image=result;showPreview(result.blob,`${Math.ceil(result.blob.size/1024)} КБ · ${result.width} × ${result.height}`)}
  catch(e){if(token!==generation||!d.el.isConnected)return;photoError=e instanceof Error?e.message:'Не удалось обработать фото.';preview.textContent=photoError+' Выберите другое фото или нажмите «Убрать фото».'}
  finally{if(token===generation&&d.el.isConnected)d.setProcessing(false)}
 });
 d.el.querySelector('#photo-remove')!.addEventListener('click',()=>{generation++;photoTask?.abort();image=null;photoError='';input.value='';if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=undefined}preview.textContent='Платёж будет сохранён без фото';d.setProcessing(false)});
}
function confirmDelete(title:string,body:string,action:()=>void){dialog(title,'Удаление нельзя отменить.',`<div class="confirm-copy">${body}</div>`,async(_data,revision)=>{await service.remove(action,revision)},'Удалить',false)}
function viewReceipt(id:string){
 const d=dialog('Фото чека','Файл хранится на этом устройстве.','<div class="receipt-view" role="status">Открываем фото…</div>');let url:string|undefined;
 d.onClose(()=>{if(url)URL.revokeObjectURL(url)});
 void receipts.get(id).then(r=>{if(!d.el.isConnected)return;const view=d.el.querySelector('.receipt-view')!;if(!r){view.textContent='Фото не найдено. Платёж сохранён, можно заново прикрепить фото через редактирование.';return}url=URL.createObjectURL(r.blob_data);view.innerHTML=`<button type="button" class="receipt-zoom" aria-label="Увеличить фото чека" aria-pressed="false"><img src="${url}" alt="Фото чека"></button><p>${Math.ceil(r.size_bytes/1024)} КБ · ${r.width} × ${r.height}. Нажмите на фото, чтобы изменить масштаб.</p>`;view.querySelector('.receipt-zoom')!.addEventListener('click',e=>{const b=e.currentTarget as HTMLButtonElement;const full=b.classList.toggle('is-full');b.setAttribute('aria-pressed',String(full));b.setAttribute('aria-label',full?'Уменьшить фото чека':'Увеличить фото чека')})}).catch(e=>{if(d.el.isConnected)d.el.querySelector('.receipt-view')!.textContent=e instanceof Error?e.message:'Не удалось открыть фото.'});
}
function filesDialog(){
 const hasProject=!!repository.get();
 dialog('Файлы и резервные копии','Полная копия сохраняет смету, платежи и все фотографии.',`<div class="file-actions">${button('archive-export','Сохранить полную копию','download','file-action',hasProject?'':'disabled')}${button('backup-export','Копия JSON для старой версии','download','file-action',hasProject?'':'disabled')}${button('backup-import','Восстановить из копии','upload','file-action')}${button('csv-estimate','Смета в CSV','grid','file-action',hasProject?'':'disabled')}${button('csv-payments','Платежи в CSV','receipt','file-action',hasProject?'':'disabled')}${button('print','Печать / сохранить PDF','print','file-action',hasProject?'':'disabled')}${import.meta.env.VITE_DESKTOP==='1'?'':button('install',pwa.state.installed?'Приложение установлено':'Установить приложение','install','file-action',pwa.state.installed?'disabled':'')}</div><p class="field-hint">Полная копия .rmsbackup подходит для больших смет с фотографиями. Старый формат JSON поддерживается до 64 МБ. CSV и PDF предназначены для просмотра. Файлы остаются на устройстве.</p>`);
}
async function exportBackup(target:HTMLButtonElement){
 target.disabled=true;const label=target.querySelector('span')!;const previous=label.textContent;label.textContent='Собираем смету и фото…';
 try{const json=await service.exportSnapshot();downloadFile(new Blob([json],{type:'application/json'}),`remontsmeta_backup_${todayLocal()}.json`);toast('Полная копия подготовлена для скачивания')}finally{target.disabled=false;label.textContent=previous}
}
async function exportArchive(){
 closeDialogs();const operation=new AbortController();
 const loading=dialog('Сохраняем полную копию','Смета и оригиналы сжатых чеков будут в одном файле.','<p class="backup-progress" role="status">Подготавливаем данные…</p>');
 loading.onClose(()=>operation.abort());
 try{const blob=await service.exportArchive({signal:operation.signal,progress:(done,total)=>{const label=loading.el.querySelector('.backup-progress');if(label)label.textContent=`Фото ${done} из ${total}`}});if(!loading.el.isConnected)return;loading.close();downloadFile(blob,`remontsmeta_${todayLocal()}.rmsbackup`);toast('Полная копия подготовлена. Выберите папку для сохранения.')}
 catch(error){loading.close();if(!(error instanceof DOMException&&error.name==='AbortError'))showError(error)}
}
function chooseBackup(){
 const input=document.createElement('input');input.type='file';input.accept='.rmsbackup,.json,application/json,application/octet-stream';
 input.addEventListener('change',async()=>{const file=input.files?.[0];if(!file)return;
  closeDialogs();const operation=new AbortController();
  const loading=dialog('Проверяем копию','Текущая смета пока не изменяется.','<p class="backup-progress" role="status">Проверяем структуру, суммы и целостность фотографий…</p>');
  loading.onClose(()=>operation.abort());
  const options={signal:operation.signal,progress:(done:number,total:number)=>{const label=loading.el.querySelector('.backup-progress');if(label)label.textContent=`Проверено фото ${done} из ${total}`}};
  try{const snapshot=await prepareBackupFile(file,options);await validateSnapshotImages(snapshot,options);if(!loading.el.isConnected)return;loading.close();
   const replacing=repository.revision()!==null;const a=projectAnalytics(snapshot.project);
   dialog('Восстановить смету?',replacing?'Текущая смета будет заменена содержимым выбранной копии.':'Будет восстановлена смета из выбранной копии.',`<div class="import-preview"><h3>${escape(snapshot.project.title)}</h3><p>${snapshot.project.rooms.length} комнат · ${a.expenseCount} платежей · ${snapshot.receipts.length} фото чеков</p><p>Бюджет: ${M.formatCents(snapshot.project.total_budget_cents)}<br>Потрачено: ${M.formatCents(a.fact)}</p></div>${replacing?'<label class="confirm-import"><input type="checkbox" required> Я понимаю, что текущая смета будет заменена</label><p class="field-hint">При необходимости сначала закройте окно и сохраните полную копию текущей сметы.</p>':''}`,async(_data,revision)=>{await service.importSnapshot(snapshot,revision);state.selected='all';state.historyItem='';state.historyPage=1;state.estimatePage=1;state.riskPage=1;page='overview';booted=true},'Восстановить',false);
  }catch(error){loading.close();if(!(error instanceof DOMException&&error.name==='AbortError'))showError(error)}
 });input.click();
}
function downloadCsv(payments:boolean){const p=repository.get();if(!p)throw new AppError('ENTITY_NOT_FOUND','Сначала создайте смету.');downloadFile(new Blob([payments?paymentsCsv(p):estimateCsv(p)],{type:'text/csv;charset=utf-8'}),`remontsmeta_${payments?'payments':'estimate'}_${todayLocal()}.csv`);toast('CSV подготовлен для скачивания')}
async function printProject(){const p=repository.get();if(!p)throw new AppError('ENTITY_NOT_FOUND','Сначала создайте смету.');closeDialogs();const node=document.querySelector<HTMLDivElement>('#print-root')!;node.innerHTML=printMarkup(p);await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));window.print()}
document.addEventListener('click',async e=>{
 const target=(e.target as Element).closest<HTMLButtonElement>('button[data-action]');if(!target||target.disabled)return;const action=target.dataset.action,id=target.dataset.id;
 try{switch(action){
 case 'new-project':projectForm();break;case 'project-edit':projectForm(true);break;
 case 'demo':target.disabled=true;try{await service.run(()=>repository.createDemo());render();toast('Открыт пример сметы. Добавьте платежи, чтобы проверить сводку.')}finally{target.disabled=false}break;
 case 'room-add':roomForm();break;case 'room-edit':roomForm(id);break;
 case 'item-add':itemForm(target.dataset.room);break;case 'item-edit':itemForm(undefined,id);break;
 case 'expense-add':paymentForm(target.dataset.item);break;case 'expense-edit':paymentForm(undefined,id);break;
 case 'receipt-view':viewReceipt(id!);break;
 case 'room-delete':{const r=repository.get()!.rooms.find(r=>r.id===id)!;confirmDelete('Удалить комнату?',`Будут удалены комната «${escape(r.name)}», её статьи (${r.items.length}), все платежи и фото чеков.`,()=>repository.deleteRoom(id!));break}
 case 'item-delete':{const i=repository.get()!.rooms.flatMap(r=>r.items).find(i=>i.id===id)!;confirmDelete('Удалить статью?',`Будут удалены статья «${escape(i.name)}», её платежи (${i.expenses.length}) и фото чеков.`,()=>repository.deleteItem(id!));break}
 case 'expense-delete':{const entry=allExpenses(repository.get()!).find(e=>e.expense.id===id)!;confirmDelete('Удалить платёж?',`Платёж ${M.formatCents(entry.expense.amount_cents)} по статье «${escape(entry.item.name)}» и его фото чека будут удалены.`,()=>repository.deleteExpense(id!));break}
 case 'filter':state.estimatePage=1;state.filter=id as typeof state.filter;render();break;
 case 'room-select':state.estimatePage=1;state.selected=id!;state.historyItem='';state.historyPage=1;page='estimate';state.query='';render();break;
 case 'item-payments':state.historyItem=id!;state.selected='all';state.historyPage=1;page='payments';render();break;
 case 'overview':case 'estimate':case 'payments':page=action;if(action==='payments'){state.historyItem='';state.historyPage=1}render();break;
 case 'estimate-prev':state.estimatePage=(state.estimatePage||1)-1;render();break;case 'estimate-next':state.estimatePage=(state.estimatePage||1)+1;render();break;
 case 'risk-prev':state.riskPage=(state.riskPage||1)-1;render();break;case 'risk-next':state.riskPage=(state.riskPage||1)+1;render();break;
 case 'history-prev':state.historyPage--;render();break;case 'history-next':state.historyPage++;render();break;
 case 'files':filesDialog();break;
 case 'archive-export':await exportArchive();break;
 case 'backup-export':await exportBackup(target);break;
 case 'backup-import':chooseBackup();break;
 case 'csv-estimate':downloadCsv(false);break;
 case 'csv-payments':downloadCsv(true);break;
 case 'print':await printProject();break;
 case 'install':if(!await pwa.install())dialog('Установить приложение','Отдельное окно и значок на вашем устройстве.','<div class="help-copy"><p>В Chrome или Edge откройте меню браузера и выберите «Установить РемонтСмета» или «Установить страницу как приложение». На iPhone: Safari → «Поделиться» → «На экран Домой».</p><p>Первый запуск нужен с интернетом. Отключайте сеть после появления «Офлайн готов».</p></div>');break;
 case 'pwa-update':if(document.querySelector('dialog'))toast('Сначала сохраните или закройте открытую форму.');else pwa.update();break;
 case 'reload':location.reload();break;
 case 'raw':{const raw=localStorage.getItem(STORAGE_KEY);if(!raw){toast('Сохранённых данных нет');break}const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='remontsmeta-recovery-metadata.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);break}
 case 'help':dialog('Как устроена РемонтСмета','Смета, расходы, чеки и резервные копии.',`<div class="help-copy"><ol><li>Задайте общий бюджет ремонта.</li><li>Добавьте комнаты и статьи работ и материалов с плановыми суммами.</li><li>Нажмите «Записать расход», выберите статью и сумму. При желании добавьте заметку и фото чека.</li><li>Откройте «Сводку»: от 90% плана статья требует внимания, свыше 100% — это перерасход.</li><li>В разделе «Платежи» можно открыть чек, изменить или удалить расход.</li></ol><p>«Осталось от бюджета» — общий бюджет минус фактические платежи. «Ещё не распределено» — общий бюджет минус плановые суммы статей.</p><p>Фото сжимается до 300 КБ. HEIC обрабатывается встроенным локальным декодером. Если конкретное фото повреждено или не поддерживается, выберите JPEG.</p><p>Смета и чеки хранятся в этом браузере. Другой браузер или профиль имеет отдельные данные. Очистка данных сайта удаляет локальную смету. Создавайте полную резервную копию через «Файлы». Она содержит смету, платежи и фото чеков. CSV и печать предназначены для просмотра и не заменяют резервную копию.</p></div>`);break;
 }}catch(error){showError(error)}
});
document.addEventListener('input',e=>{const el=e.target as HTMLInputElement;if(el.id!=='search')return;state.query=el.value;state.estimatePage=1;const position=el.selectionStart;render();const next=document.querySelector<HTMLInputElement>('#search')!;next.focus();try{next.setSelectionRange(position,position)}catch{}});
document.addEventListener('change',e=>{const el=e.target as HTMLSelectElement;if(el.id==='theme-choice'){if(!applyTheme(el.value))toast('Тема применена, но сохранить настройку не удалось.');return}if(el.id==='history-filter'){state.historyItem=el.value;state.historyPage=1;render()}});
window.addEventListener('beforeunload',event=>{if([...openDialogs.values()].some(d=>d.hasUnsaved())){event.preventDefault();event.returnValue=''}});
window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY||e.key===null){try{repository.load();render();toast('Смета обновлена из другой вкладки. Открытые формы нужно закрыть и открыть заново.')}catch(error){boot();showError(error)}}});
function boot(){
 booted=false;
 try{repository=new ProjectRepository(window.localStorage);repository.load();service=new ProjectService(repository,receipts);booted=true;render();
  void navigator.storage?.persist?.().catch(()=>false);
  void service.recover().then(async()=>{await refreshUsage();render();if(service.notice)toast(service.notice)}).catch(async e=>{await refreshUsage();render();showError(e)});
 }catch(e){if(repository)service=new ProjectService(repository,receipts);root.innerHTML=`<main class="recovery"><div class="brand">${icon('home')} РемонтСмета</div><h1>Не удалось открыть смету</h1><p>${escape(e instanceof Error?e.message:'Хранилище недоступно.')}</p><p>Не очищайте данные браузера. Сохраните исходные данные перед восстановлением. Этот файл содержит только сведения о смете и платежах, без фото чеков.</p><div class="actions">${button('raw','Скачать исходные данные','wallet')}${repository?button('backup-import','Восстановить из копии','upload'):''}${button('reload','Повторить','arrow','button button--secondary')}</div></main>`}
}
boot();
pwa.start();

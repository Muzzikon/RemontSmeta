import { MoneyEngine as M, allExpenses, todayLocal, itemFact, projectAnalytics, type RepairProject } from './domain.ts';
import { escape, dateLabel } from './ui.ts';
function numeric(cents:number):string{const value=BigInt(cents),abs=value<0n?-value:value;return `${value<0n?'-':''}${abs/100n}.${String(abs%100n).padStart(2,'0')}`}
function cell(value:string,number=false):string{const safe=!number&&(/^[\t\r\n]/.test(value)||/^\s*[=+\-@]/.test(value))?"'"+value:value;return '"'+safe.replace(/"/g,'""')+'"'}
export function estimateCsv(project:RepairProject):string{
 const header=['Комната','Статья','Категория','План, RUB','Факт, RUB','Остаток, RUB'].map(v=>cell(v)).join(',');
 const lines=project.rooms.flatMap(r=>r.items.map(i=>[cell(r.name),cell(i.name),cell(i.type==='work'?'Работы':'Материалы'),cell(numeric(i.planned_cents),true),cell(numeric(itemFact(i)),true),cell(numeric(i.planned_cents-itemFact(i)),true)].join(',')));
 return '\uFEFF'+[header,...lines].join('\r\n')+'\r\n';
}
export function paymentsCsv(project:RepairProject):string{
 const header=['Дата','Комната','Статья','Категория','Сумма, RUB','Заметка','Есть фото'].map(v=>cell(v)).join(',');
 return '\uFEFF'+[header,...allExpenses(project).sort((a,b)=>a.expense.spent_at.localeCompare(b.expense.spent_at)).map(({room,item,expense:e})=>[cell(e.spent_at),cell(room.name),cell(item.name),cell(item.type==='work'?'Работы':'Материалы'),cell(numeric(e.amount_cents),true),cell(e.note),cell(e.receipt_id?'Да':'Нет')].join(','))].join('\r\n')+'\r\n';
}
export function printMarkup(project:RepairProject):string{
 const a=projectAnalytics(project);
 return `<article class="print-document"><header><span>РЕМОНТСМЕТА / ОТЧЁТ</span><h1>${escape(project.title)}</h1><p>Смета и фактические расходы · ${dateLabel(todayLocal())}</p></header><dl><div><dt>Общий бюджет</dt><dd>${M.formatCents(project.total_budget_cents)}</dd></div><div><dt>План по смете</dt><dd>${M.formatCents(a.planned)}</dd></div><div><dt>Фактически потрачено</dt><dd>${M.formatCents(a.fact)}</dd></div><div><dt>Осталось от бюджета</dt><dd>${M.formatCents(a.budgetRemaining)}</dd></div></dl><table><thead><tr><th>Статья</th><th>Категория</th><th>План, ₽</th><th>Факт, ₽</th><th>Остаток, ₽</th></tr></thead><tbody>${a.rooms.map(r=>`<tr class="print-room"><th colspan="2">${escape(r.room.name)}</th><td>${M.formatCents(r.planned)}</td><td>${M.formatCents(r.fact)}</td><td>${M.formatCents(r.deltaCents)}</td></tr>${r.items.map(i=>`<tr><td>${escape(i.item.name)}</td><td>${i.item.type==='work'?'Работы':'Материалы'}</td><td>${M.formatCents(i.item.planned_cents)}</td><td>${M.formatCents(i.fact)}</td><td>${M.formatCents(i.deltaCents)}</td></tr>`).join('')}${!r.items.length?'<tr><td colspan="5">В комнате пока нет статей</td></tr>':''}`).join('')}<tr class="print-total"><th colspan="2">Итого по смете</th><td>${M.formatCents(a.planned)}</td><td>${M.formatCents(a.fact)}</td><td>${M.formatCents(a.planRemaining)}</td></tr></tbody></table><p class="print-footnote">Остаток по смете — план статей минус факт. Остаток общего бюджета — общий лимит минус факт. Фото чеков находятся в полной резервной копии .rmsbackup или JSON.</p></article>`;
}
export function downloadFile(contents:Blob,filename:string):void{const url=URL.createObjectURL(contents),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}

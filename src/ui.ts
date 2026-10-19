import { icon } from './icons.ts';
import { type BudgetEvaluation } from './domain.ts';
export const escape = (value:string) => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const button=(action:string,label:string,ico?:string,cls='button',data='')=>`<button type="button" class="${cls}" data-action="${action}" ${data.includes('aria-label')?'':`aria-label="${escape(label)}"`} ${data}>${ico?icon(ico):''}<span>${label}</span></button>`;
export function field(label:string,name:string,value='',max=100,placeholder='',money=false){return `<label class="field"><span>${label}</span><input name="${name}" value="${escape(value)}" maxlength="${max}" placeholder="${placeholder}" required ${money?'inputmode="decimal"':'type="text"'} autocomplete="off"></label>`}
export function plural(n:number,a:string,b:string,c:string){return n%10===1&&n%100!==11?a:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?b:c}
export function statusLabel(value:BudgetEvaluation):string{return value.status==='danger'?'Перерасход':value.status==='warning'?'Внимание':'В пределах плана'}
export function percentageLabel(value:BudgetEvaluation):string {
 if(value.percentage===null)return 'Без плановой суммы';
 if(value.status==='ok'&&value.percentage<90&&value.percentage>=89.95)return 'менее 90%';
 if(value.status==='danger'&&value.percentage>100&&value.percentage<100.05)return 'более 100%';
 return `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value.percentage)}%`;
}
export function progress(value:BudgetEvaluation):string {return `<div class="spend-progress status-${value.status}" role="img" aria-label="${statusLabel(value)}, ${percentageLabel(value)}"><i style="width:${value.percentage===null?100:Math.min(100,value.percentage)}%"></i></div>`}
export function badge(value:BudgetEvaluation):string{return `<span class="status-badge status-${value.status}">${statusLabel(value)}</span>`}
export function dateLabel(date:string):string {const [y,m,d]=date.split('-');return `${d}.${m}.${y}`}

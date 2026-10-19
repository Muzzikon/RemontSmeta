import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, overview } from '../src/views.ts';
import { projectAnalytics } from '../src/domain.ts';
function fixture(count){const now=new Date().toISOString(),id=()=>crypto.randomUUID();const p={id:id(),title:'Проект',total_budget_cents:100000000,created_at:now,updated_at:now,rooms:[]};for(let r=0;r<3;r++){const room={id:id(),project_id:p.id,name:'Комната '+r,order_index:r,items:[]};p.rooms.push(room);for(let i=r;i<count;i+=3){const item={id:id(),room_id:room.id,name:'Статья'+String(i).padStart(3,'0'),type:'material',planned_cents:10000,expenses:[]};item.expenses.push({id:id(),budget_item_id:item.id,amount_cents:9500,spent_at:now.slice(0,10),note:'',receipt_id:null,created_at:now});room.items.push(item)}}return p}
const state=()=>({selected:'all',filter:'all',query:'',historyItem:'',historyPage:1});
test('страницы сметы не теряют статьи на границах комнат и сохраняют общие итоги',()=>{
 const p=fixture(117),s=state(),seen=[];
 for(let page=1;page<=3;page++){s.estimatePage=page;const html=estimate(p,s);const names=[...html.matchAll(/<strong>(Статья\d+)<\/strong>/g)].map(m=>m[1]);assert.ok(names.length<=50);seen.push(...names);assert.ok(html.includes('117'));}
 assert.equal(seen.length,117);assert.equal(new Set(seen).size,117);
 s.query='Статья000';s.estimatePage=3;const html=estimate(p,s);assert.equal(s.estimatePage,1);assert.ok(html.includes('<strong>Статья000</strong>'));
});
test('страницы рисков показывают все проблемы и не меняют расчёт расходов',()=>{
 const p=fixture(67),a=projectAnalytics(p),seen=[];
 for(let page=1;page<=3;page++){const html=overview(p,a,page);const names=[...html.matchAll(/<h4>(Статья\d+)<\/h4>/g)].map(m=>m[1]);assert.ok(names.length<=25);seen.push(...names)}
 assert.equal(new Set(seen).size,67);assert.equal(a.fact,67*9500);
});

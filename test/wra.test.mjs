import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zipSync,strToU8} from 'fflate';
import {parseWraDeck,parseWra,loadWra,refreshWra,completeWraWeek} from '../src/wra.mjs';
import {lunchReminderAllowed} from '../src/schools.mjs';
const xml=JSON.parse(readFileSync(new URL('./providers/wra-slides.json',import.meta.url)));
const bytes=zipSync(Object.fromEntries(xml.map((x,i)=>[`ppt/slides/slide${i+1}.xml`,strToU8(x)])));
const slides=parseWraDeck(bytes);
test('WRA first three slides preserve table columns and inline text runs',()=>{
 const menu=parseWra(slides,'dinner','2026-10-09');assert.ok(menu.groups.find(g=>g.name==='Entrée').items.includes('Chicken Tikka Masala'));assert.ok(menu.groups.find(g=>g.name==='Sides').items.includes('Rice'));
 assert.ok(parseWra(slides,'lunch','2026-10-05').groups.find(g=>g.name==='Entrée').items.includes('Grilled Chicken Parm'));
 assert.ok(parseWra(slides,'dinner','2026-10-06').groups.find(g=>g.name==='Entrée').items.includes('BBQ Tacos'));
 assert.ok(parseWra(slides,'dinner','2026-10-05').groups.find(g=>g.name==='Entrée').items.includes('Burgers'));
 assert.equal(parseWra(slides,'lunch','2026-10-10').brunch,true);assert.equal(parseWra(slides,'lunch','2026-10-11').brunch,true);
 assert.equal(parseWra(slides,'dinner','2026-10-12').available,false);
 assert.equal(parseWra(slides,'dinner','2026-10-04').available,false);
});
test('school lunch reminders skip verified weekend brunch without removing Saturday lunch elsewhere',()=>{
 for(const s of ['wra','loomis'])for(const day of ['Sat','Sun'])assert.equal(lunchReminderAllowed(s,day),false);
 for(const s of ['sps','groton','deerfield','taft','lawrenceville','cate','andover','peddie'])assert.equal(lunchReminderAllowed(s,'Sat'),true);
});
test('WRA cached query never serves another week and Monday refresh validates current week',async()=>{
 let record={payload:JSON.stringify(slides),updated_at:0},writes=0;const attempts=new Map();
 const env={DB:{prepare(){return {bind(...args){return {async first(){return args[0]==='wra'?record:attempts.get(args[0])},async run(){if(args[0]==='wra'){writes++;record={payload:args[1],updated_at:args[2]}}else attempts.set(args[0],{payload:args[1]})}}}}}}};
 assert.equal((await loadWra(env,'dinner','2026-10-05',()=>{throw Error('cache should be used')})).available,true);
 await assert.rejects(()=>loadWra(env,'dinner','2026-10-12',async()=>new Response('no',{status:503})));
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(bytes);
 try{
 await refreshWra(env,new Date('2026-10-05T10:00:00Z'),{date:'2026-10-05',weekday:'Mon',minutes:360});assert.equal(writes,0);
 await assert.rejects(()=>refreshWra(env,new Date('2026-10-12T10:00:00Z'),{date:'2026-10-12',weekday:'Mon',minutes:360}));assert.equal(writes,0);
 }finally{globalThis.fetch=original}
});
test('Saturday brunch detection distinguishes actual food from a breakfast/lunch substitution notice',async()=>{
 const {loadMenu}=await import('../src/menu.mjs');
 const {parsePeddie}=await import('../src/providers.mjs');
 const date='2026-10-10';
 for(const actual of [true,false]){
  const menu=await loadMenu('lunch',date,async url=>Response.json({days:[{date,menu_info:{},menu_items:url.includes('/brunch/')?(actual?[{food:{name:'Pancakes'}}]:[{text:'Breakfast and lunch offered in lieu of brunch.'}]):[]}]}),'groton');
  assert.equal(Boolean(menu.brunch),actual);
 }
 assert.equal(parsePeddie({events:[{title:'Brunch',start_date:date+' 11:00:00',description:'Eggs'}]},'lunch',date).brunch,true);
});

test('WRA retries next morning after stale or partial publication and stops once the week is complete',async()=>{
 const records=new Map();let requests=0;let published=structuredClone(slides);
 const env={DB:{prepare(){return {bind(...a){return {async first(){return records.get(a[0])},async run(){records.set(a[0],{payload:a[1],updated_at:a[2]})}}}}}}};
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{requests++;return new Response(zipSync(Object.fromEntries(published.map((rows,i)=>[`ppt/slides/slide${i+1}.xml`,strToU8(xml[i])]))))};
 // Monday sees last week's deck; repeated cron ticks do not repeat that day's download.
 try{
 await assert.rejects(()=>refreshWra(env,new Date('2026-10-12T10:00:00Z'),{date:'2026-10-12',minutes:360}));
 await refreshWra(env,new Date('2026-10-12T10:01:00Z'),{date:'2026-10-12',minutes:361});assert.equal(requests,1);
 globalThis.fetch=async()=>{requests++;return new Response(zipSync(Object.fromEntries(xml.map((x,i)=>[`ppt/slides/slide${i+1}.xml`,strToU8(x.replaceAll('Week of 10/5','Week of 10/12'))]))))};
 await refreshWra(env,new Date('2026-10-13T10:00:00Z'),{date:'2026-10-13',minutes:360});assert.equal(requests,2);
 await refreshWra(env,new Date('2026-10-14T10:00:00Z'),{date:'2026-10-14',minutes:360});assert.equal(requests,2);
 assert.ok(completeWraWeek(JSON.parse(records.get('wra').payload),'2026-10-13'));
 const partial=structuredClone(slides);partial[2].filter(r=>r.length===8).slice(1).forEach(r=>r[7]=[]);assert.equal(completeWraWeek(partial,'2026-10-05'),false);
 const mixed=structuredClone(slides);mixed[0][0][0]=['BREAKFAST - Week of 9/28'];assert.equal(completeWraWeek(mixed,'2026-10-05'),false);
 }finally{globalThis.fetch=original}
});

test('WRA duplicate station labels and dish case/spacing variations produce one entree and rating row',async()=>{
 const {entrees}=await import('../src/ratings.mjs');
 const repeated=structuredClone(slides);
 const rows=repeated[2].filter(r=>/^(BRAVO|PIONEER PLATES|INSPIRED EATS)$/i.test(r[0]?.join(' ').trim()));
 rows[0][1]=['Family Tailgate Meal','Grilled Chicken'];rows[1][1]=['Family Tailgate Meal','grilled   chicken'];rows[2][1]=['Burgers','Burgers'];
 const menu=parseWra(repeated,'dinner','2026-10-05');
 assert.deepEqual(menu.groups.find(g=>g.name==='Entrée').items,['Grilled Chicken','Family Tailgate Meal','Burgers']);
 assert.equal(entrees(menu).length,3);
});

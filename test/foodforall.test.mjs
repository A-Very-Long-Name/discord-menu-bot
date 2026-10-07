import test from 'node:test';
import assert from 'node:assert/strict';
import {allSchoolMenus} from '../src/foodforall.mjs';
import {SCHOOLS} from '../src/schools.mjs';
test('all schools sorted, failed/empty meals preserved, historical ratings read-only and school isolated',async()=>{
 const reads=[];let active=0,max=0;
 const env={DB:{prepare(sql){assert.ok(sql.startsWith('SELECT'));return {bind(name,school){reads.push([name,school]);return {async all(){return {results:[{value:1,n:school==='sps'?3:1},{value:2,n:2}]}}}}}}}};
 const loader=async(id,meal,date)=>{
  active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;
  if(id==='cate')throw Error('offline');return {meal,date,available:id!=='peddie',groups:id==='peddie'?[]:[{name:'Entrée',items:['Chicken']} ]};
 };
 const cards=await allSchoolMenus(env,'lunch','2026-10-06',null,loader);
 assert.equal(cards.length,Object.keys(SCHOOLS).length);assert.equal(max,2);
 assert.ok(cards[0].embeds[0].title.startsWith('Cate'));assert.ok(cards.at(-1).embeds[0].title.startsWith('Western'));
 for(const c of cards){assert.deepEqual(c.components,[]);assert.equal(c.embeds[0].fields[0].name,'Past ratings');assert.equal(c.embeds[0].footer.text,'a bot by hydrogen_01');}
 assert.match(cards[0].embeds[0].description,/could not be retrieved/);
 assert.match(cards.find(c=>c.embeds[0].title.startsWith('Peddie')).embeds[0].description,/No menu items/);
 assert.match(cards.find(c=>c.embeds[0].title.startsWith("St. Paul's")).embeds[0].fields[0].value,/👍 3/);
 assert.equal(reads.length,8);
});
test('one message preserves every school and attaches full menus when Discord embed limits require shortening',async()=>{
 const {combineSchoolMenus}=await import('../src/foodforall.mjs');
 const cards=Object.values(SCHOOLS).map(s=>({embeds:[{title:s.name+' · Dinner',description:'A long menu '.repeat(100),url:'https://example.com/menu',fields:[{name:'Past ratings',value:'👍 3 · 🤔 1 · 👎 0'}]}]}));
 const p=combineSchoolMenus(cards,'dinner','2026-10-07');assert.equal(p.embeds.length,1);assert.equal(p.embeds[0].fields.length,10);assert.equal(p.components.length,0);assert.ok(p.fullText.includes('A long menu '.repeat(100)));
 const e=p.embeds[0];assert.ok(e.title.length+e.footer.text.length+e.fields.reduce((n,f)=>n+f.name.length+f.value.length,0)<=6000);
 for(const f of e.fields){assert.ok(f.value.length<=1024);assert.match(f.value,/Past ratings/);}
});
test('meal cutoffs roll only omitted dates to tomorrow, including year boundary',async()=>{
 const {defaultQueryDate,defaultQueryMeal,queryDate}=await import('../src/menu.mjs');
 assert.equal(defaultQueryDate({date:'2026-12-31',minutes:1200},'dinner'),'2027-01-01');
 assert.equal(defaultQueryDate({date:'2026-10-06',minutes:839},'lunch'),'2026-10-06');
 assert.equal(defaultQueryDate({date:'2026-10-06',minutes:840},'lunch'),'2026-10-07');
 assert.equal(defaultQueryDate({date:'2026-10-06',minutes:1199},'dinner'),'2026-10-06');
 assert.equal(defaultQueryMeal(1200),'lunch');assert.equal(defaultQueryMeal(1199),'dinner');
 assert.equal(queryDate('10/06','2026-10-07'),'2026-10-06');
});

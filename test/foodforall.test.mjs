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

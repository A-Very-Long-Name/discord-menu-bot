import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zipSync,strToU8} from 'fflate';
import {parseWraDeck,parseWra,loadWra,refreshWra} from '../src/wra.mjs';
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
 let record={payload:JSON.stringify(slides),updated_at:0},writes=0;
 const env={DB:{prepare(){return {bind(...args){return {async first(){return record},async run(){writes++;record={payload:args[1],updated_at:args[2]}}}}}}}};
 assert.equal((await loadWra(env,'dinner','2026-10-05',()=>{throw Error('cache should be used')})).available,true);
 await assert.rejects(()=>loadWra(env,'dinner','2026-10-12',async()=>new Response('no',{status:503})));
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(bytes);
 try{
 await refreshWra(env,new Date('2026-10-05T10:00:00Z'),{date:'2026-10-05',weekday:'Mon',minutes:360});assert.equal(writes,1);
 await assert.rejects(()=>refreshWra(env,new Date('2026-10-12T10:00:00Z'),{date:'2026-10-12',weekday:'Mon',minutes:360}));assert.equal(writes,1);
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

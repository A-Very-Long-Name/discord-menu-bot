import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDeerfield,parseLawrenceville,parsePeddie,parseElevate,classify} from '../src/providers.mjs';
import {parseMenu,loadMenu,localTime} from '../src/menu.mjs';
const read=name=>readFileSync(new URL('./providers/'+name,import.meta.url),'utf8');
const fixture=name=>JSON.parse(read(name));
const items=(menu,group)=>menu.groups.find(g=>g.name===group)?.items||[];
test('Groton metadata identifies entree and splits bundled sides, skipping vegetarian and soup',()=>{
 const menu=parseMenu(fixture('groton-lunch.json'),'lunch','2026-10-06','groton');
 assert.deepEqual(items(menu,'Entrée'),['Beef Taco Bar w/ Soft Flour Tortillas']);
 assert.deepEqual(items(menu,'Sides'),['Sazon Rice','Steamed Corn','Roasted Cauliflower']);
 assert.ok(!JSON.stringify(menu.groups).includes('Lentil Soup'));
 const dinner=parseMenu(fixture('groton-dinner.json'),'dinner','2026-10-06','groton');assert.deepEqual(items(dinner,'Entrée'),['BBQ Beef Brisket']);assert.ok(items(dinner,'Sides').includes('Mac n Cheese'));
});
test('Cate identifies taco meat rather than first tortilla, removes toppings and alternatives',()=>{
 const lunch=parseMenu(fixture('cate-lunch.json'),'lunch','2026-10-06','cate');assert.deepEqual(items(lunch,'Entrée'),['Pork Taco Meat']);
 assert.ok(!JSON.stringify(lunch.groups).includes('Vegetable Taco Filling'));assert.ok(!JSON.stringify(lunch.groups).includes('Cilantro'));
 const dinner=parseMenu(fixture('cate-dinner.json'),'dinner','2026-10-06','cate');assert.deepEqual(items(dinner,'Entrée'),['Chicken Cheddar Quesadilla']);assert.ok(items(dinner,'Sides').includes('Mexican Rice'));
});
test('Lawrenceville exact daily headings, two actual dinner entrees, no stale date fallback',()=>{
 const html=read('lawrenceville.html');assert.deepEqual(items(parseLawrenceville(html,'dinner','2026-10-06'),'Entrée'),['Carolina Baby Back Ribs','Blackened Roasted Catfish']);
 assert.deepEqual(items(parseLawrenceville(html,'lunch','2026-10-06'),'Sides'),['Herb Roasted Potatoes','Roasted Brussel Sprouts']);
 assert.equal(parseLawrenceville(html,'dinner','2026-10-10').available,false);assert.equal(parseLawrenceville(html,'dinner','2027-10-06').available,false);
});
test('Deerfield handles singleton categories and grouped bread without condiments or allergens',()=>{
 const html=read('deerfield.html');const lunch=parseDeerfield(html,'lunch','2026-10-06');assert.deepEqual(items(lunch,'Entrée'),['Caprese Chicken Breast']);assert.deepEqual(items(lunch,'Sides'),['Potato Chips']);
 const dinner=parseDeerfield(html,'dinner','2026-10-06');assert.deepEqual(items(dinner,'Sides'),['Coconut Rice','Broccoli','Coconut Bread']);assert.ok(!JSON.stringify(dinner).includes('Allergens'));
 assert.equal(parseDeerfield(html,'dinner','2026-11-06').available,false);
});
test('Peddie distinguishes closed meals and reads full descriptions, not list excerpts',()=>{
 const data=fixture('peddie.json');assert.equal(parsePeddie(data,'lunch','2026-10-06').closed,true);
 const dinner=parsePeddie(data,'dinner','2026-10-06');assert.deepEqual(items(dinner,'Entrée'),['Chicken with Hearty Vegetable Gravy','Fried Flounder']);assert.deepEqual(items(dinner,'Dessert'),['Pudding']);assert.ok(!JSON.stringify(dinner.groups).includes('Tofu'));
 const tomorrow=parsePeddie(data,'dinner','2026-10-07');assert.deepEqual(items(tomorrow,'Entrée'),['Spaghetti with Mussels','Grilled Chipotle Chicken']);
 assert.equal(parsePeddie(data,'dinner','2026-11-06').available,false);
});
test('Elevate exact main station and date excludes soups, alternatives and ingredient toppings',()=>{
 for(const id of ['andover','taft'])for(const meal of ['lunch','dinner'])for(const date of ['2026-10-05','2026-10-06','2026-10-07']){
  const menu=parseElevate(fixture(`${id}-${meal}-${date}.json`),id,meal,date);assert.ok(items(menu,'Entrée').length,`${id} ${meal} ${date}`);
  assert.ok(!JSON.stringify(menu.groups).match(/Chicken Noodle Soup|Plant-Based|Gumbo/));
 }
 assert.deepEqual(items(parseElevate(fixture('taft-lunch-2026-10-06.json'),'taft','lunch','2026-10-06'),'Entrée'),['Hoisin-Mango Pork Ribs']);
 assert.equal(parseElevate(fixture('taft-lunch-2026-10-06.json'),'taft','lunch','2026-10-07').available,false);
 assert.throws(()=>parseElevate({errors:[{}]},'taft','lunch','2026-10-06'));
});
test('classification avoids meat sauces and shepherd pie dessert confusion, keeps herb-seasoned rice',()=>{
 assert.deepEqual(classify(["Country Shepherd's Pie",'Beef Gravy','Cilantro Lime Rice']),[{name:'Entrée',items:["Country Shepherd's Pie"]},{name:'Sides',items:['Cilantro Lime Rice']}]);
 assert.equal(localTime(new Date('2026-10-07T01:00:00Z'),'America/Los_Angeles').minutes,1080);
});
test('external request uses correct meal/date and catches unavailable feeds',async()=>{
 let url;
 const menu=await loadMenu('dinner','2026-10-06',async u=>{url=u;return Response.json(fixture('taft-dinner-2026-10-06.json'))},'taft');
 const variables=JSON.parse(new URL(url).searchParams.get('variables'));assert.equal(variables.mealPeriod,16);assert.equal(variables.date,'2026-10-06');assert.ok(menu.available);
 await assert.rejects(loadMenu('dinner','2026-10-06',async()=>new Response('',{status:503}),'deerfield'));
});

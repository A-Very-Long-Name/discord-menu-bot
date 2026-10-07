import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {scheduledMeal, localTime, parseMenu, payload, validDate, queryDate, greeting, wantedSection, loadMenu} from '../src/menu.mjs';
import worker, {verify, sendScheduled} from '../src/worker.mjs';
const fixture = meal => JSON.parse(readFileSync(new URL(`./${meal}-2026-09-09.json`, import.meta.url)));
test('school timezone, summer and winter schedules, Sunday suppression', () => {
  for (const [iso, meal] of [
    ['2026-09-09T11:00:00Z','lunch'], ['2026-09-09T19:00:00Z','dinner'],
    ['2026-12-09T12:00:00Z','lunch'], ['2026-12-09T20:00:00Z','dinner'],
    ['2026-09-13T11:00:00Z',null], ['2026-09-13T19:00:00Z','dinner'],
    ['2026-09-12T11:00:00Z','lunch'], ['2026-09-09T10:59:00Z',null],
    ['2026-09-09T11:30:00Z',null], ['2026-09-09T19:30:00Z',null], ['2026-09-09T20:30:00Z',null],
    ['2026-11-01T20:00:00Z','dinner'], ['2027-03-14T19:00:00Z','dinner']
  ]) assert.equal(scheduledMeal(new Date(iso))?.meal ?? null, meal, iso);
  assert.equal(localTime(new Date('2026-09-10T01:00:00Z')).date, '2026-09-09');
});
test('live dinner fixture keeps exactly main entree, sides and dessert', () => {
  const menu = parseMenu(fixture('dinner'), 'dinner', '2026-09-09');
  assert.deepEqual(menu.groups.map(g => g.name), ['Entrée','Sides','Dessert']);
  const text = payload(menu).embeds[0].description;
  for (const name of ['Old Fashioned Meatloaf','Macaroni & Cheese','Steamed Broccoli','Berry Cheesecake Bars']) assert.ok(text.includes(name));
  for (const name of ['Baked Beet','Clam Chowder','Power Bar','Pasta','Jasmine Rice']) assert.ok(!text.includes(name));
});
test('live lunch does not invent dessert; exact date is required', () => {
  assert.deepEqual(parseMenu(fixture('lunch'),'lunch','2026-09-09').groups.map(g => g.name), ['Entrée','Sides']);
  assert.equal(parseMenu(fixture('lunch'),'lunch','2026-09-10').available,false);
  assert.throws(() => parseMenu({},'lunch','2026-09-09'));
});
test('no matching stations stays distinct from unpublished menu; output is bounded', () => {
  assert.equal(wantedSection('Main Entrée'),true);
  assert.equal(wantedSection('Vegetarian Entree'),false);
  const menu = {meal:'brunch',date:'2026-09-09',available:true,groups:[{name:'Breakfast',items:['Eggs']}]};
  assert.ok(payload(menu).embeds[0].description.includes('No Entrée'));
  menu.groups = [{name:'Sides', items:['@everyone **hello**', 'x'.repeat(6000)]}];
  const p = payload(menu);
  assert.ok(p.embeds[0].description.length <= 4096);
  assert.deepEqual(p.allowed_mentions.parse,[]);
  assert.ok(!p.embeds[0].description.includes('@everyone'));
});
test('invalid dates and menu fetch failures', async () => {
  assert.ok(!validDate('2026-02-30')); assert.ok(validDate('2028-02-29'));
  assert.ok(!validDate('../../2026'));
  let count=0;
  const menu = await loadMenu('lunch','2026-09-09', async (url) => {
    if (url.includes('grab-n-go')) return Response.json({days:[]});
    if (++count === 1) throw new Error('timeout');
    return Response.json(fixture('lunch'));
  });
  assert.equal(count,2); assert.ok(menu.available);
});
test('Discord signatures validate original body and reject tampering, stale timestamps', async () => {
  const keys = await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const pub = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString('hex');
  const body = JSON.stringify({type:1});
  const stamp = String(Math.floor(Date.now()/1000));
  const sig = Buffer.from(await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(stamp+body))).toString('hex');
  const req = new Request('https://bot.example/interactions',{method:'POST',body,headers:{'x-signature-ed25519':sig,'x-signature-timestamp':stamp}});
  assert.ok(await verify(req,body,pub));
  assert.ok(!await verify(req,body+' ',pub));
  assert.equal((await worker.fetch(req,{DISCORD_PUBLIC_KEY:pub},{})).status,200);
  req.headers.set('x-signature-timestamp','1'); assert.ok(!await verify(req,body,pub));
});
test('scheduled delivery persists dedup, retries empty menus, suppresses Sunday lunch', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const env = {DISCORD_CHANNEL_ID:'123',DISCORD_BOT_TOKEN:'test-only',DB:{
    prepare(sql) {
      return {bind(...args) {
        return {
          async first() { return db.prepare(sql).get(...args); },
          async run() { return db.prepare(sql).run(...args); },
          async all() {return {results:db.prepare(sql).all(...args)};}
        };
      }};
    }
  }};
  const original = globalThis.fetch;
  let sends=0, missing=false;
  globalThis.fetch = async (url, options) => {
    if (url.includes('grab-n-go')) return Response.json(JSON.parse(readFileSync(new URL('./deli.json',import.meta.url))));
    if (url.includes('flikisdining')) return Response.json(missing ? {days:[]} : fixture('lunch'));
    sends++; const body=JSON.parse(options.body);
    assert.ok(body.enforce_nonce); assert.ok(body.embeds[0].description.includes('BBQ Pulled Chicken'));
    assert.ok(!body.embeds[0].description.includes('Jackfruit'));
    return Response.json({id:'456'});
  };
  try {
    const now=new Date('2026-09-09T11:00:00Z');
    missing=true; await sendScheduled(env,now); assert.equal(sends,0);
    missing=false; await sendScheduled(env,now); await sendScheduled(env,now); assert.equal(sends,1);
    await sendScheduled(env,new Date('2026-09-13T11:00:00Z')); assert.equal(sends,1);
  } finally { globalThis.fetch=original; db.close(); }
});

test('MM/DD uses current school year; greetings and footer match', () => {
 assert.equal(queryDate('09/10','2026-09-09'),'2026-09-10');
 assert.equal(queryDate('9/1','2026-09-09'),'2026-09-01');
 assert.equal(queryDate('02/29','2026-09-09'),null);
 assert.equal(queryDate('02/29','2028-01-01'),'2028-02-29');
 assert.equal(queryDate('2026-09-09','2026-09-09'),null);
 assert.equal(queryDate(undefined,'2027-01-01'),'2027-01-01');
 assert.equal(greeting('lunch'),'good morning, this is lunch today:');
 assert.equal(greeting('dinner'),'good afternoon, this is dinner today:');
 const p = payload(parseMenu(fixture('dinner'),'dinner','2026-09-09'));
 assert.equal(p.embeds[0].footer.text,'a bot by hydrogen_01');
 assert.ok(p.embeds[0].title.includes('09/09'));
});

test('weekday lunch appends deli after Coit; dinner/weekend omit it; failure is isolated', async () => {
 const deli = JSON.parse(readFileSync(new URL('./deli.json',import.meta.url)));
 const fetcher = async url => Response.json(url.includes('grab-n-go') ? deli : fixture('lunch'));
 const menu = await loadMenu('lunch','2026-09-09',fetcher);
 const text = payload(menu).embeds[0].description;
 assert.ok(text.indexOf('Grab ’n Go') > text.indexOf('Sweet Potato Fries'));
 assert.ok(text.includes('Italian Combo'));
 assert.ok(!text.includes('Turkey, Cheddar'));
 const friday = await loadMenu('lunch','2026-09-11',fetcher);
 assert.ok(payload(friday).embeds[0].description.includes('Turkey, Cheddar Cheese Sub'));
 for (const [meal,date] of [['dinner','2026-09-09'],['lunch','2026-09-12'],['lunch','2026-09-13']]) {
  const result = await loadMenu(meal,date,async url => {assert.ok(!url.includes('grab-n-go'));return Response.json(fixture('lunch'));});
  assert.equal(result.deli,undefined);
 }
 const failed = await loadMenu('lunch','2026-09-09',async url => {if(url.includes('grab-n-go')) throw Error('Offline');return Response.json(fixture('lunch'));});
 assert.ok(failed.available);assert.ok(failed.deli.failed);
 assert.ok(payload(failed).embeds[0].description.includes('could not be retrieved'));
});

test('breakfast and brunch return exact lowercase response without fetching menus', async () => {
 const keys = await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const pub = Buffer.from(await crypto.subtle.exportKey('raw',keys.publicKey)).toString('hex');
 for (const meal of ['breakfast','brunch']) {
  const body = JSON.stringify({type:2,guild_id:'g',application_id:'a',data:{name:'food',options:[{name:'meal',value:meal},{name:'date',value:'invalid'}]}});
  const stamp = String(Math.floor(Date.now()/1000));
  const sig = Buffer.from(await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(stamp+body))).toString('hex');
  const req = new Request('https://bot.example/interactions',{method:'POST',body,headers:{'x-signature-ed25519':sig,'x-signature-timestamp':stamp}});
  const res = await worker.fetch(req,{DISCORD_PUBLIC_KEY:pub,DISCORD_GUILD_ID:'g',DISCORD_APPLICATION_ID:'a'},{waitUntil(){throw Error('Should not fetch menu');}});
  const j = await res.json();
  assert.equal(j.type,4);
  assert.equal(j.data.content,"bro they're literally the same thing every time, currently not supported");
 }
});

test('rating buttons persist, prevent repeat votes and allow switching',async()=>{
 const {ratedPayload,vote,history,refreshRatings}=await import('../src/ratings.mjs');
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const env={DISCORD_APPLICATION_ID:'bot',DB:{prepare(sql) { return { bind(...args) { return { async run(){return db.prepare(sql).run(...args);}, async first(){return db.prepare(sql).get(...args);}, async all(){return {results:db.prepare(sql).all(...args)};} }; } }; }}};
 try {
  const menu=parseMenu(fixture('dinner'),'dinner','2026-09-09');const p=await ratedPayload(env,menu);
  assert.equal(p.components[0].components.length,3);assert.equal(p.embeds[0].fields[0].value,'No ratings yet');
  const i={member:{user:{id:'user'}},message:{author:{id:'bot'},components:p.components},data:{custom_id:p.components[0].components[0].custom_id}};
  await vote(env,i);await vote(env,i);assert.equal(await history(env,menu.groups[0].items[0]),'No ratings yet');await vote(env,i);assert.equal(await history(env,menu.groups[0].items[0]),'👍 1 · 🤔 0 · 👎 0 · 100% approval');
  i.data.custom_id=p.components[0].components[2].custom_id;await vote(env,i);
  assert.equal(await history(env,menu.groups[0].items[0]),'👍 0 · 🤔 0 · 👎 1 · 0% approval');
  const old=structuredClone(p.components);old[0].components.splice(1,1);
  const updated=await refreshRatings(env,{embeds:p.embeds,components:old});
  assert.equal(updated.components[0].components[1].label,'fine · 0');
  assert.equal(updated.components[0].components[0].label,'Like · 0');
  assert.equal(updated.components[0].components[2].label,'Dislike · 1');
  assert.equal(updated.embeds[0].fields[0].value,'👍 0 · 🤔 0 · 👎 1 · 0% approval');
  const later=await ratedPayload(env,{...menu,date:'2026-09-10'});assert.equal(later.embeds[0].fields[0].value,'👍 0 · 🤔 0 · 👎 1 · 0% approval');
  i.data.custom_id=p.components[0].components[1].custom_id;await vote(env,i);
  assert.equal(await history(env,menu.groups[0].items[0]),'👍 0 · 🤔 1 · 👎 0 · 0% approval');
  const neutral=await refreshRatings(env,{embeds:p.embeds,components:p.components});
  assert.equal(neutral.components[0].components[1].label,'fine · 1');
  await vote(env,i);assert.equal(await history(env,menu.groups[0].items[0]),'No ratings yet');
  i.member.user.id='second';await vote(env,i);
  i.member.user.id='user';i.data.custom_id=p.components[0].components[0].custom_id;await vote(env,i);
  assert.equal(await history(env,menu.groups[0].items[0]),'👍 1 · 🤔 1 · 👎 0 · 50% approval');
  i.message.author.id='other';assert.equal(await vote(env,i),'This rating is unavailable.');
 }finally{db.close();}
});

test('new unflagged category labels preserve sections and rating entrée',async()=>{
 const data=JSON.parse(readFileSync(new URL('./dinner-2026-10-04.json',import.meta.url)));
 const menu=parseMenu(data,'dinner','2026-10-04');
 assert.deepEqual(menu.groups,[{name:'Entree',items:['Chicken Marsala']},{name:'Sides',items:['Traditional Rice Pilaf','Roasted Mushrooms']}]);
 const {entrees}=await import('../src/ratings.mjs');assert.deepEqual(entrees(menu),['Chicken Marsala']);
 const text=payload(menu).embeds[0].description;
 for(const excluded of ['Eggplant Rollatini','Grilled Chicken Breast','Jasmine Rice'])assert.ok(!text.includes(excluded));
 // A food whose name matches a section title remains a food item.
 data.days[0].menu_items.splice(2,0,{position:1.5,text:'Sides',food:{name:'Sides'}});
 assert.deepEqual(parseMenu(data,'dinner','2026-10-04').groups[0].items,['Chicken Marsala','Sides']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {loadMenu,payload} from '../src/menu.mjs';
import {configure,bindingFor,parseTime,setupTarget} from '../src/setup.mjs';
import {ratedPayload,vote,totals} from '../src/ratings.mjs';
import {recentVoteMessages} from '../src/votes.mjs';
import {sendScheduled} from '../src/worker.mjs';
const fixture=JSON.parse(readFileSync(new URL('./loomis-lunch.json',import.meta.url)));
function database(){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const prepared=(sql,args=[])=>({
  async first(){return db.prepare(sql).get(...args)},
  async all(){return {results:db.prepare(sql).all(...args)}},
  async run(){return db.prepare(sql).run(...args)}
 });
 return {db,env:{VOTE_SCOPE:'user:123',DISCORD_APPLICATION_ID:'bot',DB:{prepare(sql){return {...prepared(sql),bind(...args){return prepared(sql,args)}}}}}};
}
test('Loomis station order uses menu_info and only Grill Main, without SPS deli',async()=>{
 const urls=[];const menu=await loadMenu('lunch','2026-10-06',async url=>{urls.push(url);return Response.json(fixture)},'loomis');
 assert.equal(urls.length,1);assert.ok(urls[0].includes('loomischaffee.api'));
 assert.deepEqual(menu.groups,[{name:'Entrée',items:['Tandoori Chicken Thigh']},{name:'Sides',items:['Paneer Makhani','Basmati Rice','Steamed Broccoli']}]);
 const {db,env}=database();const rated=await ratedPayload(env,menu);assert.equal(rated.components.length,1);assert.equal(rated.embeds[0].fields.length,1);assert.equal(rated.embeds[0].fields[0].name,'Tandoori Chicken Thigh');db.close();
 const p=payload(menu);assert.ok(p.embeds[0].title.endsWith('Loomis Dining Hall'));assert.ok(p.embeds[0].url.includes('loomischaffee'));assert.ok(!p.embeds[0].description.includes('Pizza'));
});
test('setup times, permission gate, DM success/failure, isolated bindings',async()=>{
 const {db,env}=database();
 const personal={user:{id:'123'},data:{options:[{name:'school',value:'loomis'},{name:'lunch_notification',value:'08:15'},{name:'dinner_notification',value:'17:45'}]}};
 assert.equal(parseTime('25:00',420),null);assert.equal(parseTime('08:15',420),495);
 assert.throws(()=>setupTarget({guild_id:'g',member:{user:{id:'123'},permissions:'0'},authorizing_integration_owners:{0:'g'}},'server'),/Manage Server/);
 const calls=[];let result=await configure(env,personal,async(path,method,data)=>{calls.push({path,method,data});return {id:'dm'}});
 assert.ok(result.includes('Reminders: on'));assert.equal(calls.length,2);
 const saved=await bindingFor(env,personal);assert.equal(saved.school,'loomis');assert.equal(saved.lunch_min,495);assert.equal(saved.channel_id,'dm');
 const blocked={...personal,user:{id:'456'}};
 result=await configure(env,blocked,async()=>{throw new Error('blocked')});assert.ok(result.includes('Discord blocked'));
 assert.equal((await bindingFor(env,blocked)).enabled,0);
 const server={guild_id:'g',channel_id:'channel',member:{user:{id:'123'},permissions:'32'},authorizing_integration_owners:{0:'g'},data:{options:[{name:'school',value:'sps'}]}};
 await configure(env,server,async()=>({guild_id:'g',type:0}));assert.equal((await bindingFor(env,server)).school,'sps');
 assert.equal((await bindingFor(env,{user:{id:'123'},data:{name:'food'}})).school,'loomis');
 personal.data.options.push({name:'reminders',value:false});await configure(env,personal,async()=>{throw new Error('must not call')});assert.equal((await bindingFor(env,personal)).enabled,0);
 db.close();
});
test('same dish in different schools has isolated buttons, totals and vote history',async()=>{
 const {db,env}=database();
 const menu={meal:'dinner',date:'2026-10-06',available:true,groups:[{name:'Entrée',items:['Chicken']}]};
 const personal=await ratedPayload({...env,PERSONAL_MODE:true},menu);assert.equal(personal.embeds[0].fields[0].value,'No personal ratings yet');
 const a=await ratedPayload(env,menu),b=await ratedPayload(env,{...menu,school:'loomis',groups:[{name:'Entrée',items:['Chicken']}]});
 assert.notEqual(a.components[0].components[0].custom_id,b.components[0].components[0].custom_id);
 await vote(env,{user:{id:'123'},message:{author:{id:'bot'},components:b.components},data:{custom_id:b.components[0].components[0].custom_id}});
 assert.deepEqual(await totals(env,'Chicken'),{up:0,down:0,fine:0});assert.equal((await totals({...env,SCHOOL_ID:'loomis'},'Chicken')).up,1);
 const {refreshRatings}=await import('../src/ratings.mjs');
 const pm=await ratedPayload({...env,PERSONAL_MODE:true},{...menu,school:'loomis'});assert.ok(pm.embeds[0].fields[0].value.startsWith('Personal ratings\n'));
 assert.ok((await refreshRatings(env,pm)).embeds[0].fields[0].value.startsWith('Personal ratings\n'));
 assert.ok((await recentVoteMessages(env,'2026-10-06'))[0].content.includes('No votes'));
 assert.ok((await recentVoteMessages({...env,SCHOOL_ID:'loomis',VOTE_SCOPE:'user:123'},'2026-10-06'))[0].content.includes('<@123>'));db.close();
});
test('migration preserves existing votes and legacy rating IDs',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE rating_dishes(id TEXT PRIMARY KEY,name TEXT NOT NULL);INSERT INTO rating_dishes VALUES('legacy','Chicken');CREATE TABLE entree_votes(dish TEXT,serving_date TEXT,user_id TEXT,value INTEGER CHECK(value IN(-1,0,1,2)),PRIMARY KEY(dish,serving_date,user_id));INSERT INTO entree_votes VALUES('chicken','2026-10-06','123',2)");
 db.exec(readFileSync(new URL('../migrate-schools.sql',import.meta.url),'utf8'));
 assert.deepEqual({...db.prepare('SELECT * FROM entree_votes').get()},{school:'sps',dish:'chicken',serving_date:'2026-10-06',user_id:'123',value:2});
 assert.equal(db.prepare('SELECT school FROM rating_dishes WHERE id=?').get('legacy').school,'sps');db.close();
});
test('custom reminder times support simultaneous lunch/dinner and deduplicate sends',async()=>{
 const {db,env}=database();const original=globalThis.fetch;const sent=[];
 globalThis.fetch=async(url,options)=>{if(url.includes('flikisdining'))return Response.json(fixture);sent.push(JSON.parse(options.body));return Response.json({id:'message'})};
 try{
 const custom={...env,SCHOOL_ID:'loomis',DISCORD_CHANNEL_ID:'dm',BINDING:{lunch_min:495,dinner_min:495}};
 await sendScheduled({...custom,MEAL_FORCE:'lunch'},new Date('2026-10-06T12:15:00Z'));
 await sendScheduled({...custom,MEAL_FORCE:'dinner'},new Date('2026-10-06T12:15:00Z'));
 await sendScheduled({...custom,MEAL_FORCE:'lunch'},new Date('2026-10-06T12:16:00Z'));
 assert.equal(sent.length,2);assert.ok(sent.every(p=>p.embeds[0].title.includes('Loomis')));
 }finally{globalThis.fetch=original;db.close()}
});
test('same user/dish/day ratings toggle independently in two servers and personal DM; totals never mix',async()=>{
 const {db,env}=database();
 const menu={school:'sps',meal:'dinner',date:'2026-10-07',available:true,groups:[{name:'Entrée',items:['Chicken']}]};
 const card=await ratedPayload({...env,VOTE_SCOPE:'guild:a'},menu);
 const interaction=(guild,value)=>({...(guild?{guild_id:guild}:{}),user:{id:'123'},message:{author:{id:'bot'},components:card.components},data:{custom_id:card.components[0].components.find(c=>c.custom_id.endsWith(':'+value)).custom_id}});
 await vote(env,interaction('a',1));await vote(env,interaction('b',-1));await vote(env,interaction(null,2));
 assert.deepEqual(await totals({...env,VOTE_SCOPE:'guild:a'},'Chicken'),{up:1,down:0,fine:0});
 assert.deepEqual(await totals({...env,VOTE_SCOPE:'guild:b'},'Chicken'),{up:0,down:1,fine:0});
 assert.deepEqual(await totals({...env,VOTE_SCOPE:'user:123'},'Chicken'),{up:0,down:0,fine:1});
 await vote(env,interaction('a',1));assert.deepEqual(await totals({...env,VOTE_SCOPE:'guild:a'},'Chicken'),{up:0,down:0,fine:0});
 assert.equal((await totals({...env,VOTE_SCOPE:'guild:b'},'Chicken')).down,1);
 assert.equal((await totals({...env,VOTE_SCOPE:'user:123'},'Chicken')).fine,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entree_votes').get().n,0);db.close();
});
test('Worker initializes scoped ratings through its D1 binding once and preserves existing rows',async()=>{
 const {default:worker}=await import('../src/worker.mjs');const db=new DatabaseSync(':memory:');let calls=0;
 const env={DB:{async exec(sql){calls++;db.exec(sql);return {}}}};
 assert.equal((await worker.fetch(new Request('https://bot.example/'),env,{})).status,200);
 db.exec("INSERT INTO vote_scope_states VALUES('guild:a','sps','chicken','2026-10-07','123',1)");
 await worker.fetch(new Request('https://bot.example/'),env,{});assert.equal(calls,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vote_scope_states').get().n,1);db.close();
});

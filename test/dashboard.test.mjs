import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {settingDashboard,changeSetting,timesModal} from '../src/dashboard.mjs';
import {schoolPage} from '../src/foodforall.mjs';
import {leaderboard} from '../src/leaderboard.mjs';
import {interactiveResponse} from '../src/worker.mjs';
function database(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const statement=(sql,args=[])=>({async first(){return db.prepare(sql).get(...args)},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return db.prepare(sql).run(...args)}});
 return {db,env:{DISCORD_APPLICATION_ID:'bot',VOTE_SCOPE:'user:123',DB:{prepare(sql){return {...statement(sql),bind(...args){return statement(sql,args)}}}}}};
}
const personal={application_id:'bot',token:'test',user:{id:'123'},data:{}};
const server={...personal,guild_id:'g',channel_id:'c',member:{user:{id:'123'},permissions:'32'},authorizing_integration_owners:{0:'g'}};
test('dashboard saves school, reminder toggle and modal times; existing settings survive changes',async()=>{
 const {db,env}=database();const calls=[];
 const api=async(path,method,body)=>{calls.push({path,body});return {id:'dm'}};
 assert.match((await settingDashboard(env,personal,'personal')).embeds[0].description,/Choose one or more schools/);
 await changeSetting(env,{...personal,data:{values:['cate']}},'personal','school',api);
 assert.equal(calls.length,0);assert.equal(db.prepare('SELECT enabled FROM school_bindings').get().enabled,0);
 await changeSetting(env,personal,'personal','on',api);assert.equal(calls.length,2);
 const modal=timesModal(personal,'personal');assert.equal(modal.type,9);assert.equal(modal.data.components[0].component.custom_id,'lunch');
 const submitted={...personal,data:{components:[{type:18,component:{custom_id:'lunch',value:'08:15'}},{type:18,component:{custom_id:'dinner',value:'18:30'}}]}};
 await changeSetting(env,submitted,'personal','save-times',api);
 let saved=db.prepare('SELECT * FROM school_bindings').get();assert.equal(saved.lunch_min,495);assert.equal(saved.dinner_min,1110);assert.equal(saved.enabled,1);
 await changeSetting(env,{...personal,data:{values:['loomis']}},'personal','school',api);
 saved=db.prepare('SELECT * FROM school_bindings').get();assert.equal(saved.lunch_min,495);assert.equal(saved.school,'loomis');
 const invalid=await changeSetting(env,{...personal,data:{components:[{component:{custom_id:'lunch',value:'25:00'}}]}},'personal','save-times',api);
 assert.match(invalid.content,/Use HH:mm/);assert.equal(db.prepare('SELECT lunch_min FROM school_bindings').get().lunch_min,495);
 await changeSetting(env,personal,'personal','off',api);assert.equal(db.prepare('SELECT enabled FROM school_bindings').get().enabled,0);db.close();
});
test('server dashboard checks permissions again; channel validation and blocked DMs preserve safe settings',async()=>{
 const {db,env}=database();const denied={...server,member:{...server.member,permissions:'0'}};
 await assert.rejects(()=>settingDashboard(env,denied,'server'),/Manage Server/);
 await changeSetting(env,{...server,data:{values:['sps']}},'server','school',async()=>({guild_id:'g',type:0}));
 await assert.rejects(()=>changeSetting(env,denied,'server','on',async()=>{}),/Manage Server/);
 const wrong=await changeSetting(env,{...server,data:{values:['elsewhere']}},'server','channel',async()=>({guild_id:'other',type:0}));
 assert.match(wrong.content,/Choose a text channel/);assert.equal(db.prepare('SELECT channel_id FROM school_bindings').get().channel_id,'c');
 await changeSetting(env,{...personal,data:{values:['cate']}},'personal','school',async()=>{});
 const failed=await changeSetting(env,personal,'personal','on',async()=>{throw Error('blocked')});
 assert.match(failed.content,/Discord blocked the DM/);assert.equal(db.prepare("SELECT enabled FROM school_bindings WHERE scope_id='user:123'").get().enabled,0);db.close();
});
test('menu browser loads only selected school, retains date/meal, wraps and offers all schools',async()=>{
 const {db,env}=database();const loaded=[];
 const loader=async(id,meal,date)=>{loaded.push({id,meal,date});return {school:id,meal,date,available:true,groups:[{name:'Entrée',items:['Chicken']}]}};
 const first=await schoolPage(env,'lunch','2026-10-07','123',0,loader);
 assert.equal(loaded.length,1);assert.equal(loaded[0].id,'cate');assert.equal(first.embeds.length,1);assert.equal(first.components[1].components[0].options.length,10);
 assert.match(first.components[0].components[0].custom_id,/:9$/);assert.ok(!JSON.stringify(first.components).includes('rate:'));
 const last=await schoolPage(env,'dinner','2026-10-08','123',9,loader);
 assert.equal(loaded.at(-1).id,'wra');assert.match(last.components[0].components[1].custom_id,/:0$/);assert.match(last.embeds[0].title,/Dinner · 10\/08/);db.close();
});
test('leaderboards sum likes minus dislikes, ignore withdrawals, keep neutral zero, and isolate scopes',async()=>{
 const {db,env}=database();const insert=db.prepare('INSERT INTO vote_scope_states VALUES(?,?,?,?,?,?)');let user=0;
 for(const [school,dish,value] of [['sps','chicken',1],['sps','chicken',1],['sps','chicken',-1],['sps','chicken',2],['sps','chicken',0],['sps','pasta',-1],['cate','rice',1],['cate','rice',1],['cate','soup',2]])insert.run('user:123',school,dish,'2026-10-07',String(user++),value);
 insert.run('guild:other','sps','secret dish','2026-10-07','999',1);
 const dishes=await leaderboard(env,'dishes','123');const text=dishes.embeds[0].description;
 assert.match(text,/1\. rice/);assert.match(text,/chicken.*\nScore: \*\*\+1\*\* · 👍 2 · 👎 1/);assert.match(text,/soup.*\nScore: \*\*0\*\*/);assert.doesNotMatch(text,/secret dish/);
 const schools=await leaderboard(env,'schools','123');assert.match(schools.embeds[0].description,/1\. Cate School/);assert.match(schools.embeds[0].description,/St. Paul's School\*\*\nScore: \*\*0\*\* · 👍 2 · 👎 2/);
 for(let n=0;n<15;n++)insert.run('user:123','sps','extra '+n,'2026-10-07',String(user++),1);
 const page=await leaderboard(env,'dishes','123',999);assert.match(page.embeds[0].footer.text,/Page 2\/2/);assert.equal(page.components[0].components[2].disabled,true);
 const empty=await leaderboard({...env,VOTE_SCOPE:'user:other'},'dishes','other');assert.match(empty.embeds[0].description,/No ratings yet/);db.close();
});
test('interaction routing defers work, updates existing messages, and rejects another user or forged controls',async()=>{
 const {db,env}=database();const tasks=[],calls=[];const ctx={waitUntil:p=>tasks.push(p)},api=async(path,method,data)=>{calls.push({path,method,data});return {id:'dm'}};
 const command={...personal,type:2,data:{name:'setting'}};
 assert.deepEqual(interactiveResponse(command,env,ctx,api),{type:5,data:{flags:64}});await Promise.all(tasks);
 const view=calls[0].data;const id=view.components[1].components[0].custom_id;
 const select={...personal,type:3,data:{custom_id:id,values:['cate']},message:{author:{id:'bot'},components:view.components}};
 assert.deepEqual(interactiveResponse(select,env,ctx,api),{type:6});await Promise.all(tasks);
 assert.equal(db.prepare('SELECT school FROM school_bindings').get().school,'cate');
 const other=interactiveResponse({...select,user:{id:'456'}},env,ctx,api);assert.equal(other.type,4);assert.match(other.data.content,/Open your own/);
 assert.match(interactiveResponse({...select,message:{author:{id:'other'}}},env,ctx,api).data.content,/unavailable/);
 const dash=calls.at(-1).data,custom_id=dash.components[2].components[1].custom_id;
 const modal=interactiveResponse({...select,data:{custom_id},message:{author:{id:'bot'},components:dash.components}},env,ctx,api);assert.equal(modal.type,9);
 const submit={...personal,type:5,message:select.message,data:{custom_id:modal.data.custom_id,components:[{component:{custom_id:'dinner',value:'16:20'}}]}};
 assert.deepEqual(interactiveResponse(submit,env,ctx,api),{type:6});await Promise.all(tasks);assert.equal(db.prepare('SELECT dinner_min FROM school_bindings').get().dinner_min,980);
 const board={...personal,type:2,data:{name:'leaderboard',options:[{name:'personal',type:1,options:[{name:'type',value:'schools'}]}]}};
 assert.deepEqual(interactiveResponse(board,env,ctx,api),{type:5});await Promise.all(tasks);assert.equal(calls.at(-1).data.embeds[0].title,'School leaderboard');db.close();
});
test('interactive payloads fit Discord limits and use unique control IDs, including page boundaries',async()=>{
 const {db,env}=database();
 const views=[await settingDashboard(env,personal,'personal'),await settingDashboard(env,server,'server'),await leaderboard(env,'dishes','123'),await leaderboard(env,'schools','123')];
 for(const view of views){
  assert.ok(view.components.length<=5);
  const ids=view.components.flatMap(r=>r.components.map(c=>c.custom_id));
  assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(id=>id.length<=100));
  for(const e of view.embeds){assert.ok(e.description.length<=4096);assert.ok(e.title.length<=256)}
 }
 db.close();
});
test('multiple selected schools persist, survive time changes, and can be removed; legacy bindings still work',async()=>{
 const {selectedSchools}=await import('../src/selections.mjs');
 const {db,env}=database();const api=async()=>({id:'dm'});
 await changeSetting(env,{...personal,data:{values:['sps','cate','loomis']}},'personal','school',api);
 let binding=db.prepare('SELECT * FROM school_bindings').get();
 assert.deepEqual(await selectedSchools(env,binding),['sps','cate','loomis']);
 let dashboard=await settingDashboard(env,personal,'personal');const select=dashboard.components[1].components[0];
 assert.equal(select.max_values,10);assert.equal(select.options.filter(o=>o.default).length,3);
 await changeSetting(env,{...personal,data:{components:[{component:{custom_id:'lunch',value:'08:30'}}]}},'personal','save-times',api);
 assert.deepEqual(await selectedSchools(env,binding),['sps','cate','loomis']);
 await changeSetting(env,{...personal,data:{values:['cate']}},'personal','school',api);
 binding=db.prepare('SELECT * FROM school_bindings').get();assert.equal(binding.school,'cate');assert.deepEqual(await selectedSchools(env,binding),['cate']);
 await assert.rejects(()=>changeSetting(env,{...personal,data:{values:[]}},'personal','school',api),/at least one/);
 db.prepare('DELETE FROM school_selections').run();assert.deepEqual(await selectedSchools(env,binding),['cate']);db.close();
});
test('global counts every server voter; personal counts only the requester within that server',async()=>{
 const {db,env}=database();const insert=db.prepare('INSERT INTO vote_scope_states VALUES(?,?,?,?,?,?)');
 for(const [scope,user,value] of [['guild:g','123',1],['guild:g','456',-1],['guild:g','789',1],['guild:elsewhere','123',1],['user:123','123',-1]])insert.run(scope,'sps','chicken','2026-10-07',user,value);
 const scoped={...env,VOTE_SCOPE:'guild:g'};
 const global=await leaderboard(scoped,'dishes','123',0,'global');assert.match(global.embeds[0].description,/👍 2 · 👎 1/);
 const own=await leaderboard(scoped,'dishes','123',0,'personal');assert.match(own.embeds[0].description,/👍 1 · 👎 0/);assert.match(own.components[0].components[1].custom_id,/:personal:/);
 const calls=[],tasks=[];const ctx={waitUntil:p=>tasks.push(p)},api=async(path,method,data)=>calls.push(data);
 const command={...server,type:2,data:{name:'leaderboard',options:[{name:'global',type:1,options:[{name:'type',value:'schools'}]}]}};
 assert.deepEqual(interactiveResponse(command,scoped,ctx,api),{type:5});await Promise.all(tasks);assert.equal(calls[0].flags,undefined);assert.equal(calls[0].embeds[0].title,'School leaderboard');
 const view=own,custom_id=view.components[0].components[1].custom_id;
 assert.deepEqual(interactiveResponse({...server,type:3,message:{author:{id:'bot'},components:view.components},data:{custom_id}},scoped,ctx,api),{type:6});await Promise.all(tasks);assert.match(calls.at(-1).embeds[0].description,/👍 1 · 👎 0/);db.close();
});
test('scheduler sends each selected school once with independent delivery keys',async t=>{
 const {default:worker}=await import('../src/worker.mjs');
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-06T19:00:00Z')});
 const {db,env}=database();
 db.exec("INSERT INTO school_bindings VALUES('user:123','sps','dm',420,900,1)");
 db.prepare('INSERT INTO school_selections VALUES(?,?)').run('user:123',JSON.stringify(['sps','loomis']));
 const original=globalThis.fetch,sent=[];
 globalThis.fetch=async(url,opts)=>{
  if(url.includes('flikisdining'))return Response.json({days:[{date:'2026-10-06',menu_items:[{is_section_title:true,text:'Entrée',position:0},{food:{name:'Chicken'},position:1},{is_section_title:true,text:'Grill Main',position:2},{food:{name:'Burger'},position:3}]}]});
  sent.push(JSON.parse(opts.body));return Response.json({id:String(sent.length)});
 };
 try{await worker.scheduled({},env);await worker.scheduled({},env);assert.equal(sent.length,2);assert.ok(sent.some(m=>m.embeds[0].title.includes('Coit')));assert.ok(sent.some(m=>m.embeds[0].title.includes('Loomis')));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n,2);}finally{globalThis.fetch=original;db.close();t.mock.timers.reset();}
});

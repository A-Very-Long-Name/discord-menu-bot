import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {recordMenuQuery,recentlyQueried} from '../src/query-reminders.mjs';
import {sendScheduled} from '../src/worker.mjs';
function database(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const DB={prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)},async run(){return db.prepare(sql).run(...args)}}}}}};
 return {db,env:{SCHOOL_ID:'sps',VOTE_SCOPE:'guild:g',DISCORD_CHANNEL_ID:'channel',BINDING:{dinner_min:900,lunch_min:420},MEAL_FORCE:'dinner',DB}};
}
const now=new Date('2026-11-08T20:00:00Z'),menu={school:'sps',date:'2026-11-08',meal:'dinner',available:true};
test('recent query suppresses reminder permanently across subsequent cron ticks without sending',async()=>{
 const {db,env}=database();await recordMenuQuery(env,{channel_id:'channel'},menu,now.getTime()-39*60000);
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network requests expected')};
 try{await sendScheduled(env,now);assert.equal(db.prepare('SELECT status FROM deliveries').get().status,'sent');await sendScheduled(env,new Date(now.getTime()+29*60000));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n,1);}finally{globalThis.fetch=original;db.close();}
});
test('three-hour boundary, channel, scope, school, meal/date and availability stay independent',async()=>{
 const {db,env}=database(),due={date:menu.date,meal:'dinner',age:0};
 const save=(changes={},age=180)=>recordMenuQuery(env,{channel_id:'channel'},{...menu,...changes},now.getTime()-age*60000);
 await save({},181);assert.equal(await recentlyQueried(env,due,now),false);
 await save({},180);assert.equal(await recentlyQueried(env,due,now),true);
 for(const changes of [{DISCORD_CHANNEL_ID:'other'},{VOTE_SCOPE:'guild:other'},{SCHOOL_ID:'loomis'}])assert.equal(await recentlyQueried({...env,...changes},due,now),false);
 assert.equal(await recentlyQueried(env,{...due,meal:'lunch'},now),false);
 assert.equal(await recentlyQueried(env,{...due,date:'2026-11-09'},now),false);
 db.exec('DELETE FROM menu_queries');await save({available:false},1);assert.equal(await recentlyQueried(env,due,now),false);
 await save({},-1);assert.equal(await recentlyQueried(env,due,now),false);db.close();
});

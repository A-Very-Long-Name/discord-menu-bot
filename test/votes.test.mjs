import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {voteDateRange,recentVoteMessages} from '../src/votes.mjs';
import worker,{answerVotes} from '../src/worker.mjs';
function database() {
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE vote_scope_states(scope_id TEXT DEFAULT 'guild:test',school TEXT DEFAULT 'sps',dish TEXT,serving_date TEXT,user_id TEXT,value INTEGER)");
 return {db,env:{VOTE_SCOPE:'guild:test',DB:{prepare(sql){return {bind(...args){return {async all(){return {results:db.prepare(sql).all(...args)}}}}}}}}};
}
test('three menu dates include withdrawals and exclude older and future votes',async()=>{
 assert.deepEqual(voteDateRange('2027-01-01'),{start:'2026-12-30',end:'2027-01-01'});
 const {db,env}=database();
 for(const [date,value] of [['2026-10-03',1],['2026-10-04',0],['2026-10-05',-1],['2026-10-06',2],['2026-10-07',1]]) db.prepare('INSERT INTO vote_scope_states(dish,serving_date,user_id,value) VALUES(?,?,?,?)').run('chicken',date,'123',value);
 const messages=await recentVoteMessages(env,'2026-10-06');
 const text=messages.map(x=>x.content).join('\n');
 assert.ok(text.includes('10/04 · <@123> · chicken · Withdrawn'));
 assert.ok(text.includes('10/05 · <@123> · chicken · 👎 Dislike'));
 assert.ok(text.includes('10/06 · <@123> · chicken · 🤔 fine'));
 assert.ok(!text.includes('10/03')); assert.ok(!text.includes('10/07'));
 db.close();
});
test('long vote histories split into private messages without dropping entries',async()=>{
 const {db,env}=database();
 for(let n=0;n<120;n++)db.prepare('INSERT INTO vote_scope_states(dish,serving_date,user_id,value) VALUES(?,?,?,?)').run('dish '+n,'2026-10-06',String(1000+n),1);
 const calls=[]; const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{calls.push({url,method:options.method,data:JSON.parse(options.body)});return Response.json({id:'1'});};
 try {
 await answerVotes({application_id:'app',token:'test'},env,'2026-10-06');
 assert.ok(calls.length>1); assert.equal(calls[0].method,'PATCH');
 assert.ok(calls.slice(1).every(x=>x.method==='POST'));
 for(const call of calls){assert.equal(call.data.flags,64);assert.ok(call.data.content.length<=1900);assert.deepEqual(call.data.allowed_mentions.parse,[]);}
 assert.equal(calls.map(x=>x.data.content).join('\n').match(/👍 Like/g).length,120);
 } finally {globalThis.fetch=original;db.close();}
});
test('/votes accepts an ordinary member and defers privately',async()=>{
 const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const pub=Buffer.from(await crypto.subtle.exportKey('raw',keys.publicKey)).toString('hex');
 const body=JSON.stringify({type:2,guild_id:'guild',application_id:'app',data:{name:'votes'},member:{user:{id:'123'},permissions:'0'},token:'test'});
 const stamp=String(Math.floor(Date.now()/1000));
 const sig=Buffer.from(await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(stamp+body))).toString('hex');
 const request=new Request('https://bot.example/interactions',{method:'POST',body,headers:{'x-signature-ed25519':sig,'x-signature-timestamp':stamp}});
 const {db,env}=database();db.exec("CREATE TABLE school_selections(scope_id TEXT PRIMARY KEY,schools TEXT);CREATE TABLE school_bindings(scope_id TEXT,school TEXT);INSERT INTO school_bindings VALUES('guild:guild','sps')");env.DB.prepare=(sql)=>({bind(...args){return {async first(){return db.prepare(sql).get(...args)},async all(){return {results:db.prepare(sql).all(...args)}}}}}); const tasks=[];const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({id:'1'});
 try {
 const response=await worker.fetch(request,{...env,DISCORD_PUBLIC_KEY:pub,DISCORD_GUILD_ID:'guild',DISCORD_APPLICATION_ID:'app'},{waitUntil(p){tasks.push(p)}});
 assert.deepEqual(await response.json(),{type:5,data:{flags:64}});
 await Promise.all(tasks);
 assert.ok((await recentVoteMessages(env,'2026-10-06'))[0].content.includes('No votes'));
 }finally{globalThis.fetch=original;db.close();}
});
test('vote history is isolated between each server and personal DM; legacy unscoped votes are not exposed',async()=>{
 const {db,env}=database();
 for(const [scope,user,value] of [['guild:a','123',1],['guild:b','456',2],['user:123','123',-1],['user:456','456',1]])db.prepare('INSERT INTO vote_scope_states(scope_id,school,dish,serving_date,user_id,value) VALUES(?,?,?,?,?,?)').run(scope,'sps','chicken','2026-10-07',user,value);
 const get=async(scope)=>(await recentVoteMessages({...env,VOTE_SCOPE:scope},'2026-10-07')).map(m=>m.content).join('\n');
 assert.match(await get('guild:a'),/123.*Like/);assert.doesNotMatch(await get('guild:a'),/456|Dislike/);
 assert.match(await get('guild:b'),/456.*fine/);assert.doesNotMatch(await get('guild:b'),/123/);
 assert.match(await get('user:123'),/123.*Dislike/);assert.doesNotMatch(await get('user:123'),/456|👍 Like/);
 assert.match(await get('user:456'),/456.*Like/);assert.match(await get('unscoped'),/No votes/);db.close();
});

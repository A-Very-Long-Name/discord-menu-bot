import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.mjs';
function database(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));const env={DISCORD_APPLICATION_ID:'app',DISCORD_BOT_TOKEN:'test',DB:{prepare(sql){return {async all(){return {results:db.prepare(sql).all()}},bind(...args){return {async first(){return db.prepare(sql).get(...args)},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return db.prepare(sql).run(...args)}}}}}}};return {db,env};}
test('/food displays each followed school with its own scoped rating buttons',async()=>{
 const {db,env}=database();db.exec("INSERT INTO school_bindings VALUES('guild:a','sps','channel',420,900,1);INSERT INTO school_selections VALUES('guild:a','[\"loomis\",\"sps\"]')");
 const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);env.DISCORD_PUBLIC_KEY=Buffer.from(await crypto.subtle.exportKey('raw',keys.publicKey)).toString('hex');
 const NativeDate=Date;class Clock extends NativeDate{constructor(...a){super(...(a.length?a:['2026-10-07T15:00:00Z']))}static now(){return new NativeDate('2026-10-07T15:00:00Z').getTime()}}
 const calls=[],originalFetch=globalThis.fetch;globalThis.Date=Clock;
 const body=JSON.stringify({type:2,guild_id:'a',application_id:'app',authorizing_integration_owners:{0:'a'},member:{user:{id:'123'},permissions:'0'},token:'test',data:{name:'food',options:[{name:'meal',value:'lunch'},{name:'date',value:'10/07'}]}});
 const stamp=String(Date.now()/1000),sig=Buffer.from(await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(stamp+body))).toString('hex');
 globalThis.fetch=async(url,options)=>{
  if(url.includes('flikisdining')){const f=JSON.parse(readFileSync(new URL(url.includes('loomischaffee')?'./loomis-lunch.json':'./dinner-2026-09-09.json',import.meta.url)));f.days[0].date='2026-10-07';return Response.json(f);}
  calls.push(JSON.parse(options.body));return Response.json({id:'message'});
 };
 const tasks=[];
 try{const res=await worker.fetch(new Request('https://bot.example/interactions',{method:'POST',body,headers:{'x-signature-ed25519':sig,'x-signature-timestamp':stamp}}),env,{waitUntil(p){tasks.push(p)}});assert.deepEqual(await res.json(),{type:5});await Promise.all(tasks);
 assert.equal(calls.length,2);assert.ok(calls[0].embeds[0].title.includes('Loomis'));assert.ok(calls[1].embeds[0].title.includes('Coit'));assert.ok(calls.every(c=>c.components.length>0));
 }finally{globalThis.Date=NativeDate;globalThis.fetch=originalFetch;db.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
test('registration replaces setup with setting and global/personal leaderboard modes, removing stale setup commands',async()=>{
 const original=globalThis.fetch,keys=['DISCORD_APPLICATION_ID','DISCORD_BOT_TOKEN','DISCORD_GUILD_ID'];const saved=keys.map(k=>process.env[k]);const calls=[];
 for(const k of keys)process.env[k]='test';
 globalThis.fetch=async(url,options)=>{
  calls.push({url,method:options.method,body:options.body?JSON.parse(options.body):null});
  if(options.method==='GET')return Response.json([{id:'old-setup',name:'setup',type:1},{id:'keep',name:'unrelated',type:1}]);
  if(options.method==='DELETE')return new Response(null,{status:204});return Response.json({});
 };
 try{
  await import('../scripts/register.mjs');
  const commands=calls.filter(c=>c.method==='POST').map(c=>c.body);
  assert.ok(commands.some(c=>c.name==='setting'));assert.ok(!commands.some(c=>c.name==='setup'));
  assert.deepEqual(commands.find(c=>c.name==='leaderboard').options.map(o=>o.name),['global','personal']);
  const deletes=calls.filter(c=>c.method==='DELETE');assert.equal(deletes.length,2);assert.ok(deletes.every(c=>c.url.endsWith('/old-setup')));
 }finally{globalThis.fetch=original;keys.forEach((k,n)=>saved[n]===undefined?delete process.env[k]:process.env[k]=saved[n]);}
});

import {readFileSync} from 'node:fs';
import {refreshRatings} from '../src/ratings.mjs';
const snapshot=JSON.parse(readFileSync('/tmp/sps-rating-refresh.json','utf8'));
const dishes=snapshot[0].results,counts=snapshot[1].results;
const env={DB:{prepare(sql){return {bind(key,school){return {async first(){return dishes.find(x=>x.id===key)},async all(){return {results:counts.filter(x=>x.dish===key && (x.school || 'sps') === (school || 'sps'))}}}}}}}};
const channel=process.env.DISCORD_CHANNEL_ID;
if(!channel || !process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_APPLICATION_ID) throw new Error('Set DISCORD_CHANNEL_ID, DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN.');
async function request(path,method='GET',body) {
 for(let attempt=0;attempt<5;attempt++) {
 const r=await fetch('https://discord.com/api/v10'+path,{method,headers:{Authorization:`Bot ${process.env.DISCORD_BOT_TOKEN}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 if(r.status===429){const data=await r.json();await new Promise(resolve=>setTimeout(resolve,Math.min(30000,Math.ceil(data.retry_after*1000)+100)));continue;}
 if(!r.ok)throw new Error(`Discord HTTP ${r.status}`);
 return r.json();
 }throw new Error('Discord rate limit retry exhausted');
}
let before,scanned=0,updated=0;
while(true){
 const messages=await request(`/channels/${channel}/messages?limit=100${before?'&before='+before:''}`);
 if(!messages.length)break;
 for(const message of messages){
 scanned++;
 if(message.author?.id!==process.env.DISCORD_APPLICATION_ID||!message.components?.some(row=>row.components?.some(button=>/^rate:/.test(button.custom_id||''))))continue;
 const result=await request(`/channels/${channel}/messages/${message.id}`,'PATCH',await refreshRatings(env,message));
 if(!result.components.every(row=>row.components.some(button=>button.custom_id?.endsWith(':2'))))throw new Error('Historical button verification failed');
 updated++;
 }
 before=messages.at(-1).id;
}
console.log(JSON.stringify({scanned,updated}));

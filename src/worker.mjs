import {allSchoolMenus,combineSchoolMenus} from './foodforall.mjs';
import {loadWra,refreshWra} from './wra.mjs';
import {lunchReminderAllowed} from './schools.mjs';
import {school} from './schools.mjs';
import {bindingFor,configure} from './setup.mjs';
import {ratedPayload, vote, refreshRatings} from './ratings.mjs';
import {recentVoteMessages} from './votes.mjs';
import {MEALS, localTime, scheduledMeal, queryDate, defaultQueryMeal, defaultQueryDate, greeting, loadMenu, payload} from './menu.mjs';
const API = 'https://discord.com/api/v10';
const json = value => Response.json(value);
const reply = content => json({type: 4, data: {content, flags: 64, allowed_mentions: {parse: []}}});
function hex(s) { return Uint8Array.from(s.match(/.{2}/g), x => parseInt(x, 16)); }
export async function verify(request, body, publicKey) {
  const sig = request.headers.get('x-signature-ed25519') || '';
  const stamp = request.headers.get('x-signature-timestamp') || '';
  if (!/^[a-f0-9]{128}$/i.test(sig) || !/^[a-f0-9]{64}$/i.test(publicKey || '') || !/^\d+$/.test(stamp)) return false;
  if (Math.abs(Date.now()/1000 - Number(stamp)) > 300) return false;
  try {
    const key = await crypto.subtle.importKey('raw', hex(publicKey), {name: 'Ed25519'}, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, hex(sig), new TextEncoder().encode(stamp + body));
  } catch { return false; }
}
async function discord(path, method, body, token) {
  let requestBody=body===undefined?undefined:JSON.stringify(body),multipart=false;
  if(body?.fullText){const {fullText,...data}=body;data.attachments=[{id:0,filename:'school-menus.txt'}];requestBody=new FormData();requestBody.append('payload_json',JSON.stringify(data));requestBody.append('files[0]',new Blob([fullText],{type:'text/plain;charset=utf-8'}),'school-menus.txt');multipart=true;}
  for(let attempt=0;attempt<4;attempt++){
    const r = await fetch(API + path, {method, signal: AbortSignal.timeout(8000),
      headers: {...(multipart?{}:{'Content-Type':'application/json'}), ...(token ? {Authorization: `Bot ${token}`} : {})}, body: requestBody});
    // Retry only explicit rate limits; do not retry uncertain message submissions.
    if(r.status===429&&attempt<3){
      const limit=await r.json();const seconds=Number(limit.retry_after);
      if(!Number.isFinite(seconds)||seconds<0||seconds>10)throw new Error('Discord rate limit unavailable');
      await new Promise(resolve=>setTimeout(resolve,Math.ceil(seconds*1000)+100));continue;
    }
    // Do not log interaction URLs: they contain tokens.
    if (!r.ok) throw new Error(`Discord HTTP ${r.status}`);
    return r.status === 204 ? null : r.json();
  }
}
async function answer(i, meal, date, env) {
  let data,menu;
  try { menu=env.SCHOOL_ID==='wra'?await loadWra(env,meal,date):await loadMenu(meal,date,fetch,env.SCHOOL_ID || 'sps'); data = await ratedPayload(env,menu); }
  catch { data = payload({meal, date, school:env.SCHOOL_ID || 'sps', available: false, groups: []}, true); }
  try { const message=await discord(`/webhooks/${i.application_id}/${i.token}/messages/@original`, 'PATCH', data); }
  catch { console.error('Failed to deliver menu command response'); }
}
export async function answerAllSchools(i,meal,date,env){
 try{
  const messages=await allSchoolMenus(env,meal,date);
  await discord(`/webhooks/${i.application_id}/${i.token}/messages/@original`,'PATCH',combineSchoolMenus(messages,meal,date));
 }catch{
  console.error('All-school menu response failed');
  try{await discord(`/webhooks/${i.application_id}/${i.token}`,'POST',{content:'Some school menus could not be delivered. Please try again.',allowed_mentions:{parse:[]}});}catch{}
 }
}
export async function answerVotes(i, env, today = null) {
  try {
    const messages = await recentVoteMessages(env, today || localTime(new Date(),school(env.SCHOOL_ID).zone).date);
    for (const [index,data] of messages.entries()) {
      await discord(`/webhooks/${i.application_id}/${i.token}${index === 0 ? '/messages/@original' : ''}`,
        index === 0 ? 'PATCH' : 'POST', {...data,flags:64});
    }
  } catch {
    console.error('Failed to deliver vote history');
    try { await discord(`/webhooks/${i.application_id}/${i.token}/messages/@original`,'PATCH',
      {content:'Vote history is unavailable. Please try again.',flags:64,allowed_mentions:{parse:[]}}); } catch {}
  }
}
export async function sendScheduled(env, now = new Date()) {
  const local=localTime(now,school(env.SCHOOL_ID).zone);
  const config=env.BINDING;
  const due=config ? (env.MEAL_FORCE !== 'dinner' && lunchReminderAllowed(env.SCHOOL_ID||'sps',local.weekday) && local.minutes >= config.lunch_min && local.minutes < config.lunch_min+30 ? {...local,meal:'lunch',age:local.minutes-config.lunch_min} : env.MEAL_FORCE !== 'lunch' && local.minutes >= config.dinner_min && local.minutes < config.dinner_min+30 ? {...local,meal:'dinner',age:local.minutes-config.dinner_min} : null) : scheduledMeal(now);
  if (!due) return;
  const key = `${env.DISCORD_CHANNEL_ID}:${due.date}:${due.meal}${env.SCHOOL_ID && env.SCHOOL_ID !== 'sps' ? ':'+env.SCHOOL_ID : ''}`;
  const stamp = Date.now();
  const claim = await env.DB.prepare(`INSERT INTO deliveries (delivery_key,status,lease_until)
    VALUES (?,'pending',?) ON CONFLICT(delivery_key) DO UPDATE SET lease_until=excluded.lease_until
    WHERE deliveries.status='pending' AND deliveries.lease_until < ? RETURNING delivery_key`)
    .bind(key, stamp + 120000, stamp).first();
  if (!claim) return;
  try {
    let menu, failure = false;
    try { menu = env.SCHOOL_ID==='wra' ? await loadWra(env,due.meal,due.date,env.MENU_FETCHER||fetch) : await loadMenu(due.meal, due.date,env.MENU_FETCHER || fetch,env.SCHOOL_ID || 'sps'); }
    catch { failure = true; menu = {meal: due.meal, date: due.date, school:env.SCHOOL_ID || 'sps', available: false, groups: []}; }
    if(due.meal==='lunch'&&menu.brunch){await env.DB.prepare("UPDATE deliveries SET status='sent' WHERE delivery_key=?").bind(key).run();return;}
    // Retry empty/unavailable menus for 25 minutes before posting one explanatory notice.
    if (!menu.available && !menu.closed && due.age < 25) {
      await env.DB.prepare('UPDATE deliveries SET lease_until=0 WHERE delivery_key=?').bind(key).run();
      console.warn(`Menu not ready: ${due.date} ${due.meal}`); return;
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const nonce = Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2,'0')).join('').slice(0,24);
    const message = await discord(`/channels/${env.DISCORD_CHANNEL_ID}/messages`, 'POST',
      {...await ratedPayload(env,menu,failure), content: greeting(due.meal), nonce, enforce_nonce: true}, env.DISCORD_BOT_TOKEN);
    await env.DB.prepare("UPDATE deliveries SET status='sent', message_id=? WHERE delivery_key=?")
      .bind(message.id, key).run();
    console.log(`Sent ${due.date} ${due.meal}`);
  } catch {
    // Retain the short lease on uncertain sends; Discord nonce reduces retry duplicates.
    console.error(`Scheduled delivery failed: ${due.date} ${due.meal}`);
    throw new Error('Scheduled delivery failed');
  }
}
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'GET') return new Response('SPS Menu Bot is running.');
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/interactions') return new Response('Not found', {status:404});
    const body = await request.text();
    if (!await verify(request, body, env.DISCORD_PUBLIC_KEY)) return new Response('Invalid signature', {status:401});
    let i; try { i = JSON.parse(body); } catch { return new Response('Bad JSON', {status:400}); }
    if (i.type === 1) return json({type:1});
    if (i.application_id !== env.DISCORD_APPLICATION_ID) return reply('This bot is configured for another server.');
    if(i.type===3) {
      ctx.waitUntil((async()=>{
        try {
          const result=await vote(env,i);
          if(result.startsWith('Rating saved:')||result.startsWith('Rating removed.')) {
            await discord(`/webhooks/${i.application_id}/${i.token}/messages/@original`,'PATCH',await refreshRatings(env,i.message));
          }
        } catch {console.error('Rating save or display update failed');}
      })());
      // Acknowledge the button silently and update its original message.
      return json({type:6});
    }
    if(i.type === 2 && i.data?.name === 'setup') {
      ctx.waitUntil((async()=>{
        let content;try{content=await configure(env,i,discord)}catch{content='Settings could not be saved. Please try again.'}
        try{await discord(`/webhooks/${i.application_id}/${i.token}/messages/@original`,'PATCH',{content,allowed_mentions:{parse:[]}})}catch{console.error('Setup response failed')}
      })());
      return json({type:5,data:{flags:64}});
    }
    if(i.type === 2 && ['food','foodforall'].includes(i.data?.name) && (i.data.options||[]).some(o=>o.name==='meal' && ['breakfast','brunch'].includes(o.value))) return json({type:4,data:{content:"bro they're literally the same thing every time, currently not supported",allowed_mentions:{parse:[]}}});
    if(i.type === 2 && ['food','votes'].includes(i.data?.name)) {
      const binding=await bindingFor(env,i);
      if(!binding)return reply('Welcome! Run /setup to choose your school, reminder times, and personal or server use.');
      env={...env,SCHOOL_ID:binding.school,PERSONAL_MODE:binding.scope_id?.startsWith('user:')};
    }
    if (i.type === 2 && i.data?.name === 'votes') {
      const user=i.member?.user||i.user;
      ctx.waitUntil(answerVotes(i,{...env,VOTE_SCOPE:i.guild_id?`guild:${i.guild_id}`:`user:${user.id}`}));
      return json({type:5,data:{flags:64}});
    }
    if (i.type !== 2 || !['food','foodforall'].includes(i.data?.name)) return reply('Unknown command.');
    const options = Object.fromEntries((i.data.options || []).map(x => [x.name,x.value]));
    const local = localTime(new Date(),school(env.SCHOOL_ID).zone);
    const meal = options.meal || defaultQueryMeal(local.minutes);
    if (meal === 'breakfast' || meal === 'brunch') return json({type:4, data:{content:"bro they're literally the same thing every time, currently not supported", allowed_mentions:{parse:[]}}});
    const date = queryDate(options.date, options.date ? local.date : defaultQueryDate(local,meal));
    if (!MEALS.includes(meal) || !date) return reply('Use breakfast, brunch, lunch or dinner; date must be MM/DD (current year).');
    if (Math.abs(Date.parse(date) - Date.parse(local.date)) > 31*86400000) return reply('Please select a date within 31 days of today.');
    ctx.waitUntil(i.data.name==='foodforall'?answerAllSchools(i,meal,date,env):answer(i, meal, date, env));
    return json({type:5});
  },
  async scheduled(event, env) {
    // Actual execution time avoids sending stale meal notifications after a long outage.
    const {results}=await env.DB.prepare('SELECT * FROM school_bindings WHERE enabled=1 AND channel_id IS NOT NULL').all();
    const cache=new Map();
    const menuFetcher=async(url,options)=>{
      if(!cache.has(url))cache.set(url,fetch(url,options).catch(error=>{cache.delete(url);throw error}));
      return (await cache.get(url)).clone();
    };
    const now=new Date();
    try{await refreshWra(env,now,localTime(now));}catch{console.error('WRA weekly refresh unavailable');}
    for(const binding of results)for(const meal of ['lunch','dinner']) {
      try{await sendScheduled({...env,SCHOOL_ID:binding.school,DISCORD_CHANNEL_ID:binding.channel_id,BINDING:binding,PERSONAL_MODE:binding.scope_id.startsWith('user:'),MEAL_FORCE:meal,MENU_FETCHER:menuFetcher},now)}catch{console.error('Reminder delivery failed')}
    }
  }
};

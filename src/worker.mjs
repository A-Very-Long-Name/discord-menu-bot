import {selectedSchools} from './selections.mjs';
import {schoolPage} from './foodforall.mjs';
import {settingDashboard,changeSetting,timesModal,defaultScope,actorId,schoolIds} from './dashboard.mjs';
import {leaderboard} from './leaderboard.mjs';
import {loadWra,refreshWra} from './wra.mjs';
import {lunchReminderAllowed} from './schools.mjs';
import {school} from './schools.mjs';
import {bindingFor} from './setup.mjs';
import {ratedPayload, vote, refreshRatings} from './ratings.mjs';
import {recentVoteMessages} from './votes.mjs';
import {MEALS, localTime, scheduledMeal, queryDate, defaultQueryMeal, defaultQueryDate, greeting, loadMenu, payload} from './menu.mjs';
const API = 'https://discord.com/api/v10';
const json = value => Response.json(value);
const reply = content => json({type: 4, data: {content, allowed_mentions: {parse: []}}});
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
  await discord(`/webhooks/${i.application_id}/${i.token}/messages/@original`,'PATCH',await schoolPage(env,meal,date,actorId(i)));
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
        index === 0 ? 'PATCH' : 'POST', data);
    }
  } catch {
    console.error('Failed to deliver vote history');
    try { await discord(`/webhooks/${i.application_id}/${i.token}/messages/@original`,'PATCH',
      {content:'Vote history is unavailable. Please try again.',allowed_mentions:{parse:[]}}); } catch {}
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
const scopeSchemaReady=new WeakMap();
async function ensureScopeSchema(env){
 if(!env.DB?.exec)return;
 if(!scopeSchemaReady.has(env.DB)){const pending=env.DB.exec('CREATE TABLE IF NOT EXISTS vote_scope_states(scope_id TEXT NOT NULL,school TEXT NOT NULL,dish TEXT NOT NULL,serving_date TEXT NOT NULL,user_id TEXT NOT NULL,value INTEGER NOT NULL CHECK(value IN(-1,0,1,2)),PRIMARY KEY(scope_id,school,dish,serving_date,user_id));CREATE TABLE IF NOT EXISTS school_selections(scope_id TEXT PRIMARY KEY,schools TEXT NOT NULL);').catch(error=>{scopeSchemaReady.delete(env.DB);throw error});scopeSchemaReady.set(env.DB,pending);}
 await scopeSchemaReady.get(env.DB);
}
// Acknowledge slow work before menu requests or database updates.
export function interactiveResponse(i,env,ctx,api=discord){
 const actor=actorId(i);
 const command=i.type===2?i.data?.name:null;
 const id=i.data?.custom_id||'';
 const parts=id.split(':');
 const isComponent=[3,5].includes(i.type)&&['setting','browse','board'].includes(parts[0]);
 if(!isComponent&&!['setting','leaderboard'].includes(command))return null;
 const settings=command==='setting'||parts[0]==='setting';
 const visibility=settings?{flags:64}:{};
 const privateReply=content=>({type:4,data:{content,...visibility,allowed_mentions:{parse:[]}}});
 if(!actor)return privateReply('User unavailable.');
 if(isComponent){
  if(parts[1]!==actor)return privateReply('Open your own /setting, /foodforall or /leaderboard to use these controls.');
  if(i.type===3&&(i.message?.author?.id!==env.DISCORD_APPLICATION_ID||!i.message.components?.some(r=>r.components?.some(c=>c.custom_id===id))))return privateReply('This control is unavailable. Run the command again.');
  if(i.type===5&&(parts[0]!=='setting'||parts[3]!=='save-times'))return privateReply('This form is unavailable. Run /setting again.');
  if(parts[0]==='setting'&&parts[3]==='times'){
   try{return timesModal(i,parts[2]);}catch(error){return privateReply(error.message);}
  }
 }
 const update=isComponent&&(i.type===3||Boolean(i.message));
 ctx.waitUntil((async()=>{
  let data;
  try{
   if(command==='setting')data=await settingDashboard(env,i,i.data.options?.find(o=>o.name==='scope')?.value||defaultScope(i));
   else if(command==='leaderboard'){
    const option=i.data.options?.[0];const mode=option?.name||'global';
    if(mode==='global'&&!i.guild_id)throw Error('Choose /leaderboard personal in DMs. Global rankings require a server.');
    data=await leaderboard(env,option?.options?.find(o=>o.name==='type')?.value||'dishes',actor,0,mode);
   }
   else if(parts[0]==='setting')data=await changeSetting(env,i,parts[2],parts[3],api);
   else if(parts[0]==='browse'){
    const page=parts[4]==='select'?i.data.values?.[0]:parts[4];
    if(!/^\d+$/.test(page||'')||Number(page)>=schoolIds.length)throw Error('Invalid menu page. Run /foodforall again.');
    data=await schoolPage(env,parts[2],parts[3],actor,Number(page));
   }else{
    if(!/^\d+$/.test(parts[3]||''))throw Error('Invalid leaderboard page.');
    data=await leaderboard(env,parts[2],actor,Number(parts[3]),parts[4]==='personal'?'personal':'global');
   }
  }catch(error){
   console.error('Interactive command failed');
   // Expected validation errors are safe text; never expose database or API internals.
   const known=/^(Choose |Manage Server|Install the app|User unavailable|Invalid |Unknown settings)/.test(error.message||'');
   const content=known?error.message:'Could not load or save this view. Please run the command again.';
   if(update){try{await api(`/webhooks/${i.application_id}/${i.token}`,'POST',{content,...visibility,allowed_mentions:{parse:[]}});}catch{}return;}
   data={content,embeds:[],components:[],allowed_mentions:{parse:[]}};
  }
  try{await api(`/webhooks/${i.application_id}/${i.token}/messages/@original`,'PATCH',data);}catch{console.error('Interactive response delivery failed');}
 })());
 return update?{type:6}:settings?{type:5,data:{flags:64}}:{type:5};
}
export default {
  async fetch(request, env, ctx) {
    await ensureScopeSchema(env);
    if (request.method === 'GET') return new Response('SPS Menu Bot is running.');
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/interactions') return new Response('Not found', {status:404});
    const body = await request.text();
    if (!await verify(request, body, env.DISCORD_PUBLIC_KEY)) return new Response('Invalid signature', {status:401});
    let i; try { i = JSON.parse(body); } catch { return new Response('Bad JSON', {status:400}); }
    if (i.type === 1) return json({type:1});
    if (i.application_id !== env.DISCORD_APPLICATION_ID) return reply('This bot is configured for another server.');
    const actor=i.member?.user||i.user;
    env={...env,VOTE_SCOPE:i.guild_id?`guild:${i.guild_id}`:actor?.id?`user:${actor.id}`:'unscoped'};
    const interactive=interactiveResponse(i,env,ctx);
    if(interactive)return json(interactive);
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
    if(i.type === 2 && ['food','foodforall'].includes(i.data?.name) && (i.data.options||[]).some(o=>o.name==='meal' && ['breakfast','brunch'].includes(o.value))) return json({type:4,data:{content:"bro they're literally the same thing every time, currently not supported",allowed_mentions:{parse:[]}}});
    if(i.type === 2 && ['food','votes'].includes(i.data?.name)) {
      const binding=await bindingFor(env,i);
      if(!binding)return reply('Welcome! Run /setting to choose your school, reminder times, and personal or server use.');
      env={...env,SCHOOL_ID:binding.school,PERSONAL_MODE:binding.scope_id?.startsWith('user:')};
    }
    if (i.type === 2 && i.data?.name === 'votes') {
      const user=i.member?.user||i.user;
      ctx.waitUntil(answerVotes(i,{...env,VOTE_SCOPE:i.guild_id?`guild:${i.guild_id}`:`user:${user.id}`}));
      return json({type:5});
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
    await ensureScopeSchema(env);
    // Actual execution time avoids sending stale meal notifications after a long outage.
    const {results}=await env.DB.prepare('SELECT * FROM school_bindings WHERE enabled=1 AND channel_id IS NOT NULL').all();
    const cache=new Map();
    const menuFetcher=async(url,options)=>{
      if(!cache.has(url))cache.set(url,fetch(url,options).catch(error=>{cache.delete(url);throw error}));
      return (await cache.get(url)).clone();
    };
    const now=new Date();
    try{await refreshWra(env,now,localTime(now));}catch{console.error('WRA weekly refresh unavailable');}
    for(const binding of results)for(const schoolId of await selectedSchools(env,binding))for(const meal of ['lunch','dinner']) {
      try{await sendScheduled({...env,SCHOOL_ID:schoolId,VOTE_SCOPE:binding.scope_id,DISCORD_CHANNEL_ID:binding.channel_id,BINDING:binding,PERSONAL_MODE:binding.scope_id.startsWith('user:'),MEAL_FORCE:meal,MENU_FETCHER:menuFetcher},now)}catch{console.error('Reminder delivery failed')}
    }
  }
};

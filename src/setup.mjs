import {SCHOOLS,school} from './schools.mjs';
export const optionsOf=i=>Object.fromEntries((i.data?.options||[]).map(x=>[x.name,x.value]));
export function parseTime(text,fallback){if(text===undefined)return fallback;if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(text))return null;return Number(text.slice(0,2))*60+Number(text.slice(3));}
export function setupTarget(i,scope){
 const user=i.member?.user||i.user;
 if(!user?.id)throw new Error('User unavailable.');
 if(scope==='server'){
  if(!i.guild_id || !Object.hasOwn(i.authorizing_integration_owners||{},'0'))throw new Error('Install the app to this server before configuring server reminders.');
  if(!(BigInt(i.member?.permissions||'0') & (8n|32n)))throw new Error('Manage Server permission is required to change server settings.');
  return `guild:${i.guild_id}`;
 }
 return `user:${user.id}`;
}
export async function bindingFor(env,i){
 const user=i.member?.user||i.user;
 const guildInstalled=Object.hasOwn(i.authorizing_integration_owners||{},'0') || i.guild_id===env.DISCORD_GUILD_ID;
 if(i.guild_id && guildInstalled){
  const value=await env.DB.prepare('SELECT * FROM school_bindings WHERE scope_id=?').bind(`guild:${i.guild_id}`).first();
  if(value)return value;
 }
 if(user?.id)return env.DB.prepare('SELECT * FROM school_bindings WHERE scope_id=?').bind(`user:${user.id}`).first();
 return null;
}
export async function configure(env,i,discord){
 const opts=optionsOf(i);
 if(!SCHOOLS[opts.school])return 'Choose a supported school.';
 const scope=opts.scope|| (i.guild_id && Object.hasOwn(i.authorizing_integration_owners||{},'0') ? 'server' : 'personal');
 let target;try{target=setupTarget(i,scope)}catch(error){return error.message}
 const prior=await env.DB.prepare('SELECT * FROM school_bindings WHERE scope_id=?').bind(target).first();
 const lunch=parseTime(opts.lunch_notification,prior?.lunch_min??420),dinner=parseTime(opts.dinner_notification,prior?.dinner_min??900);
 if(lunch===null||dinner===null)return 'Use HH:mm in 24-hour format, for example 07:00 and 15:00. Times use your school’s local timezone.';
 const enabled=opts.reminders??Boolean(prior?.enabled??true);
 let channel=prior?.channel_id,warning='';
 if(scope==='server'){
  channel=opts.channel||channel||i.channel_id;
  try {
   const details=await discord(`/channels/${channel}`,'GET',undefined,env.DISCORD_BOT_TOKEN);
   if(details.guild_id!==i.guild_id||![0,5].includes(details.type))return 'Choose a text channel in this server.';
  }catch{return 'The bot cannot access that channel. Check its View Channel, Send Messages and Embed Links permissions.'}
 } else if(enabled){
  try {
   const user=i.member?.user||i.user;
   const dm=await discord('/users/@me/channels','POST',{recipient_id:user.id},env.DISCORD_BOT_TOKEN);
   channel=dm.id;
   await discord(`/channels/${channel}/messages`,'POST',{content:`Reminders enabled for ${SCHOOLS[opts.school].name}. You can change times or turn them off with /setup.`,allowed_mentions:{parse:[]}},env.DISCORD_BOT_TOKEN);
  }catch{channel=null;warning='\nDiscord blocked the DM. Your school is saved, but reminders are off. Open a DM with the bot and allow direct messages, then run /setup again.'}
 }
 await env.DB.prepare(`INSERT INTO school_bindings(scope_id,school,channel_id,lunch_min,dinner_min,enabled) VALUES(?,?,?,?,?,?) ON CONFLICT(scope_id) DO UPDATE SET school=excluded.school,channel_id=excluded.channel_id,lunch_min=excluded.lunch_min,dinner_min=excluded.dinner_min,enabled=excluded.enabled`).bind(target,opts.school,channel||null,lunch,dinner,enabled&&channel?1:0).run();
 const time=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
 return `${SCHOOLS[opts.school].name} saved for ${scope==='server'?'this server':'you'}.\nLunch notification: ${time(lunch)} (Mon–Sat). Dinner notification: ${time(dinner)} (daily).\nTimezone: ${school(opts.school).zone}. Reminders: ${enabled&&channel?'on':'off'}.${warning}`;
}

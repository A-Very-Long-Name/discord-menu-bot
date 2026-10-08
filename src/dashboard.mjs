import {SCHOOLS,school} from './schools.mjs';
import {configure,setupTarget} from './setup.mjs';
export const schoolIds=Object.keys(SCHOOLS).sort((a,b)=>school(a).name.replace(/^The /,'').localeCompare(school(b).name.replace(/^The /,''),'en'));
export const row=(...components)=>({type:1,components});
export const button=(label,custom_id,disabled=false)=>({type:2,style:2,label,custom_id,disabled});
export const actorId=i=>(i.member?.user||i.user)?.id;
const time=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export function defaultScope(i){return i.guild_id&&Object.hasOwn(i.authorizing_integration_owners||{},'0')?'server':'personal';}
export async function settingDashboard(env,i,scope,notice=''){
 if(!['personal','server'].includes(scope))throw Error('Choose Personal or Server.');
 const target=setupTarget(i,scope);
 const saved=await env.DB.prepare('SELECT * FROM school_bindings WHERE scope_id=?').bind(target).first();
 const prefix=`setting:${actorId(i)}:${scope}:`;
 const components=[row({type:3,custom_id:prefix+'scope',placeholder:'Settings scope',options:[{label:'Personal',value:'personal',default:scope==='personal'},...(i.guild_id?[{label:'Server',value:'server',default:scope==='server'}]:[])]}),
 row({type:3,custom_id:prefix+'school',placeholder:'Choose your school',options:schoolIds.map(id=>({label:school(id).name,value:id,default:saved?.school===id}))}),
 row(button(saved?.enabled?'Turn reminders off':'Turn reminders on',prefix+(saved?.enabled?'off':'on'),!saved),button('Change times',prefix+'times',!saved),button('Refresh',prefix+'refresh'))];
 if(scope==='server')components.push(row({type:8,custom_id:prefix+'channel',placeholder:'Choose reminder channel',channel_types:[0,5],...(saved?.channel_id?{default_values:[{id:saved.channel_id,type:'channel'}]}:{})}));
 return {content:notice.slice(0,1800),allowed_mentions:{parse:[]},embeds:[{title:scope==='server'?'Server settings':'Your settings',color:0x244b3b,description:saved?`School: **${school(saved.school).name}**\nReminders: **${saved.enabled?'On':'Off'}**\nLunch: **${time(saved.lunch_min)}** (${school(saved.school).brunchDays?.includes('Sat')?'Mon–Fri':'Mon–Sat'})\nDinner: **${time(saved.dinner_min)}** (daily)\nTimezone: **${school(saved.school).zone}**\nDelivery: ${scope==='personal'?'Personal DM':saved.channel_id?`<#${saved.channel_id}>`:'Choose a channel'}\n\nChanges save immediately.`:'Choose a school to begin. Then enable reminders and choose notification times.'}],components};
}
export function timesModal(i,scope){
 setupTarget(i,scope);
 return {type:9,data:{custom_id:`setting:${actorId(i)}:${scope}:save-times`,title:'Notification times',components:['lunch','dinner'].map(meal=>({type:18,label:`${meal==='lunch'?'Lunch':'Dinner'} time (school timezone)`,component:{type:4,custom_id:meal,style:1,required:false,max_length:5,placeholder:'HH:mm — blank keeps current time'}}))}};
}
export async function changeSetting(env,i,scope,action,discord){
 if(!['personal','server'].includes(scope))throw Error('Choose Personal or Server.');
 const target=setupTarget(i,scope); // Recheck permissions on every interaction, including modal submissions.
 if(action==='scope')return settingDashboard(env,i,i.data.values?.[0]);
 if(action==='refresh')return settingDashboard(env,i,scope);
 const prior=await env.DB.prepare('SELECT * FROM school_bindings WHERE scope_id=?').bind(target).first();
 if(!prior&&action!=='school')return settingDashboard(env,i,scope,'Choose a school first.');
 const opts={scope,school:prior?.school,reminders:Boolean(prior?.enabled)};
 if(action==='school')opts.school=i.data.values?.[0];
 else if(action==='channel')opts.channel=i.data.values?.[0];
 else if(action==='on'||action==='off')opts.reminders=action==='on';
 else if(action==='save-times'){
  const values=Object.fromEntries((i.data.components||[]).flatMap(r=>r.component?[r.component]:r.components||[]).map(c=>[c.custom_id,c.value]));
  if(values.lunch?.trim())opts.lunch_notification=values.lunch.trim();
  if(values.dinner?.trim())opts.dinner_notification=values.dinner.trim();
 }else throw Error('Unknown settings action. Run /setting again.');
 const notice=await configure(env,{...i,data:{options:Object.entries(opts).map(([name,value])=>({name,value}))}},discord);
 return settingDashboard(env,i,scope,notice);
}

import {MEALS} from '../src/menu.mjs';
import {SCHOOLS} from '../src/schools.mjs';
const {DISCORD_APPLICATION_ID:app,DISCORD_GUILD_ID:guild,DISCORD_BOT_TOKEN:token}=process.env;
if(!app||!token)throw new Error('Missing application credentials.');
async function api(path,method,body){
 const r=await fetch('https://discord.com/api/v10'+path,{method,headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 if(!r.ok)throw new Error(`Discord HTTP ${r.status}`);return r.status===204?null:r.json();
}
const commands=[
 {name:'food',description:'View your school dining menu',options:[
  {type:3,name:'meal',description:'Meal (default: lunch before 2pm, dinner afterward)',choices:MEALS.map(value=>({name:value,value}))},
  {type:3,name:'date',description:'MM/DD (current year; default: today in school time)'}]},
 {name:'votes',description:"View votes for today's and previous two days' menus"},
 {name:'setup',description:'Choose your school and reminder settings',options:[
  {type:3,name:'school',description:'Your school',required:true,choices:Object.entries(SCHOOLS).sort(([,a],[,b])=>a.name.replace(/^The /,'').localeCompare(b.name.replace(/^The /,''),'en')).map(([value,s])=>({name:s.name,value}))},
  {type:3,name:'scope',description:'Personal settings or server settings (server requires Manage Server)',choices:[{name:'Personal',value:'personal'},{name:'Server',value:'server'}]},
  {type:3,name:'lunch_notification',description:'Lunch notification time HH:mm, 24-hour school local time (default 07:00)'},
  {type:3,name:'dinner_notification',description:'Dinner notification time HH:mm, 24-hour school local time (default 15:00)'},
  {type:7,name:'channel',description:'Server reminder channel (default: current channel)',channel_types:[0,5]},
  {type:5,name:'reminders',description:'Enable or disable scheduled reminders'}]}
];
// Enable both install modes without changing unrelated application settings.
await api('/applications/@me','PATCH',{integration_types_config:{
 '0':{oauth2_install_params:{scopes:['bot','applications.commands'],permissions:'84992'}},
 '1':{oauth2_install_params:{scopes:['applications.commands'],permissions:'0'}}
}});
for(const entry of commands)await api(`/applications/${app}/commands`,'POST',{...entry,type:1,default_member_permissions:null,integration_types:[0,1],contexts:[0,1,2]});
// Retire our guild duplicates only after all global commands are registered.
if(guild)for(const old of await api(`/applications/${app}/guilds/${guild}/commands`,'GET'))if(['menu','food','votes','setup'].includes(old.name)&&old.type===1)await api(`/applications/${app}/guilds/${guild}/commands/${old.id}`,'DELETE');
console.log('Registered global /food, /votes and /setup for personal and server installs.');

import {MEALS} from '../src/menu.mjs';
const {DISCORD_APPLICATION_ID:app,DISCORD_GUILD_ID:guild,DISCORD_BOT_TOKEN:token}=process.env;
if(!app||!token)throw new Error('Missing application credentials.');
async function api(path,method,body){
 const r=await fetch('https://discord.com/api/v10'+path,{method,headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 if(!r.ok)throw new Error(`Discord HTTP ${r.status}`);return r.status===204?null:r.json();
}
const commands=[
 {name:'setting',description:'Open your school and reminder dashboard'},
 {name:'leaderboard',description:'Rank dishes and schools by likes minus dislikes',options:['global','personal'].map(name=>({type:1,name,description:name==='global'?'Rank everyone’s votes in this server':'Rank your own votes in this server or DM',options:[{type:3,name:'type',description:'What to rank (default: dishes)',choices:[{name:'Dishes',value:'dishes'},{name:'Schools',value:'schools'}]}]}))},
 {name:'foodforall',description:'View every school’s menu and past ratings (no voting)',options:[
  {type:3,name:'meal',description:'Meal (default: lunch before 2pm/after 8pm Eastern; otherwise dinner)',choices:MEALS.map(value=>({name:value,value}))},
  {type:3,name:'date',description:'MM/DD (current year; default: next day after meal cutoff, Eastern time)'}]},
 {name:'food',description:'View your school dining menu',options:[
  {type:3,name:'meal',description:'Meal (default: lunch before 2pm/after 8pm; otherwise dinner)',choices:MEALS.map(value=>({name:value,value}))},
  {type:3,name:'date',description:'MM/DD (current year; default: next day after meal cutoff, school time)'}]},
 {name:'votes',description:"View votes for today's and previous two days' menus"},

];
// Enable both install modes without changing unrelated application settings.
await api('/applications/@me','PATCH',{integration_types_config:{
 '0':{oauth2_install_params:{scopes:['bot','applications.commands'],permissions:'84992'}},
 '1':{oauth2_install_params:{scopes:['applications.commands'],permissions:'0'}}
}});
for(const entry of commands)await api(`/applications/${app}/commands`,'POST',{...entry,type:1,default_member_permissions:null,integration_types:[0,1],contexts:[0,1,2]});
// Remove the retired global setup command after replacement commands are registered.
for(const old of await api(`/applications/${app}/commands`,'GET'))if(old.name==='setup'&&old.type===1)await api(`/applications/${app}/commands/${old.id}`,'DELETE');
// Retire our guild duplicates only after all global commands are registered.
if(guild)for(const old of await api(`/applications/${app}/guilds/${guild}/commands`,'GET'))if(['menu','food','votes','setup'].includes(old.name)&&old.type===1)await api(`/applications/${app}/guilds/${guild}/commands/${old.id}`,'DELETE');
console.log('Registered global /food, /foodforall, /votes, /setting and /leaderboard for personal and server installs.');

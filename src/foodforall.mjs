import {SCHOOLS,school} from './schools.mjs';
import {loadMenu,payload} from './menu.mjs';
import {loadWra} from './wra.mjs';
import {entrees,totals,summary} from './ratings.mjs';
export async function allSchoolMenus(env,meal,date,fetcher=fetch,loader=null){
 const schools=Object.keys(SCHOOLS).sort((a,b)=>school(a).name.replace(/^The /,'').localeCompare(school(b).name.replace(/^The /,''),'en'));
 const messages=[];
 // Two providers at a time keep external requests bounded. Every school gets its own card.
 for(let offset=0;offset<schools.length;offset+=2){
  const batch=await Promise.all(schools.slice(offset,offset+2).map(async id=>{
   let menu,failure=false;
   try{menu=loader?await loader(id,meal,date):id==='wra'?await loadWra(env,meal,date,fetcher):await loadMenu(meal,date,fetcher,id);}
   catch{failure=true;menu={meal,date,school:id,available:false,groups:[]};}
   menu={...menu,school:id};const card=payload(menu,failure);
   card.embeds[0].title=`${school(id).name} · ${meal[0].toUpperCase()+meal.slice(1)} · ${date.slice(5).replace('-','/')}`;
   const lines=[];
   for(const name of entrees(menu)){
    try{lines.push(`${name}: ${summary(await totals({...env,SCHOOL_ID:id},name))}`);}
    catch{lines.push(`${name}: Ratings unavailable`);}
   }
   const value=lines.length?lines.join('\n'):'No ratings to display.';
   card.embeds[0].fields=[{name:'Past ratings',value:value.length>1024?value.slice(0,980)+'\n… More entrée ratings are available with /food.':value}];
   // No rating registration, voting controls or writes are performed by this command.
   card.components=[];return card;
  }));messages.push(...batch);
 }
 return messages;
}
export function combineSchoolMenus(cards,meal,date){
 const title=`All schools · ${meal[0].toUpperCase()+meal.slice(1)} · ${date.slice(5).replace('-','/')}`;
 const footer='a bot by hydrogen_01';
 const names=cards.map(c=>c.embeds[0].title.split(' · ')[0]);
 const budget=Math.min(1024,Math.floor((5900-title.length-footer.length-names.reduce((n,x)=>n+x.length,0))/cards.length));
 let truncated=false;
 const full=[];
 const fields=cards.map((c,index)=>{
  const e=c.embeds[0];const ratings=e.fields?.map(f=>`**${f.name}**\n${f.value}`).join('\n')||'';
  full.push(`${names[index]}\n${e.description}\n${ratings}\n${e.url}`);
  const source=`[Original menu](${e.url})`;
  let value=`${e.description}\n\n${ratings}\n${source}`;
  if(value.length>budget){truncated=true;const note='\n… Full menu in attached file.\n';const room=budget-ratings.length-source.length-note.length-2;
   if(room>=50)value=e.description.slice(0,room)+note+ratings+'\n'+source;
   else value=value.slice(0,budget-note.length)+note;
  }
  return {name:names[index],value};
 });
 return {allowed_mentions:{parse:[]},components:[],embeds:[{title,fields,color:0x244b3b,footer:{text:footer}}],...(truncated?{fullText:`${title}\n\n${full.join('\n\n')}`}:{})};
}

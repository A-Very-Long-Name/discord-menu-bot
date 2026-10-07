import {payload} from './menu.mjs';
export const dishKey=name=>name.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export function entrees(menu) {return [...new Set(menu.groups.filter(g=>/^(main )?entree$/.test(g.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase())).flatMap(g=>g.items))];}
export async function totals(env,name) {
 const {results}=await env.DB.prepare('SELECT value,COUNT(*) AS n FROM entree_votes WHERE dish=? AND school=? GROUP BY value').bind(dishKey(name),env.SCHOOL_ID || 'sps').all();
 const up=Number(results.find(r=>r.value===1)?.n||0),down=Number(results.find(r=>r.value===-1)?.n||0);
 const fine=Number(results.find(r=>r.value===2)?.n||0);
 return {up,down,fine};
}
export function summary({up,down,fine=0}) {return up+down+fine?`👍 ${up} · 🤔 ${fine} · 👎 ${down} · ${Math.round(100*up/(up+down+fine))}% approval`:'No ratings yet';}
export function displaySummary(counts,personal=false){return personal ? (counts.up+counts.down+counts.fine ? 'Personal ratings\n'+summary(counts) : 'No personal ratings yet') : summary(counts);}
export async function history(env,name) {return summary(await totals(env,name));
}
export async function ratedPayload(env,menu,failure=false) {
 const p=payload(menu,failure); const names=entrees(menu);p.components=[];
 for(const [index,name] of names.entries()) {
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode((menu.school && menu.school !== 'sps' ? menu.school + ':' : '') + dishKey(name))))).map(x=>x.toString(16).padStart(2,'0')).join('');
  await env.DB.prepare('INSERT OR IGNORE INTO rating_dishes(id,name,school) VALUES(?,?,?)').bind(hash,name,menu.school || 'sps').run();
  const counts=await totals({...env,SCHOOL_ID:menu.school || 'sps'},name);
  (p.embeds[0].fields ||= []).push({name:name.slice(0,256),value:displaySummary(counts,env.PERSONAL_MODE)});
  if(index<5)p.components.push({type:1,components:[1,2,-1].map(value=>({type:2,style:value===1?3:value===2?2:4,label:`${names.length===1?'':(index+1)+'. '}${value===1?'Like':value===2?'fine':'Dislike'} · ${value===1?counts.up:value===2?counts.fine:counts.down}`,emoji:{name:value===1?'👍':value===2?'🤔':'👎'},custom_id:`rate:${hash}:${menu.date}:${value}`}))});
 }
 if(names.length>1)p.embeds[0].description+='\n\nRating buttons follow the entrée order above.';
 return p;
}
export async function vote(env,i) {
 const match=/^rate:([a-f0-9]{64}):(\d{4}-\d{2}-\d{2}):(1|2|-1)$/.exec(i.data?.custom_id||'');
 if(!match) return 'Invalid rating button.';
 const [,id,date,v]=match;
 const dish=await env.DB.prepare('SELECT name,school FROM rating_dishes WHERE id=?').bind(id).first();
 const user=i.member?.user||i.user;
 if(!dish||!user||user.bot)return 'This rating is unavailable.';
 // Only accept buttons present on this bot-authored message.
 if(i.message?.author?.id!==env.DISCORD_APPLICATION_ID || !i.message?.components?.some(row=>row.components?.some(c=>c.custom_id===i.data.custom_id)))return 'This rating is unavailable.';
 const key=dishKey(dish.name), value=Number(v);
 // A single atomic upsert toggles matching votes to zero; zero means withdrawn.
 const result=await env.DB.prepare(`INSERT INTO entree_votes(dish,serving_date,user_id,value,school) VALUES(?,?,?,?,?)
 ON CONFLICT(school,dish,serving_date,user_id) DO UPDATE SET value=CASE WHEN entree_votes.value=excluded.value THEN 0 ELSE excluded.value END RETURNING value`)
 .bind(key,date,user.id,value,dish.school || 'sps').first();
 const scope=i.guild_id?`guild:${i.guild_id}`:`user:${user.id}`;
 await env.DB.prepare('INSERT INTO vote_scope_states(scope_id,school,dish,serving_date,user_id,value) VALUES(?,?,?,?,?,?) ON CONFLICT(scope_id,school,dish,serving_date,user_id) DO UPDATE SET value=excluded.value').bind(scope,dish.school||'sps',key,date,user.id,result.value).run();
 return `${result.value===0?'Rating removed.':`Rating saved: ${value===1?'👍':value===2?'🤔':'👎'}`}\n${await history({...env,SCHOOL_ID:dish.school || 'sps'},dish.name)}`;

}

export async function refreshRatings(env,message) {
 const components=structuredClone(message.components||[]);
 const embeds=structuredClone(message.embeds||[]).map(e=>{const {type,provider,video,...rest}=e;return rest;});
 for(const row of components) {
  const id=/^rate:([a-f0-9]{64}):/.exec(row.components?.[0]?.custom_id||'')?.[1];
  if(!id)continue;
  const dish=await env.DB.prepare('SELECT name,school FROM rating_dishes WHERE id=?').bind(id).first();
  if(!dish)continue;
  const counts=await totals({...env,SCHOOL_ID:dish.school || 'sps'},dish.name);
  if(!row.components.some(button=>button.custom_id.endsWith(':2'))) {
   const source=row.components[0];
   const prefix=/^\d+\. /.exec(source.label||'')?.[0]||'';
   row.components.splice(1,0,{type:2,style:2,label:`${prefix}fine · ${counts.fine}`,emoji:{name:'🤔'},custom_id:source.custom_id.replace(/:(1|-1)$/,':2')});
  }
  for(const button of row.components) {
   const positive=button.custom_id.endsWith(':1');
   const neutral=button.custom_id.endsWith(':2');
   const prefix=/^\d+\. /.exec(button.label||'')?.[0]||'';
   button.label=`${prefix}${positive?'Like':neutral?'fine':'Dislike'} · ${positive?counts.up:neutral?counts.fine:counts.down}`;
  }
  for(const embed of embeds)for(const field of embed.fields||[])if(field.name===dish.name.slice(0,256))field.value=displaySummary(counts,/personal ratings/i.test(field.value));
 }
 return {embeds,components,allowed_mentions:{parse:[]}};
}

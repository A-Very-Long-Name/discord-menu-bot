import {SCHOOLS,school} from './schools.mjs';
import {row,button} from './dashboard.mjs';
const escape=s=>String(s).replace(/([\\`*_{}\[\]<>|~])/g,'\\$1').replace(/[\r\n]/g,' ');
export async function leaderboard(env,kind,owner,page=0,mode='global'){
 if(!['dishes','schools'].includes(kind))throw Error('Choose Dishes or Schools.');
 if(!['global','personal'].includes(mode))throw Error('Choose /leaderboard global or /leaderboard personal.');
 const grouping=kind==='dishes'?'school,dish':'school';
 const {results}=await env.DB.prepare(`SELECT ${grouping}, SUM(CASE WHEN value=1 THEN 1 ELSE 0 END) AS likes, SUM(CASE WHEN value=-1 THEN 1 ELSE 0 END) AS dislikes, SUM(CASE WHEN value=1 THEN 1 WHEN value=-1 THEN -1 ELSE 0 END) AS score FROM vote_scope_states WHERE scope_id=? ${mode==='personal'?'AND user_id=? ':''}AND value IN (1,2,-1) GROUP BY ${grouping} ORDER BY score DESC,likes DESC,school ASC${kind==='dishes'?',dish ASC':''}`).bind(env.VOTE_SCOPE||'unscoped',...(mode==='personal'?[owner]:[])).all();
 let entries=results.filter(r=>Object.hasOwn(SCHOOLS,r.school));
 if(kind==='schools'){
  const found=new Set(entries.map(r=>r.school));
  entries.push(...Object.keys(SCHOOLS).filter(id=>!found.has(id)).map(id=>({school:id,likes:0,dislikes:0,score:0})));
  entries.sort((a,b)=>b.score-a.score||b.likes-a.likes||school(a.school).name.localeCompare(school(b.school).name));
 }
 const pages=Math.max(1,Math.ceil(entries.length/10));page=Math.max(0,Math.min(Number.isInteger(page)?page:0,pages-1));
 const lines=entries.slice(page*10,page*10+10).map((r,n)=>`**${page*10+n+1}. ${kind==='dishes'?escape(r.dish).slice(0,150)+' · ':''}${school(r.school).name}**\nScore: **${r.score>0?'+':''}${r.score}** · 👍 ${r.likes} · 👎 ${r.dislikes}`);
 return {content:'',allowed_mentions:{parse:[]},embeds:[{title:kind==='dishes'?'Dish leaderboard':'School leaderboard',color:0x244b3b,description:`${mode==='global'?'Global · Everyone in this server':`Personal · <@${owner}> · ${env.VOTE_SCOPE?.startsWith('guild:')?'This server':'This DM'}`} · All time\nScore = likes − dislikes. Fine ratings are neutral.\n\n${lines.join('\n\n')||'No ratings yet. Rate an entrée using /food to get started.'}`,footer:{text:`Page ${page+1}/${pages} · Ties: most likes, then alphabetical order`}}],components:[row(button('Previous',`board:${owner}:${kind}:${Math.max(0,page-1)}:${mode}:previous`,page===0),button('Refresh',`board:${owner}:${kind}:${page}:${mode}:refresh`),button('Next',`board:${owner}:${kind}:${page+1}:${mode}:next`,page===pages-1))]};
}

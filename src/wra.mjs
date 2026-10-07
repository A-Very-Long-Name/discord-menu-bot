import {unzipSync,strFromU8} from 'fflate';
import {classify} from './providers.mjs';
export const WRA_URL='https://docs.google.com/presentation/d/1xHWF4RymuEc51msed9bs7XyhH-6N4OHg4dAH8cOofuA/export/pptx';
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
export function slideRows(xml){
 return [...xml.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map(row=>[...row[1].matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map(cell=>[...cell[1].matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map(p=>[...p[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map(t=>decode(t[1])).join('').trim()).filter(Boolean)));
}
export function parseWraDeck(bytes){
 if(bytes.length>5000000)throw new Error('WRA deck too large');
 const files=unzipSync(bytes,{filter:file=>/^ppt\/slides\/slide[123]\.xml$/.test(file.name)});
 const slides=[1,2,3].map(i=>{const f=files[`ppt/slides/slide${i}.xml`];if(!f||f.length>2000000)throw new Error('WRA slide missing or too large');return slideRows(strFromU8(f))});
 for(const [i,pattern] of [/^BREAKFAST/i,/^LUNCH.*BRUNCH/i,/^DINNER/i].entries())if(!pattern.test(slides[i][0]?.[0]?.join(' ')))throw new Error('WRA slide order changed');
 return slides;
}
export function parseWra(slides,meal,date){
 const rows=slides[meal==='lunch'?1:2];const title=rows?.[0]?.[0]?.join(' ')||'';const match=title.match(/Week of\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/i);
 const empty={school:'wra',meal,date,available:false,groups:[]};
 if(!match)return empty;
 const year=Number(date.slice(0,4));const target=new Date(date+'T12:00:00Z');
 const candidates=[year-1,year,year+1].filter(y=>!match[3]||y===Number(match[3])).map(y=>new Date(Date.UTC(y,Number(match[1])-1,Number(match[2]),12)));
 const start=candidates.find(d=>d.getUTCDay()===1&&target-d>=0&&target-d<7*86400000);if(!start)return empty;
 const day=Math.floor((target-start)/86400000);const expected=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 if(rows[1]?.slice(1).some((c,i)=>c.join(' ').trim()!==expected[i])||rows[1]?.length!==8)throw new Error('WRA columns changed');
 const selected=rows.filter(r=>/^(BRAVO|PIONEER PLATES|INSPIRED EATS)$/i.test(r[0]?.join(' ').trim()||''));
 const values=selected.flatMap(r=>r[day+1]||[]);
 if(meal==='lunch'&&values.some(v=>/^brunch$/i.test(v)))return {...empty,brunch:true};
 const filtered=values.filter(v=>!/^none$|^brunch$/i.test(v));
 const groups=classify(filtered);
 const retained=new Set(groups.flatMap(g=>g.items));
 const labels=filtered.filter(v=>!retained.has(v)&&/^(?:WRA Chipotle|Family (?:Day Menu|Tailgate Meal)|Cheeseburger Mac & Cheese|Burgers|BBQ Tacos|Gyros|Sandwiches|Baked Potato Bar)$/i.test(v));
 if(labels.length){let main=groups.find(g=>g.name==='Entrée');if(!main){main={name:'Entrée',items:[]};groups.unshift(main);}main.items.push(...labels);}
 return {...empty,available:groups.length>0,groups};
}
export async function fetchWra(fetcher=fetch){const r=await fetcher(WRA_URL,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('WRA menu HTTP '+r.status);return parseWraDeck(new Uint8Array(await r.arrayBuffer()));}
export async function loadWra(env,meal,date,fetcher=fetch){
 const cached=await env.DB.prepare('SELECT payload FROM menu_cache WHERE school=?').bind('wra').first();
 if(cached){const menu=parseWra(JSON.parse(cached.payload),meal,date);if(menu.available||menu.brunch)return menu;}
 const slides=await fetchWra(fetcher);await saveWra(env,slides);return parseWra(slides,meal,date);
}
async function saveWra(env,slides){await env.DB.prepare('INSERT INTO menu_cache(school,payload,updated_at) VALUES(?,?,?) ON CONFLICT(school) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind('wra',JSON.stringify(slides),Date.now()).run();}
export async function refreshWra(env,now,local){
 if(local.weekday!=='Mon'||local.minutes<360||local.minutes>=420)return;
 const prior=await env.DB.prepare('SELECT payload,updated_at FROM menu_cache WHERE school=?').bind('wra').first();
 // A successful current-week refresh ends the retry loop; failed or stale decks retry before 07:00.
 if(prior&&prior.updated_at>now.getTime()-3600000&&parseWra(JSON.parse(prior.payload),'dinner',local.date).available)return;
 const slides=await fetchWra();if(!parseWra(slides,'dinner',local.date).available)throw new Error('WRA current week not published');await saveWra(env,slides);
}

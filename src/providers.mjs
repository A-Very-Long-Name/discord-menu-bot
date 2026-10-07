import {parse} from 'parse5';
import {school} from './schools.mjs';
const text=n=>n.nodeName==='#text'?n.value:(n.childNodes||[]).map(text).join('');
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const attr=(n,key)=>n.attrs?.find(a=>a.name===key)?.value;
const hasClass=(n,name)=>(attr(n,'class')||'').split(/\s+/).includes(name);
function nodes(root,predicate){const result=[];function visit(n){if(predicate(n))result.push(n);for(const c of n.childNodes||[])visit(c)}visit(root);return result;}
const vegetarian=/\b(vegan|vegetarian|plant[- ]based|tofu|paneer|seitan|impossible|beyond|jack ?fruit)\b/i;
const condiment=/\b(sauce|gravy|dressing|salsa|mayonnaise|ketchup|mustard|sour cream|guacamole|croutons|shredded cheddar|diced red onion|fresh cilantro|fresh chopped chives|pickle chips)\b|^(scallions?|cheddar|parmesan|basil pesto|pesto|pico de gallo)$/i;
const protein=/\b(chicken|beef|pork|turkey|lamb|fish|catfish|flounder|haddock|salmon|cod|tilapia|tuna|shrimp|mussels|brisket|steak|ribs?|meatballs?|sausage|ham|corn dogs?|hot dogs?|hamburgers?|shepherd.?s pie)\b/i;
const dessert=/\b(dessert|cookies?|cake|brownies?|pudding|crisp|ice cream|froyo|pie|krispie|krinkles)\b/i;
const soup=/\b(soup|chowder|gumbo|bouillon)\b/i;
const side=/\b(vegetables?|kale|chickpea|rice|potato|potatoes|fries|chips|noodles|macaroni|mac n cheese|corn|broccoli|broccolini|cauliflower|beans?|peas|carrots?|squash|zucchini|greens|collards?|cabbage|asparagus|chard|mushrooms|peppers|onions|ratatouille|calabacitas|lentil|dal|dahl|rolls?|bread|biscuits?|salad|lo mein|rotini|gemelli|penne|pierogis?)\b/i;
const ignored=/\b(salad bar|deli (bar|line|station|buffet)|fruit bar|whole fruit|diced fruit|wok joy|special accommodation|gluten aware|pasta\/marinara|bun|tortilla)\b/i;
const unique=items=>[...new Set(items.map(clean).filter(Boolean))];
function groups(entree=[],sides=[],sweet=[]){return [{name:'Entrée',items:unique(entree)},{name:'Sides',items:unique(sides)},{name:'Dessert',items:unique(sweet)}].filter(g=>g.items.length);}
// Conservative dish-name rules apply only inside the verified main station.
export function classify(items){
 const entree=[],sides=[],sweet=[];
 for(const raw of items){const item=clean(raw).replace(/\s*-\s*GF\b/gi,'');
  if(!item||ignored.test(item)||/\bbar\b/i.test(item)||soup.test(item))continue;
  if(dessert.test(item)&&!protein.test(item)){sweet.push(item);continue;}
  if(/(?:vegetable|vegetarian) (?:taco filling|quesadilla|wrap)/i.test(item))continue;
  if(vegetarian.test(item)&&!(/vegetarian/i.test(item)&&/\bbeans\b/i.test(item)))continue;
  // Meat in a sauce name is not a main; sauce served "with" a meat dish is part of its name.
  if(condiment.test(item)&&!(/\bwith\b|\bw\//i.test(item)&&protein.test(item)))continue;
  if(protein.test(item)||/\b(stuffed shells|sloppy joe|lasagna|cheese steak|hoagie|quesadilla|pizza)\b/i.test(item))entree.push(item);
  else if(side.test(item))sides.push(item);
 }
 return groups(entree,sides,sweet);
}
export function flikSelection(id,day,sourceGroups){
 if(id==='groton'){
  const mains=[],sides=[],sweet=[];
  const rows=day.menu_items.filter(i=>!i.is_section_title&&!i.is_station_header).sort((a,b)=>(a.position??0)-(b.position??0));
  const entreeRows=rows.filter(i=>/^entree$/i.test(day.menu_info?.[i.menu_id]?.section_options?.display_name||''));
  for(const item of entreeRows){
   const line=clean(item.food?.name||item.text).replace(/^Breaking Bread:\s*/i,'');
   if(/pasta bar/i.test(line)&&entreeRows.length>1)continue;
   const parts=line.split(/,\s*/);mains.push(parts.shift());
   sides.push(...parts.flatMap(x=>x.split(/\s&\s/)).filter(x=>!condiment.test(x)));
  }
  for(const item of rows)if(/^dessert$/i.test(day.menu_info?.[item.menu_id]?.section_options?.display_name||''))sweet.push(item.food?.name||item.text);
  return groups(mains,sides,sweet);
 }
 if(id==='cate')return classify(sourceGroups.filter(g=>/^hot (lunch|dinner) offerings$|^menu$/i.test(g.name)).flatMap(g=>g.items));
 return null;
}
function result(id,meal,date,selected,extras={}){return {school:id,meal,date,available:selected.length>0,groups:selected,...extras};}
export function parseLawrenceville(html,meal,date){
 const sections=html.match(/<section\b[^>]*>[\s\S]*?<\/section>/gi);
 if(sections)html=sections.filter(s=>/<h[123]\b/i.test(s)&&/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Breakfast|Lunch|Dinner)/i.test(s)).join('');
 const markup=html.match(/<(h[123]|p)\b[^>]*>[\s\S]*?<\/\1>/gi)||[];
 html=markup.map(block=>block.replace(/<[^>]*>/g,tag=>/^<\/?(?:h[123]|p)\b/i.test(tag)?tag.replace(/\s[^>]*>/,'>'):'')).join('');
 const doc=parse(html),blocks=[];
 function visit(n){if(['h1','h2','h3','p'].includes(n.tagName))blocks.push({tag:n.tagName,text:clean(text(n))});else for(const c of n.childNodes||[])visit(c)}visit(doc);
 const expected=new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
 const start=blocks.findIndex(b=>/^h[12]$/.test(b.tag)&&b.text===expected);
 if(start<0)return result('lawrenceville',meal,date,[]);
 const values=[];let active=false;
 for(const b of blocks.slice(start+1)){
  if(/^h[12]$/.test(b.tag))break;
  const normalized=b.text.replace(/\s/g,'').toLowerCase();
  if(['breakfast','brunch','lunch','dinner'].includes(normalized)){active=normalized===meal;continue;}
  if(active&&b.tag==='p')values.push(b.text);
 }
 // Recent menus consistently list two main choices and two sides after Soup.
 const core=values.filter(x=>!/^soup:/i.test(x)).slice(0,4);
 if(core.length<4)return result('lawrenceville',meal,date,[],{partial:true});
 const primary=classify(core.slice(0,2));
 return result('lawrenceville',meal,date,groups(primary.filter(g=>g.name==='Entrée').flatMap(g=>g.items),core.slice(2),values.filter(x=>/^dessert$/i.test(x))),{classificationNote:true});
}
export function parseDeerfield(html,meal,date){
 const begin=html.indexOf('<div class="dining-hall-menu-shortcode">');
 if(begin>=0){
  const tail=html.slice(begin),tags=/<\/?div\b[^>]*>/gi;let depth=0;
  for(const match of tail.matchAll(tags)){depth+=match[0].startsWith('</')?-1:1;if(depth===0){html=tail.slice(0,match.index+match[0].length);break;}}
 }
 const doc=parse(html),root=nodes(doc,n=>hasClass(n,'dining-hall-menu-shortcode'))[0];
 if(!root)throw new Error('Deerfield schema changed');
 const expected=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
 let active=false,sourceOrder=[];const mains=[],sides=[],sweet=[];
 for(const n of root.childNodes||[]){
  if(hasClass(n,'menu-date')){active=clean(text(n)).endsWith(expected);continue;}
  if(!active||!hasClass(n,'menu-meals'))continue;
  const mealNode=nodes(n,x=>hasClass(x,'menu-meal')).find(x=>clean(text(nodes(x,y=>hasClass(y,'menu-meal-title'))[0]||{})).toLowerCase()===meal);
  if(!mealNode)break;
  sourceOrder=nodes(mealNode,n=>hasClass(n,'menu-item-name')).map(n=>clean(text(n)));
  for(const group of nodes(mealNode,x=>attr(x,'data-group'))){
   const label=attr(group,'data-group').toLowerCase();
   const names=nodes(group,x=>hasClass(x,'menu-item-name')).map(x=>clean(text(x)));
   if(label==='entree')mains.push(...names.filter(x=>!vegetarian.test(x)));
   else if(['starch','side','bread'].includes(label))sides.push(...names.filter(x=>!/^whipped butter$/i.test(x)));
   else if(label==='dessert')sweet.push(...names);
  }
  // Single-item categories are emitted without data-group attributes by this site.
  const singles=nodes(mealNode,x=>hasClass(x,'menu-item-name')).filter(x=>{
   for(let parent=x.parentNode;parent&&parent!==mealNode;parent=parent.parentNode)if(attr(parent,'data-group'))return false;
   return true;
  }).map(x=>clean(text(x)));
  const inferred=classify(singles);
  mains.push(...inferred.filter(g=>g.name==='Entrée').flatMap(g=>g.items));
  sides.push(...inferred.filter(g=>g.name==='Sides').flatMap(g=>g.items));
  sweet.push(...inferred.filter(g=>g.name==='Dessert').flatMap(g=>g.items));
  break;
 }
 const ordered=sourceOrder;
 for(const items of [mains,sides,sweet])items.sort((a,b)=>ordered.indexOf(a)-ordered.indexOf(b));
 return result('deerfield',meal,date,groups(mains,sides,sweet));
}
function htmlLines(html){
 const doc=parse(html),out=[];
 function visit(n){if(['script','style'].includes(n.tagName))return;if(n.tagName==='br')out.push('\n');if(n.nodeName==='#text')out.push(n.value);else for(const c of n.childNodes||[])visit(c);if(['p','td','tr','div'].includes(n.tagName))out.push('\n');}visit(doc);
 return out.join('').split(/[\r\n]+/).map(clean).filter(Boolean);
}
export function parsePeddie(data,meal,date){
 if(!Array.isArray(data.events))throw new Error('Peddie schema changed');
 const events=data.events.filter(e=>String(e.start_date).slice(0,10)===date&&new RegExp('^'+meal+'(?:\\b|-)','i').test(e.title));
 if(!events.length)return result('peddie',meal,date,[],{brunch:meal==='lunch'&&data.events.some(e=>String(e.start_date).slice(0,10)===date&&/^brunch\b/i.test(e.title)&&!/(closed|cancelled|canceled)/i.test(e.title))});
 const open=events.filter(e=>!/(closed|cancelled|canceled)/i.test(e.title));
 if(!open.length)return result('peddie',meal,date,[],{closed:true});
 const selected=[];
 for(const event of open){
  const lines=htmlLines(event.description),boundary=lines.findIndex(x=>/^pasta\/marinara/i.test(x));
  const core=boundary<0?lines:lines.slice(0,boundary);
  const gs=classify(core.concat(lines.filter(x=>dessert.test(x)||/^rolls and butter$/i.test(x))));selected.push(...gs);
 }
 return result('peddie',meal,date,groups(...['Entrée','Sides','Dessert'].map(name=>selected.filter(g=>g.name===name).flatMap(g=>g.items))),{classificationNote:true});
}
const GRAPHQL='https://api.elevate-dxp.com/api/mesh/c087f756-cc72-4649-a36f-3a41b700c519/graphql';
const QUERY=`query getLocationRecipes($campusUrlKey:String!,$locationUrlKey:String!,$date:String!,$mealPeriod:Int,$viewType:Commerce_MenuViewType!){getLocationRecipes(campusUrlKey:$campusUrlKey,locationUrlKey:$locationUrlKey,date:$date,mealPeriod:$mealPeriod,viewType:$viewType){locationRecipesMap{dateSkuMap{date stations{id skus{simple configurable{sku variants}}}}}products{items{name sku attributes{name value}}}}}`;
export function parseElevate(data,id,meal,date){
 if(data.errors||!data.data?.getLocationRecipes)throw new Error('Elevate menu unavailable');
 const info=data.data.getLocationRecipes,config=school(id),selected=[];
 const products=new Map((info.products?.items||[]).map(p=>[p.sku,p]));
 const day=info.locationRecipesMap?.dateSkuMap?.find(d=>d.date===date);
 for(const st of day?.stations||[]){
  if(st.id!==config.station)continue;
  const skus=[...(st.skus?.simple||[]),...(st.skus?.configurable||[]).map(x=>x.sku)];
  for(const sku of skus){const p=products.get(sku);if(!p)throw new Error('Elevate product missing');
   const attrs=Object.fromEntries((p.attributes||[]).map(a=>[a.name,a.value]));
   if(attrs.ingredient_item==='yes'||attrs.is_hide_from_web_menu==='yes')continue;
   selected.push(attrs.marketing_name||p.name);
  }
 }
 return result(id,meal,date,classify(selected),{classificationNote:true});
}
export async function loadExternal(id,meal,date,fetcher){
 const config=school(id);let url=config.url,options={headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)};
 if(config.provider==='elevate'){
  const vars={campusUrlKey:'campus',locationUrlKey:config.slug,date,mealPeriod:config.periods[meal],viewType:'DAILY'};
  url=GRAPHQL+'?'+new URLSearchParams({query:QUERY,variables:JSON.stringify(vars)});
  options.headers={...options.headers,Store:config.store,'magento-store-code':config.store.replace(/_en$/,''),'magento-website-code':config.store.replace(/_en$/,''),'magento-store-view-code':config.store,'X-Api-Key':'ElevateAPIProd'};
 }else if(id==='peddie')url='https://peddie.org/wp-json/tribe/events/v1/events/?'+new URLSearchParams({categories:'pfs-menus',start_date:date+' 00:00:00',end_date:date+' 23:59:59',per_page:'50'});
 const r=await fetcher(url,options);if(!r.ok)throw new Error('School menu HTTP '+r.status);
 if(config.provider==='elevate'){
  const menu=parseElevate(await r.json(),id,meal,date);
  if(meal==='lunch'&&!menu.available&&new Date(date+'T12:00:00Z').getUTCDay()===6){
   const vars={campusUrlKey:'campus',locationUrlKey:config.slug,date,mealPeriod:13,viewType:'DAILY'};
   const brunch=await fetcher(GRAPHQL+'?'+new URLSearchParams({query:QUERY,variables:JSON.stringify(vars)}),options);
   if(brunch.ok&&parseElevate(await brunch.json(),id,meal,date).available)return {...menu,brunch:true};
  }
  return menu;
 }
 if(id==='peddie'){const data=await r.json();if(data.total_pages>1)throw new Error('Peddie date query needs pagination');return parsePeddie(data,meal,date);}
 const html=await r.text();return id==='deerfield'?parseDeerfield(html,meal,date):parseLawrenceville(html,meal,date);
}

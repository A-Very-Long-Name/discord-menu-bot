import {flikSelection,loadExternal} from './providers.mjs';
import {school} from './schools.mjs';
export const MEALS = ['breakfast', 'brunch', 'lunch', 'dinner'];
export const ZONE = 'America/New_York';
// Explicit allowlist: Vegetarian Entree and every other station are excluded.
export function sectionKey(name) {
  return clean(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g,' ');
}
const sectionNames = new Set(['entree','main entree','vegetarian entree','sides','dessert',
 'soup of the day','soup','power bar','pasta','international','international fare','toppings',
 'beverage options','gluten-aware','salad bar','deli bar','breakfast','grab n go sandwiches',"grab n' go sandwiches"]);
export function isSectionHeader(item) {
  return item.is_section_title || item.is_station_header ||
    (!item.food && sectionNames.has(sectionKey(item.text)));
}
export function wantedSection(name) {
  const normalized = clean(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return ['entree', 'main entree', 'sides', 'dessert'].includes(normalized);
}
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
export function localTime(now = new Date(), zone = ZONE) {
  const clock=zone === ZONE ? formatter : new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const p = Object.fromEntries(clock.formatToParts(now).map(x => [x.type, x.value]));
  return {date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday, minutes: +p.hour * 60 + +p.minute};
}
export function scheduledMeal(now) {
  const p = localTime(now);
  if (p.weekday !== 'Sun' && p.minutes >= 420 && p.minutes < 450)
    return {...p, meal: 'lunch', age: p.minutes - 420};
  if (p.minutes >= 900 && p.minutes < 930)
    return {...p, meal: 'dinner', age: p.minutes - 900};
  return null;
}
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function menuUrl(meal, date, schoolId = 'sps') {
  if (!MEALS.includes(meal) || !validDate(date)) throw new Error('Invalid meal or date');
  if(school(schoolId).url)return school(schoolId).url;
  return `https://${school(schoolId).host}.flikisdining.com/menu/${school(schoolId).slug}/${meal}/${date}`;
}
export function apiUrl(meal, date, schoolId = 'sps') {
  menuUrl(meal, date, schoolId);
  return `https://${school(schoolId).host}.api.flikisdining.com/menu/api/weeks/school/${school(schoolId).slug}/menu-type/${meal}/${date.replaceAll('-', '/')}/`;
}
function clean(s) {
  return String(s ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/[\r\n]+/g, ' ').trim();
}
function escape(s) { return clean(s).replace(/([\\*_`~|>\[\]])/g, '\\$1').replace(/@/g, '@\u200b'); }
export function parseMenu(data, meal, date, schoolId = 'sps') {
  menuUrl(meal, date);
  if (!Array.isArray(data?.days)) throw new Error('Menu response schema changed');
  const day = data.days.find(d => d.date === date);
  if (!day) return {meal, date, available: false, groups: []};
  if (!Array.isArray(day.menu_items)) throw new Error('Menu items schema changed');
  const groups = [];
  let group = {name: 'Menu', items: []};
  for (const item of [...day.menu_items].sort((a,b) => ((day.menu_info?.[a.menu_id]?.position ?? 0) - (day.menu_info?.[b.menu_id]?.position ?? 0)) || (a.position ?? 0) - (b.position ?? 0))) {
    if (isSectionHeader(item)) {
      group = {name: clean(item.text) || 'Menu', items: []}; groups.push(group);
    } else {
      const name = clean(item.food?.name || item.text);
      if (name) { if (!groups.includes(group)) groups.push(group); group.items.push(name); }
    }
  }
  const nonempty = groups.filter(g => g.items.length);
  const main=nonempty.filter(g=>sectionKey(g.name)==='grill main').flatMap(g=>g.items);
  const selected=flikSelection(schoolId,day,nonempty) ?? (schoolId==='loomis' ? (main.length ? [
    {name:'Entrée',items:[main[0]]},
    ...(main.length>1?[{name:'Sides',items:main.slice(1)}]:[])
  ] : []) : nonempty.filter(g=>wantedSection(g.name)));
  return {meal, date, available: nonempty.length > 0, partial: !!day.has_unpublished_menus,
    school: schoolId, groups: selected};
}
async function loadCoit(meal, date, fetcher = fetch, schoolId = 'sps') {
  const url = apiUrl(meal, date, schoolId);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetcher(url, {signal: AbortSignal.timeout(8000), headers: {'Accept': 'application/json'}});
      if (!r.ok) throw new Error(`Menu HTTP ${r.status}`);
      return {...parseMenu(await r.json(), meal, date, schoolId),school:schoolId};
    } catch (error) { if (attempt === 1) throw error; }
  }
}
export function includeDeli(meal, date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return meal === 'lunch' && validDate(date) && weekday >= 1 && weekday <= 5;
}
async function loadDeli(date, fetcher) {
  const url = `https://sps.api.flikisdining.com/menu/api/weeks/school/grab-n-go-deli-bar/menu-type/lunch/${date.replaceAll('-', '/')}/`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetcher(url, {signal: AbortSignal.timeout(8000), headers: {'Accept':'application/json'}});
      if (!r.ok) throw new Error('Deli fetch failed');
      const data = await r.json();
      if (!Array.isArray(data.days)) throw new Error('Deli schema changed');
      const day = data.days.find(d => d.date === date);
      if (day && !Array.isArray(day.menu_items)) throw new Error('Deli schema changed');
      return {items: (day?.menu_items || []).filter(i => i.food?.name).map(i => clean(i.food.name))};
    } catch { if (attempt === 1) return {items: [], failed: true}; }
  }
}
export async function loadMenu(meal, date, fetcher = fetch, schoolId = 'sps') {
  menuUrl(meal,date,schoolId);
  if(school(schoolId).provider)return loadExternal(schoolId,meal,date,fetcher);
  if (schoolId !== 'sps' || !includeDeli(meal, date)) {
    const menu=await loadCoit(meal,date,fetcher,schoolId);
    if(meal==='lunch'&&!menu.available&&new Date(date+'T12:00:00Z').getUTCDay()===6){
      try{const response=await fetcher(apiUrl('brunch',date,schoolId),{signal:AbortSignal.timeout(8000)});
        if(response.ok){const data=await response.json();const day=data.days?.find(d=>d.date===date);
          if(day?.menu_items?.some(i=>i.food?.name)&&!day.menu_items.some(i=>/in lieu of brunch/i.test(i.text||'')))return {...menu,brunch:true};}
      }catch{}
    }
    return menu;
  }
  const [coit, deli] = await Promise.allSettled([loadCoit(meal, date, fetcher), loadDeli(date, fetcher)]);
  const menu = coit.status === 'fulfilled' ? coit.value : {meal, date, available:false, groups:[], failed:true};
  return {...menu, deli: deli.status === 'fulfilled' ? deli.value : {items:[], failed:true}};
}
export function payload(menu, failure = false) {
  let lines = menu.groups.filter(g => wantedSection(g.name)).map(g => `**${escape(g.name)}**\n${g.items.map(x => `• ${escape(x)}`).join('\n')}`);
  if (menu.available && !lines.length) lines = ['No Entrée, Sides or Dessert items are listed for this meal/date.'];
  if (!menu.available) lines = [(failure || menu.failed) ? 'Menu could not be retrieved. Please check the original menu.' : 'No menu items are published for this meal/date. This does not necessarily mean the dining hall is closed.'];
  if(menu.brunch)lines=['Brunch is served instead of lunch on this date. Brunch menus are currently not supported.'];
  if(menu.closed)lines=['The dining hall is closed for this meal/date.'];
  if (menu.partial) lines.push('Some menu items may not yet be published.');
  let description = lines.join('\n\n');
  if (description.length > 4000) description = description.slice(0, 3900) + '\n\n… More items in the original menu (title link).';
  if (menu.deli) {
    const url = `https://sps.flikisdining.com/menu/grab-n-go-deli-bar/lunch/${menu.date}`;
    const items = menu.deli.items.length ? menu.deli.items.map(x => `• ${escape(x)}`).join('\n') :
      (menu.deli.failed ? 'Sandwich menu could not be retrieved.' : 'No sandwich is published for this date.');
    const section = `**[Grab ’n Go Deli Bar](${url})**\n${items}`;
    description = (description.length > 3000 ? description.slice(0, 2900) + '\n… More items in the original menu.' : description) + '\n\n' + (section.length > 1000 ? section.slice(0, 900) + '\n… More items in the deli menu.' : section);
  }
  return {allowed_mentions: {parse: []}, embeds: [{
    title: `${menu.meal[0].toUpperCase() + menu.meal.slice(1)} · ${menu.date.slice(5).replace('-', '/')} · ${school(menu.school).hall}`,
    url: menuUrl(menu.meal, menu.date, menu.school), description, color: 0x244b3b,
    footer: {text: 'a bot by hydrogen_01'}
  }]};
}

export function queryDate(value, today = localTime().date) {
  if (value === undefined || value === '') return today;
  if (typeof value !== 'string' || !/^\d{1,2}\/\d{1,2}$/.test(value.trim())) return null;
  const [month, day] = value.trim().split('/').map(x => x.padStart(2, '0'));
  const date = `${today.slice(0,4)}-${month}-${day}`;
  return validDate(date) ? date : null;
}
export function greeting(meal) {
  return meal === 'lunch' ? 'good morning, this is lunch today:' : 'good afternoon, this is dinner today:';
}
export function defaultQueryMeal(minutes){return minutes<840||minutes>=1200?'lunch':'dinner';}
export function defaultQueryDate(local,meal){
 if(local.minutes<(meal==='lunch'?840:1200))return local.date;
 const day=new Date(local.date+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+1);return day.toISOString().slice(0,10);
}

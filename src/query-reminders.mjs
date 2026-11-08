export const QUERY_SCHEMA='CREATE TABLE IF NOT EXISTS menu_queries(scope_id TEXT NOT NULL,channel_id TEXT NOT NULL,school TEXT NOT NULL,serving_date TEXT NOT NULL,meal TEXT NOT NULL,queried_at INTEGER NOT NULL,PRIMARY KEY(scope_id,channel_id,school,serving_date,meal));';
export async function recordMenuQuery(env,i,menu,queriedAt=Date.now()){
 if(!menu.available||!i.channel_id)return;
 const scope=env.VOTE_SCOPE||'unscoped';
 await env.DB.prepare('INSERT INTO menu_queries(scope_id,channel_id,school,serving_date,meal,queried_at) VALUES(?,?,?,?,?,?) ON CONFLICT(scope_id,channel_id,school,serving_date,meal) DO UPDATE SET queried_at=MAX(menu_queries.queried_at,excluded.queried_at)').bind(scope,i.channel_id,menu.school||'sps',menu.date,menu.meal,queriedAt).run();
}
export async function recentlyQueried(env,due,now){
 const scheduledAt=now.getTime()-due.age*60000-now.getUTCSeconds()*1000-now.getUTCMilliseconds();
 return Boolean(await env.DB.prepare('SELECT queried_at FROM menu_queries WHERE scope_id=? AND channel_id=? AND school=? AND serving_date=? AND meal=? AND queried_at>=? AND queried_at<=?').bind(env.VOTE_SCOPE||'unscoped',env.DISCORD_CHANNEL_ID,env.SCHOOL_ID||'sps',due.date,due.meal,scheduledAt-3*3600000,scheduledAt).first());
}

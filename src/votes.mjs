export function voteDateRange(today) {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 2);
  return {start: start.toISOString().slice(0,10), end: today};
}
const escape = text => String(text).replace(/([\\`*_{}\[\]<>|~])/g, '\\$1').replace(/[\r\n]/g,' ');
export async function recentVoteMessages(env, today) {
  const {start,end} = voteDateRange(today);
  const {results} = await env.DB.prepare('SELECT v.dish,v.serving_date,v.user_id,v.value,t.clicked_date,t.clicked_at FROM vote_scope_states v JOIN vote_click_times t USING(scope_id,school,dish,serving_date,user_id) WHERE v.scope_id=? AND v.school=? AND t.clicked_date >= ? AND t.clicked_date <= ? ORDER BY t.clicked_at DESC,v.dish,v.user_id').bind(env.VOTE_SCOPE||'unscoped',env.SCHOOL_ID || 'sps',start,end).all();
  const heading = `Votes · ${start.slice(5).replace('-','/')}–${end.slice(5).replace('-','/')}\nActual last click dates (school timezone); current vote status. Older votes without a click timestamp are excluded.`;
  const chunks = [heading];
  if (!results.length) chunks[0] += '\nNo recorded clicks on these dates.';
  for (const row of results) {
    const status = row.value === 1 ? '👍 Like' : row.value === -1 ? '👎 Dislike' : row.value === 2 ? '🤔 fine' : 'Withdrawn';
    const user = /^\d+$/.test(row.user_id) ? `<@${row.user_id}>` : 'Unknown user';
    const line = `${row.clicked_date.slice(5).replace('-','/')} · ${user} · ${escape(row.dish).slice(0,1000)} · ${status} · menu ${row.serving_date.slice(5).replace('-','/')}`;
    if (chunks[chunks.length-1].length + line.length + 1 > 1900) chunks.push('Votes (continued)');
    chunks[chunks.length-1] += '\n' + line;
  }
  return chunks.map(content => ({content,allowed_mentions:{parse:[]}}));
}

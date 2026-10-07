export function voteDateRange(today) {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 2);
  return {start: start.toISOString().slice(0,10), end: today};
}
const escape = text => String(text).replace(/([\\`*_{}\[\]<>|~])/g, '\\$1').replace(/[\r\n]/g,' ');
export async function recentVoteMessages(env, today) {
  const {start,end} = voteDateRange(today);
  const {results} = await env.DB.prepare('SELECT dish,serving_date,user_id,value FROM vote_scope_states WHERE scope_id=? AND school=? AND serving_date >= ? AND serving_date <= ? ORDER BY serving_date DESC,dish,user_id').bind(env.VOTE_SCOPE||'unscoped',env.SCHOOL_ID || 'sps',start,end).all();
  const heading = `Votes · ${start.slice(5).replace('-','/')}–${end.slice(5).replace('-','/')}\nMenu dates; current vote status (not a log of every click).`;
  const chunks = [heading];
  if (!results.length) chunks[0] += '\nNo votes for these menu dates.';
  for (const row of results) {
    const status = row.value === 1 ? '👍 Like' : row.value === -1 ? '👎 Dislike' : row.value === 2 ? '🤔 fine' : 'Withdrawn';
    const user = /^\d+$/.test(row.user_id) ? `<@${row.user_id}>` : 'Unknown user';
    const line = `${row.serving_date.slice(5).replace('-','/')} · ${user} · ${escape(row.dish).slice(0,1000)} · ${status}`;
    if (chunks[chunks.length-1].length + line.length + 1 > 1900) chunks.push('Votes (continued)');
    chunks[chunks.length-1] += '\n' + line;
  }
  return chunks.map(content => ({content,allowed_mentions:{parse:[]}}));
}

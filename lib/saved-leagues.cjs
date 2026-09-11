'use strict';
const LEAGUE_ID = /^[0-9]{10,22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = 'id,platform,league_id,name,season,roster_id,team_name';
const publicError = message => Object.assign(new Error(message), {publicMessage:message});
const label = (value, fallback) => String(value || fallback).slice(0, 150);
async function lookupLeague(id, fetcher = fetch) {
  if (typeof id !== 'string' || !LEAGUE_ID.test(id)) throw publicError('Enter the numeric Sleeper league ID.');
  const results = await Promise.all(['', '/rosters', '/users'].map(async suffix => {
    const response = await fetcher('https://api.sleeper.app/v1/league/' + id + suffix, {signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw publicError('Sleeper could not load this league. Check the ID and try again.');
    return response.json();
  }));
  const [meta, rosters, users] = results;
  if (!meta || meta.league_id !== id || !Array.isArray(rosters) || !Array.isArray(users)) throw publicError('That Sleeper league could not be found.');
  if (meta.sport !== 'nfl') throw publicError('Only Sleeper football leagues are supported right now.');
  if (!/^[0-9]{4}$/.test(String(meta.season))) throw publicError('This league has no valid season.');
  const names = new Map(users.map(u => [u.user_id, label(u.metadata?.team_name || u.display_name, 'Unnamed team')]));
  return {league_id:id, name:label(meta.name, 'Sleeper league'), season:String(meta.season), teams:rosters.filter(r => Number.isInteger(r.roster_id) && r.roster_id > 0 && r.roster_id <= 1000).map(r => ({roster_id:r.roster_id, name:names.get(r.owner_id) || 'Team ' + r.roster_id}))};
}
async function leagueAction(action, body, user, db, lookup = lookupLeague) {
  if (action === 'leagues') {
    const {data, error} = await db.from('saved_leagues').select(FIELDS).eq('user_id', user.id).order('created_at');
    if (error) return [503, {error:'Saved leagues are temporarily unavailable. Please try again.'}];
    return [200, {leagues:data}];
  }
  if (['league-remove', 'league-update'].includes(action) && !UUID.test(body.id || '')) return [400, {error:'Select a saved league to continue.'}];
  if (action === 'league-remove') {
    const {error} = await db.from('saved_leagues').delete().eq('id', body.id).eq('user_id', user.id);
    return error ? [503, {error:'Unable to remove that saved league. Try again.'}] : [200, {message:'League removed from your account.'}];
  }
  let league;
  try { league = await lookup(body.league_id); }
  catch (error) { return [400, {error:error.name === 'TimeoutError' ? 'Sleeper is taking too long. Please try again.' : error.publicMessage || 'Sleeper is unavailable. Please try again.'}]; }
  if (action === 'league-lookup') return [200, {league}];
  const team = league.teams.find(t => t.roster_id === body.roster_id);
  if (body.roster_id !== null && !team) return [400, {error:'Select your team from this league, or choose No default team.'}];
  const row = {user_id:user.id, platform:'sleeper', league_id:league.league_id, name:league.name, season:league.season, roster_id:team?.roster_id || null, team_name:team?.name || null, updated_at:new Date().toISOString()};
  const query = action === 'league-update' ? db.from('saved_leagues').update(row).eq('id', body.id).eq('user_id', user.id) : db.from('saved_leagues').insert(row);
  const {data, error} = await query.select(FIELDS).single();
  if (error?.code === '23505') return [409, {error:'That league is already in My Leagues. Edit the existing entry instead.'}];
  if (error) return [400, {error:'Unable to save this league. Reload My Leagues and try again.'}];
  return [200, {league:data, message:'League saved to your account.'}];
}
module.exports = {leagueAction, lookupLeague};

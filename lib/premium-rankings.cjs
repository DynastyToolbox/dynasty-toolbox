'use strict';
const Sleeper = require('../sleeper_data.js');
const {requireFeature} = require('./subscription-access.cjs');
const ACTIONS = new Set(['available-players', 'median-data']);
const fail = message => { throw Object.assign(new Error(message), {status:400}); };

async function premiumRankingsAction(action, body, access, deps = {}) {
  // Authorization precedes validation, local data reads, and upstream requests.
  requireFeature(access, action === 'median-data' ? 'medianRankings' : 'bestAvailable');
  if (action === 'median-data') {
    const data = (deps.weekly || (() => require('../data/weekly_points_current.json')))();
    if (!data?.meta || !data.players || Array.isArray(data.players))
      throw Object.assign(new Error('Weekly rankings are temporarily unavailable.'), {status:503});
    return {data};
  }
  if (action !== 'available-players') fail('Unknown rankings action.');
  if (typeof body.league_id !== 'string' || !/^\d{10,22}$/.test(body.league_id)) fail('Enter a valid Sleeper league ID.');
  if (!['overall','competing','tanking'].includes(body.ranking_type)) fail('Choose a ranking type.');
  let league, players;
  try {
    [league, players] = await Promise.all([
      (deps.league || Sleeper.league)(body.league_id, {picks:false}),
      (deps.players || Sleeper.players)()
    ]);
  } catch (_) {
    throw Object.assign(new Error('Unable to load this Sleeper NFL league. Check the league ID and try again.'), {status:502});
  }
  const rankings = (deps.rankings || (() => require('../data/nfl_rankings.json').rankings))();
  const rows = rankings[body.ranking_type].filter(r => r.Player && r.Score && Number.isFinite(Number(r.Score)));
  const owned = new Set(league.rosters.flatMap(r => ['players','reserve','taxi','starters']
    .flatMap(key => Array.isArray(r[key]) ? r[key] : []).map(String)));
  const available = [];
  for (const [id, row] of Sleeper.matchRankings(rows, players).byId) {
    const player = Sleeper.playerInfo(id, players);
    if (owned.has(String(id)) || !['QB','RB','WR','TE'].includes(player.position)) continue;
    available.push({id:String(id), name:row.Player, pos:player.position,
      team:player.team || row.Team || '-', age:player.age || row.Age || '?', score:Number(row.Score)});
  }
  return {league:{id:league.id,name:league.meta.name}, players:available.sort((a,b) => b.score-a.score || a.name.localeCompare(b.name))};
}
module.exports = {ACTIONS, premiumRankingsAction};

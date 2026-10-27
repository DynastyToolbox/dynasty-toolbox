/* Read-only Sleeper imports shared by the league tools. */
(function (root) {
  "use strict";
  const BASE = "https://api.sleeper.app/v1/";
  const pending = new Map();
  let playersPromise;
  let playersUntil = 0;
  const DAY = 24 * 60 * 60 * 1000;
  const isDynastyPosition = position => ['QB','RB','WR','TE','PICK'].includes(position);
  function leagueRankBands(size) {
    const count=Math.max(1,Math.floor(Number(size)||1));
    const top=Math.max(1,Math.ceil(count*.25));
    return {top,middle:Math.max(top,Math.floor(count*.65))};
  }
  function rosterPlayerIds(roster) {
    return [...new Set(['players','reserve','taxi'].flatMap(key => Array.isArray(roster[key]) ? roster[key] : [])
      .filter(id => id !== null && id !== undefined && String(id) !== '' && String(id) !== '0').map(String))];
  }
  function playerInfo(id, registry) {
    const player = registry?.[id] || {};
    const position = String(player.position || player.fantasy_positions?.[0] || 'Other').toUpperCase();
    const pos = position === 'DST' ? 'DEF' : (['QB','RB','WR','TE'].includes(position) ? position : player.fantasy_positions?.find(p=>['QB','RB','WR','TE'].includes(p)) || position);
    const name = player.full_name || [player.first_name, player.last_name].filter(Boolean).join(' ') ||
      (pos === 'DEF' ? `${player.team || id} Defense` : `Unknown player (${id})`);
    return {...player, player_id:String(player.player_id || id), full_name:name, position:pos};
  }
  const playerMap = registry => Object.fromEntries(Object.keys(registry).map(id => [id,playerInfo(id,registry)]));


  // Match names once, then use Sleeper IDs for roster ownership and scoring.
  const playerNameKey = name => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const playerSuffix = name => String(name || '').match(/(?:[\s,]+)(jr|sr|ii|iii|iv|v)\.?\s*$/i)?.[1].toLowerCase() || '';
  const playerBaseKey = name => playerNameKey(String(name || '').replace(/(?:[\s,]+)(?:jr|sr|ii|iii|iv|v)\.?\s*$/i,''));
  // Reviewed against Sleeper's public registry on 2026-10-27. Explicit IDs handle
  // nicknames/typos and the active Kyle Williams without fuzzy name guesses.
  const rankingAliases = [
    ['LEJOHNTAY WESTER','12699','LaJohntay Wester','WR'],
    ['KENNETH GAINWELL','7567','Kenny Gainwell','RB'],
    ['MATTHEW HIBNER','13324','Matt Hibner','TE'],
    ['HOLLYWOOD BROWN','5848','Marquise Brown','WR'],
    ['EMARI DEMARCADO','11199','Emari Demercado','RB'],
    ['JONATHON MINGO','10225','Jonathan Mingo','WR'],
    ['TYQUON THORNTON','8188','Tyquan Thornton','WR'],
    ['KYLE WILLIAMS','12547','Kyle Williams','WR']
  ];
  function matchRankings(rows, registry) {
    const exact = new Map(), base = new Map(), rankedBase = new Map();
    const add = (map, key, item) => { if (key) { if (!map.has(key)) map.set(key, []); map.get(key).push(item); } };
    const position = value => String(value || '').trim().toUpperCase();
    const compatible = (a,b) => !a || !b || a === b;
    for (const id of Object.keys(registry)) {
      const player = playerInfo(id, registry);
      if (!['QB','RB','WR','TE'].includes(player.position)) continue;
      const entry = {id:String(id), player};
      add(exact, playerNameKey(player.full_name), entry);
      add(base, playerBaseKey(player.full_name), entry);
    }
    for (const row of rows) if (!/^PICKS?$/.test(position(row.Position))) add(rankedBase, playerBaseKey(row.Player), row);
    const byId = new Map(), report = [];
    for (const row of rows) {
      const pos = position(row.Position);
      if (/^PICKS?$/.test(pos) || !row.Player) continue;
      const key = playerNameKey(row.Player), baseKey = playerBaseKey(row.Player);
      let candidates = (exact.get(key) || []).filter(e => compatible(pos,e.player.position));
      let method = 'exact';
      const alias = rankingAliases.find(([name,,,aliasPos])=>playerNameKey(name)===key && compatible(pos,aliasPos));
      if (alias && registry[alias[1]]) {
        const target = playerInfo(alias[1],registry);
        if (playerNameKey(target.full_name)===playerNameKey(alias[2]) && target.position===alias[3]) {
          candidates=[{id:alias[1],player:target}];method='alias';
        }
      }
      if (!candidates.length) {
        method = 'suffix';
        candidates = (base.get(baseKey) || []).filter(e => compatible(pos,e.player.position));
        if (playerSuffix(row.Player)) candidates = candidates.filter(e => !playerSuffix(e.player.full_name) || playerSuffix(row.Player) === playerSuffix(e.player.full_name));
        // Both sides must be unique: never guess between father/son or duplicate ranking rows.
        if (candidates.length && (rankedBase.get(baseKey) || []).filter(r => compatible(position(r.Position),candidates[0].player.position)).length !== 1) {
          report.push({name:row.Player,position:pos,status:'ambiguous',candidates:candidates.map(e=>e.player.full_name)});
          continue;
        }
      }
      // Preserve a unique exact identity after a position change; report the
      // discrepancy for the sheet owner without dropping an existing player.
      if (!candidates.length && exact.get(key)?.length === 1 && rows.filter(r=>playerNameKey(r.Player)===key).length === 1) {
        candidates=exact.get(key);method='position-mismatch';
      }
      if (candidates.length !== 1) {
        report.push({name:row.Player,position:pos,status:candidates.length ? 'ambiguous' : (exact.has(key) ? 'position-mismatch' : 'unmatched'),candidates:(candidates.length ? candidates : exact.get(key) || []).map(e=>e.player.full_name+' ('+e.player.position+')')});
        continue;
      }
      const entry = candidates[0];
      const previous = report.find(r=>r.playerId===entry.id);
      if (previous) {
        byId.delete(entry.id);
        previous.status = 'ambiguous';
        previous.candidates = [entry.player.full_name];
        report.push({name:row.Player,position:pos,status:'ambiguous',playerId:entry.id,candidates:[entry.player.full_name]});
        continue;
      }
      byId.set(entry.id,row);
      report.push({name:row.Player,position:pos,status:method,playerId:entry.id,sleeperName:entry.player.full_name,...(method==='position-mismatch'?{candidates:[entry.player.full_name+' ('+entry.player.position+')']}: {})});
    }
    return {byId,report};
  }
  function rankingScoreMap(rows, registry) {
    const scores = Object.create(null);
    // Keep pick lookup keys unchanged. Player lookups always use their stable ID.
    for (const row of rows) if (/^PICKS?$/.test(String(row.Position).toUpperCase())) scores[playerNameKey(row.Player)] = parseFloat(row.Score) || 0;
    for (const [id,row] of matchRankings(rows,registry).byId) scores['player:'+id] = parseFloat(row.Score) || 0;
    return scores;
  }

  async function request(path) {
    if (pending.has(path)) return pending.get(path);
    const task = (async () => {
      const response = await fetch(BASE + path, { signal: AbortSignal.timeout(30000), cache: "no-store" });
      if (!response.ok) throw new Error("Sleeper could not load this league. Check the ID and try again.");
      const data = await response.json();
      if (!data || typeof data !== "object") throw new Error("Sleeper returned no data. Check the league ID and try again.");
      return data;
    })();
    pending.set(path, task);
    try { return await task; } finally { pending.delete(path); }
  }

  function leagueId(value) {
    const id = String(value).trim();
    if (!/^\d+$/.test(id)) throw new Error("Enter the numeric Sleeper league ID.");
    return id;
  }

  async function players() {
    if (playersPromise && Date.now() < playersUntil) return playersPromise;
    playersUntil = Date.now() + DAY;
    playersPromise = (async () => {
      let cache;
      try {
        cache = await root.caches?.open("dt-sleeper-players-v1");
        const saved = await cache?.match(BASE + "players/nfl");
        const fetchedAt = Number(saved?.headers.get("x-dt-fetched-at"));
        if (saved && fetchedAt > 0 && Date.now() - fetchedAt < DAY) {
          const data = await saved.json();
          if (data && !Array.isArray(data) && Object.keys(data).length) {
            playersUntil = fetchedAt + DAY;
            return playerMap(data);
          }
        }
      } catch (_) { /* Private browsing or full storage: use the network. */ }
      const data = await request("players/nfl");
      if (Array.isArray(data) || !Object.keys(data).length) throw new Error("Sleeper's player list is unavailable. Try again.");
      try {
        await cache?.put(BASE + "players/nfl", new Response(JSON.stringify(data), {
          headers: { "content-type": "application/json", "x-dt-fetched-at": String(Date.now()) }
        }));
      } catch (_) { /* Storage is an optional optimization. */ }
      return playerMap(data);
    })();
    try { return await playersPromise; }
    catch (error) { playersPromise = null; playersUntil = 0; throw error; }
  }

  async function league(value, { picks = true } = {}) {
    const id = leagueId(value);
    const paths = ["", "/rosters", "/users", ...(picks ? ["/drafts", "/traded_picks"] : [])];
    const [meta, rosters, users, drafts = [], traded = []] = await Promise.all(
      paths.map(part => request("league/" + id + part))
    );
    if (!meta.league_id || meta.sport !== "nfl" ||
        ![rosters, users, drafts, traded].every(Array.isArray) || !rosters.length) {
      throw new Error("This tool needs a valid Sleeper NFL league. Check the league ID.");
    }
    return { id, meta, rosters:rosters.map(r=>({...r,players:rosterPlayerIds(r)})), users, drafts, traded };
  }

  const normalize = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  function pickLabel(pick) {
    const n = Number(pick.round), v = n % 100;
    const suffix = ["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th";
    return `${pick.season} ${n}${suffix} Round`;
  }
  function pickScore(pick, scores) {
    const value = scores[normalize(pickLabel(pick))];
    return Number.isFinite(value) ? value : null;
  }
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function originName(pick, rosters, users) {
    const roster = rosters.find(r => String(r.roster_id) === String(pick.roster_id));
    const user = users.find(u => String(u.user_id) === String(roster?.owner_id));
    return user?.display_name || `Team ${pick.roster_id}`;
  }

  // A traded-pick record is the current state of ONE original team's pick,
  // not a transaction to replay from previous_owner_id. Never infer its origin
  // from the seller, and never remove every pick of a given season/round.
  function withPicks({ meta, rosters, drafts, traded }) {
    const result = rosters.map(r => ({ ...r, players: rosterPlayerIds(r), picks: [] }));
    if (Number(meta.settings?.type) !== 2) return result; // Future rookie picks are dynasty assets.
    const season = Number(meta.season), rounds = Number(meta.settings?.draft_rounds);
    if (!Number.isInteger(season) || season < 2000 || !Number.isInteger(rounds) || rounds < 0) {
      throw new Error("Sleeper's draft season or round settings are unavailable. Try again.");
    }
    const current = drafts.filter(d => Number(d.season) === season);
    if (current.some(d => ["drafting", "paused"].includes(d.status))) {
      throw new Error("This league has a draft in progress. Load it again after the draft finishes so selected players and unused picks are not counted twice.");
    }
    const pendingRookie = current.some(d => d.status !== "complete" && Number(d.settings?.player_type) === 1);
    const completed = !pendingRookie && current.some(d => d.status === "complete");
    const startup = !pendingRookie && current.some(d => d.status !== "complete" && Number(d.settings?.player_type) === 0);
    const first = season + ((completed || startup || meta.status !== "pre_draft") ? 1 : 0);
    const byRoster = new Map(result.map(r => [String(r.roster_id), r]));
    const inventory = new Map();
    const key = p => `${Number(p.season)}:${Number(p.round)}:${String(p.roster_id)}`;
    for (let year = first; year < first + 3; year++) {
      for (const r of result) for (let round = 1; round <= rounds; round++) {
        const pick = { season: String(year), round, roster_id: r.roster_id, owner_id: r.roster_id, previous_owner_id: r.roster_id };
        inventory.set(key(pick), pick);
      }
    }
    const seen = new Map();
    for (const p of traded) {
      const year = Number(p.season), round = Number(p.round);
      if (!Number.isInteger(year) || !Number.isInteger(round)) throw new Error("Sleeper returned incomplete draft-pick information. Try again.");
      if (year < first || year >= first + 3) continue;
      if (!byRoster.has(String(p.roster_id)) || !byRoster.has(String(p.owner_id)) || round < 1 || round > rounds) {
        throw new Error("Sleeper's traded picks do not match this league's rosters or draft settings. Scores were not calculated.");
      }
      const identity = key(p);
      if (seen.has(identity) && seen.get(identity) !== String(p.owner_id)) throw new Error("Sleeper returned conflicting pick owners. Try again.");
      seen.set(identity, String(p.owner_id));
      inventory.set(identity, { ...p, season: String(year), round });
    }
    for (const p of inventory.values()) byRoster.get(String(p.owner_id)).picks.push(p);
    result.forEach(r => r.picks.sort((a, b) => Number(a.season) - Number(b.season) || a.round - b.round || Number(a.roster_id) - Number(b.roster_id)));
    return result;
  }

  const api = { matchRankings, rankingScoreMap, playerNameKey, players, league, withPicks, pickLabel, pickScore, originName, escapeHTML, playerInfo, rosterPlayerIds, isDynastyPosition, leagueRankBands };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DynastySleeper = api;
})(globalThis);

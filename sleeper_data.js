/* Read-only Sleeper imports shared by the league tools. */
(function (root) {
  "use strict";
  const BASE = "https://api.sleeper.app/v1/";
  const pending = new Map();
  let playersPromise;
  let playersUntil = 0;
  const DAY = 24 * 60 * 60 * 1000;

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
            return data;
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
      return data;
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
    return { id, meta, rosters, users, drafts, traded };
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
    const result = rosters.map(r => ({ ...r, players: r.players || [], picks: [] }));
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

  root.DynastySleeper = { players, league, withPicks, pickLabel, pickScore, originName, escapeHTML };
})(globalThis);

// scripts/build_weekly_points_sleeper.mjs
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const OFFENSE_POS = new Set(["QB", "RB", "WR", "TE"]);

export async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Invalid data from ${url}`);
      return data;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

// Sleeper advances to the upcoming week. Never include an in-progress week.
// Keep a complete prior season until current-season medians can qualify.
export function buildPlan(state) {
  const season = Number(state.season), week = Number(state.week);
  if (!Number.isInteger(season) || season < 2020 || season > 2100 ||
      !Number.isInteger(week) || week < 0 || week > 25 ||
      !['regular','post','pre','off'].includes(state.season_type)) throw new Error('Unexpected Sleeper season state; keeping published data.');
  const current = state.season_type === 'regular' && week >= 4 || state.season_type === 'post';
  const target = current ? season : Number(state.previous_season || season - 1);
  if (!Number.isInteger(target) || target < 2020 || target > season) throw new Error('Invalid previous season.');
  return {season:String(target), through:current && state.season_type === 'regular' ? Math.min(18, week-1) : 18};
}
export function validateOutput(out, previous) {
  const entries = Object.values(out.players);
  if (!entries.length || !entries.some(p => Object.keys(p.weeks).length >= 3)) throw new Error('No qualifying medians; keeping published data.');
  if (Number(previous?.meta?.season) > Number(out.meta.season)) throw new Error('Refusing to move published data to an earlier season.');
  if (previous?.meta?.season === out.meta.season && Number(previous.meta.week_built_through) > out.meta.week_built_through) throw new Error('Refusing to move published data backwards.');
  for (const p of entries) for (const [week, values] of Object.entries(p.weeks)) {
    if (Number(week) < 1 || Number(week) > out.meta.week_built_through || !['std','hppr','ppr'].every(key => Number.isFinite(values[key]))) throw new Error('Invalid weekly points.');
  }
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

// "Did this week count?" filter.
// Keep low-output games if the player actually played, but drop games where they barely touched the field
// (injury early, emergency snaps, etc.). These thresholds are intentionally low.
const MIN_RUSH_ATT = Number(process.env.MIN_RUSH_ATT || 2);
const MIN_TARGETS = Number(process.env.MIN_TARGETS || 2);
const MIN_PASS_ATT = Number(process.env.MIN_PASS_ATT || 8);

export async function main() {
  // 1) Season/week from Sleeper
  const state = await fetchJson("https://api.sleeper.app/v1/state/nfl");
  const {season, through} = buildPlan(state);
  console.log(`Building ${season} regular-season medians through completed week ${through}.`);

  // 2) Player map
  console.log("Downloading Sleeper players map...");
  const players = await fetchJson("https://api.sleeper.app/v1/players/nfl");
  console.log(`Players map loaded: ${Object.keys(players).length} entries`);

  // 3) Prepare output
  const out = {
    meta: {
      season,
      updated: new Date().toISOString().slice(0, 10),
      week_built_through: null,
      min_weeks_required: 3,
      source: "sleeper",
    },
    players: {},
  };

  // Helper to init player
  function ensurePlayer(pid) {
    if (out.players[pid]) return out.players[pid];

    const p = players[pid];
    if (!p) return null;

    const pos = p.position || "";
    if (!OFFENSE_POS.has(pos)) return null;

    const name =
      p.full_name ||
      (p.first_name && p.last_name ? `${p.first_name} ${p.last_name}` : null) ||
      p.player_id ||
      pid;

    const team = p.team || "";

    out.players[pid] = { name, pos, team, weeks: {} };
    return out.players[pid];
  }

  // 4) Rebuild only completed weeks, including any later stat corrections.
  let lastWeekWithStats = 0;
  for (let wk = 1; wk <= through; wk++) {
    const url = `https://api.sleeper.app/v1/stats/nfl/regular/${season}/${wk}`;
    console.log(`Downloading week ${wk}: ${url}`);

    const weekStats = await fetchJson(url);
    if (!weekStats || Object.keys(weekStats).length === 0) {
      throw new Error(`No stats for completed week ${wk}; keeping published data.`);
    }
    lastWeekWithStats = wk;

    // weekStats is an object keyed by player_id (and some TEAM entries)
    for (const pid of Object.keys(weekStats)) {
      // Skip team defenses and weird keys
      if (pid.startsWith("TEAM ")) continue;

      const s = weekStats[pid];
      if (!s) continue;

      // Only count weeks where they were active (your “no stats / bye / DNP” rule)
      // gms_active is usually 1.0 when they played
      const active = toNum(s.gms_active);
      if (active <= 0) continue;

      const playerObj = ensurePlayer(pid);
      if (!playerObj) continue;

      // Points are already computed by Sleeper for each scoring format
      const std = round2(toNum(s.pts_std));
      const hppr = round2(toNum(s.pts_half_ppr));
      const ppr = round2(toNum(s.pts_ppr));

      // Opportunity-based qualifier:
      // include almost all real games, but drop the "barely played" outliers.
      const passAtt = toNum(s.pass_att ?? s.passing_att ?? s.passing_attempts);
      const rushAtt = toNum(s.rush_att ?? s.rushing_att ?? s.carries);
      const targets = toNum(s.rec_tgt ?? s.receiving_targets ?? s.targets);

      const qualifies =
        passAtt >= MIN_PASS_ATT ||
        rushAtt >= MIN_RUSH_ATT ||
        targets >= MIN_TARGETS;

      if (!qualifies) continue;

      playerObj.weeks[String(wk)] = { std, hppr, ppr };
    }
  }

  // Meta: anchor "last N weeks" to the last week that actually has stats.
  out.meta.week_built_through = lastWeekWithStats;

  // 5) Write output files
  const outDir = process.env.WEEKLY_OUTPUT_DIR || path.join(process.cwd(), "data");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const currentPath = path.join(outDir, "weekly_points_current.json");
  const seasonPath = path.join(outDir, `weekly_points_${season}.json`);

  const previous = fs.existsSync(currentPath) ? JSON.parse(fs.readFileSync(currentPath, 'utf8')) : null;
  validateOutput(out, previous);
  const comparable = value => JSON.stringify({...value, meta:{...value.meta, updated:null}});
  if (previous && comparable(previous) === comparable(out) && fs.existsSync(seasonPath)) {
    console.log('No weekly data changes.'); return;
  }
  const serialized = JSON.stringify(out);
  // All network requests and validation finish before either published file changes.
  for (const file of [seasonPath, currentPath]) {
    fs.writeFileSync(file + '.tmp', serialized);
    fs.renameSync(file + '.tmp', file);
  }

  console.log(`✅ Wrote: ${currentPath}`);
  console.log(`✅ Wrote: ${seasonPath}`);
  console.log(`Players in file: ${Object.keys(out.players).length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((err) => {
  console.error(err);
  process.exit(1);
});

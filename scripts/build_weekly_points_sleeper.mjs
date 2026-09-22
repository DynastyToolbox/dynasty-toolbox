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
// Roll across seasons using completed regular-season weeks 1–17 only.
export function buildPlan(state) {
  const season = Number(state.season), week = Number(state.week);
  if (!Number.isInteger(season) || season < 2020 || season > 2100 ||
      !Number.isInteger(week) || week < 0 || week > 25 ||
      !['regular','post','pre','off'].includes(state.season_type)) throw new Error('Unexpected Sleeper season state; keeping published data.');
  const current = state.season_type === 'regular' && week >= 2 || state.season_type === 'post' || state.season_type === 'off' && state.season_has_scores === true;
  const target = current ? season : Number(state.previous_season || season - 1);
  if (!Number.isInteger(target) || target < 2020 || target > season) throw new Error('Invalid previous season.');
  const through = current && state.season_type === 'regular' ? Math.min(17, week-1) : 17;
  const slots = [];
  for (let w=through+1; w<=17; w++) slots.push({season:String(target-1),week:w});
  for (let w=1; w<=through; w++) slots.push({season:String(target),week:w});
  return {season:String(target), through, slots};
}
export function validateOutput(out, previous) {
  const entries = Object.values(out.players);
  if (!entries.length || !entries.some(p => Object.keys(p.weeks).length >= 3)) throw new Error('No qualifying medians; keeping published data.');
  if (Number(previous?.meta?.season) > Number(out.meta.season)) throw new Error('Refusing to move published data to an earlier season.');
  if (previous?.meta?.season === out.meta.season && Math.min(17,Number(previous.meta.week_built_through)) > out.meta.week_built_through) throw new Error('Refusing to move published data backwards.');
  if (out.meta.week_slots) {
    const slots=out.meta.week_slots;
    if (slots.length!==17 || slots.some((s,i)=>!Number.isInteger(s.week)||s.week<1||s.week>17||!/^\d{4}$/.test(s.season)||i>0&&Number(s.season)*17+s.week!==Number(slots[i-1].season)*17+slots[i-1].week+1)) throw new Error('Invalid rolling week window.');
    const last=slots.at(-1);
    if(last.season!==out.meta.season||last.week!==out.meta.week_built_through)throw new Error('Invalid window endpoint.');
  }
  for (const p of entries) for (const [week, values] of Object.entries(p.weeks)) {
    if (!Number.isInteger(Number(week)) || Number(week) < 1 || Number(week) > (out.meta.week_slots?.length || out.meta.week_built_through) || !['std','hppr','ppr'].every(key => Number.isFinite(values[key])) || values.snap!=null&&(!Number.isFinite(values.snap)||values.snap<0||values.snap>100)) throw new Error('Invalid weekly points.');
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

export function qualifyingPoints(s) {
  if(toNum(s.gms_active)<=0)return null;
  const qualifies=toNum(s.pass_att ?? s.passing_att ?? s.passing_attempts)>=MIN_PASS_ATT || toNum(s.rush_att ?? s.rushing_att ?? s.carries)>=MIN_RUSH_ATT || toNum(s.rec_tgt ?? s.receiving_targets ?? s.targets)>=MIN_TARGETS;
  if(!qualifies)return null;
  // Missing snap counts keep the existing opportunity fallback; an explicit zero is not missing.
  const snap=s.off_snp!=null&&toNum(s.tm_off_snp)>0 ? Math.min(100,100*toNum(s.off_snp)/toNum(s.tm_off_snp)) : null;
  if(snap!==null&&snap<40)return null;
  // Sleeper omits zero-valued stats (including points for active, zero-catch games).
  const points={std:Number(s.pts_std??0),hppr:Number(s.pts_half_ppr??0),ppr:Number(s.pts_ppr??0),snap};
  if(!['std','hppr','ppr'].every(key=>Number.isFinite(points[key])))throw new Error('Invalid weekly scoring fields; keeping published data.');
  for(const key of ['std','hppr','ppr'])points[key]=round2(points[key]);
  return points;
}

export async function main() {
  // 1) Season/week from Sleeper
  const state = await fetchJson("https://api.sleeper.app/v1/state/nfl");
  const {season, through, slots} = buildPlan(state);
  console.log(`Building ${season} regular-season medians through completed week ${through}.`);

  // 2) Player map
  console.log("Downloading Sleeper players map...");
  const players = await fetchJson("https://api.sleeper.app/v1/players/nfl");
  console.log(`Players map loaded: ${Object.keys(players).length} entries`);

  // 3) Prepare output
  const out = {
    meta: {
      season,
      schema_version: 2,
      week_slots: slots,
      excluded_weeks: [18],
      snap_pct_min: 40,
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
  for (const [index, slot] of slots.entries()) {
    const wk=slot.week;
    const url = `https://api.sleeper.app/v1/stats/nfl/regular/${slot.season}/${wk}`;
    console.log(`Downloading ${slot.season} week ${wk}.`);

    const weekStats = await fetchJson(url);
    if (!weekStats || Object.keys(weekStats).length === 0) {
      throw new Error(`No stats for completed week ${wk}; keeping published data.`);
    }

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

      const points=qualifyingPoints(s);
      if(points)playerObj.weeks[String(index+1)] = points;
    }
  }

  // Meta: anchor "last N weeks" to the last week that actually has stats.
  out.meta.week_built_through = through;

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

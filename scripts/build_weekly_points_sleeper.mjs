// scripts/build_weekly_points_sleeper.mjs
import fs from "fs";
import path from "path";
import https from "https";

const OFFENSE_POS = new Set(["QB", "RB", "WR", "TE"]);

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const code = res.statusCode || 0;

        // Follow redirects if any
        if ([301, 302, 303, 307, 308].includes(code)) {
          const next = res.headers.location;
          res.resume();
          if (!next) return reject(new Error(`Redirect (${code}) with no Location for ${url}`));
          const nextUrl = next.startsWith("http") ? next : new URL(next, url).toString();
          return resolve(fetchJson(nextUrl));
        }

        if (code !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${code} for ${url}`));
        }

        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
          }
        });
      })
      .on("error", reject);
  });
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

async function main() {
  // 1) Season/week from Sleeper
  const state = await fetchJson("https://api.sleeper.app/v1/state/nfl");
  const season = state.season;              // "2025"
  const currentWeek = Number(state.week);   // 16
  const seasonType = state.season_type;     // "regular"

  if (seasonType !== "regular") {
    console.log(`Note: season_type is ${seasonType}. This script expects regular season.`);
  }

  console.log(`Sleeper state: season=${season}, week=${currentWeek}, type=${seasonType}`);

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
      p.first_name && p.last_name ? `${p.first_name} ${p.last_name}` :
      p.player_id ||
      pid;

    const team = p.team || "";

    out.players[pid] = { name, pos, team, weeks: {} };
    return out.players[pid];
  }

  // 4) Loop weeks 1..currentWeek, but stop once Sleeper stops returning stats.
  // This keeps the UI's "Last 5 weeks" anchored to the last *completed* week.
  let lastWeekWithStats = 0;
  for (let wk = 1; wk <= currentWeek; wk++) {
    const url = `https://api.sleeper.app/v1/stats/nfl/regular/${season}/${wk}`;
    console.log(`Downloading week ${wk}: ${url}`);

    const weekStats = await fetchJson(url);
    if (!weekStats || Object.keys(weekStats).length === 0) {
      console.log(`(no stats yet) week ${wk} — stopping downloads at week ${wk - 1}`);
      break;
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
  out.meta.week_built_through = lastWeekWithStats || Math.max(0, currentWeek - 1);

  // 5) Write output files
  const outDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const currentPath = path.join(outDir, "weekly_points_current.json");
  const seasonPath = path.join(outDir, `weekly_points_${season}.json`);

  fs.writeFileSync(currentPath, JSON.stringify(out));
  fs.writeFileSync(seasonPath, JSON.stringify(out));

  console.log(`✅ Wrote: ${currentPath}`);
  console.log(`✅ Wrote: ${seasonPath}`);
  console.log(`Players in file: ${Object.keys(out.players).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

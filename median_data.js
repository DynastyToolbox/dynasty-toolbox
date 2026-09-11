(function(root) {
'use strict';
const MIN_WEEKS_REQUIRED = 3, SNAP_PCT_MIN = 40;
    function safeNum(n) {
      const x = Number(n);
      return Number.isFinite(x) ? x : 0;
    }

    function median(arr) {
      const a = arr.slice().sort((x, y) => x - y);
      if (!a.length) return 0;
      const mid = Math.floor(a.length / 2);
      return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
    }

    function mean(arr) {
      if (!arr.length) return 0;
      return arr.reduce((s, x) => s + x, 0) / arr.length;
    }

    function getMaxWeek(meta, players) {
      const fromMeta = safeNum(meta && meta.week_built_through);
      if (fromMeta) return fromMeta;
      // fallback: scan weeks
      let maxW = 0;
      for (const pid in players) {
        const weeks = players[pid].weeks || {};
        for (const wkStr in weeks) maxW = Math.max(maxW, safeNum(wkStr));
      }
      return maxW || 1;
    }

    function pickWindowWeeks(windowKey, maxWeek) {
      if (windowKey === "season") return { start: 1, end: maxWeek };
      const n = windowKey === "last5" ? 5 : windowKey === "last7" ? 7 : 10;
      return { start: Math.max(1, maxWeek - n + 1), end: maxWeek };
    }

    function qualifiesWeek(weekObj) {
      if (!weekObj) return false;
      const snap = safeNum(weekObj.snap);
      // If older JSON has no snap field, fall back to "any record exists"
      if (!snap) return true;
      return snap >= SNAP_PCT_MIN;
    }

    function computePlayerRow(pid, p, scoringKey, windowKey, maxWeek) {
      const weeks = p.weeks || {};
      const { start, end } = pickWindowWeeks(windowKey, maxWeek);

      const pts = [];
      for (let wk = start; wk <= end; wk++) {
        const w = weeks[String(wk)];
        if (!w) continue;
        if (!qualifiesWeek(w)) continue;
        pts.push(safeNum(w[scoringKey]));
      }

      if (pts.length < MIN_WEEKS_REQUIRED) return null;

      const med = median(pts);
      const avg = mean(pts);
      const diff = avg - med;

      return {
        id: pid,
        name: p.name || "",
        pos: p.pos || "",
        team: p.team || "",
        games: pts.length,
        median: med,
        avg: avg,
        diff: diff,
      };
    }


    const POSITIONS = ['QB','RB','WR','TE','FLX','SFLX'];
    function bestLineup(rows, counts) {
      const used = new Set(), lineup = [];
      const candidates = rows.filter(r => Number.isFinite(r.median))
        .slice().sort((a,b) => b.median-a.median || String(a.id).localeCompare(String(b.id)));
      // These eligibility sets are nested: fixed positions, then FLEX, then Superflex.
      // Fill scarce positions first, regardless of the order the buttons were pressed.
      for (const slot of POSITIONS) {
        const eligible = slot === 'FLX' ? ['RB','WR','TE'] : slot === 'SFLX' ? ['QB','RB','WR','TE'] : [slot];
        const count = Math.max(0, Math.min(30, Math.floor(Number(counts[slot]) || 0)));
        for (let i=0; i<count; i++) {
          const player = candidates.find(r => !used.has(String(r.id)) && eligible.includes(r.pos)) || null;
          if (player) used.add(String(player.id));
          lineup.push({slot, number:i+1, player});
        }
      }
      return lineup;
    }
    const api = {safeNum, median, mean, getMaxWeek, pickWindowWeeks, qualifiesWeek, computePlayerRow, bestLineup, POSITIONS};
    if (typeof module !== 'undefined' && module.exports) module.exports=api;
    root.DynastyMedian=api;
})(globalThis);

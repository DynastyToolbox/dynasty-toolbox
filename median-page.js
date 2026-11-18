'use strict';

    // Nav load (match other pages)
    fetch("nav.html")
      .then(r => r.text())
      .then(html => document.getElementById("nav-placeholder").innerHTML = html)
      .catch(() => { /* keep page usable */ });



    // Fixed rules
    const MIN_WEEKS_REQUIRED = 3;
    const SNAP_PCT_MIN = 40; // must match your build script default

    let rawData = null;
    let rankingsRows = [];
    let sortState = { key: "median", dir: "desc" };
    let compareSortState = { key: "median", dir: "desc" };

    const {safeNum, getMaxWeek, computePlayerRow} = DynastyMedian;
    window.DynastyMedianPage = {get data() {return rawData;}};

    function buildRankings() {
      if (!rawData) return;
      const search = (document.getElementById("searchInput").value || "").toLowerCase().trim();
      const pos = document.getElementById("posFilter").value;
      const scoring = document.getElementById("scoringFilter").value;
      const windowKey = document.getElementById("windowFilter").value;

      const players = rawData.players || {};
      const maxWeek = getMaxWeek(rawData.meta, players);

      document.getElementById('median-season-context').textContent = `${DynastyMedian.windowLabel(rawData.meta,windowKey)} · At least 3 qualifying games`;
      const rows = [];

      for (const pid in players) {
        const p = players[pid];

        if (pos !== "ALL" && p.pos !== pos) continue;
        if (search && !(p.name || "").toLowerCase().includes(search)) continue;

        const row = computePlayerRow(pid, p, scoring, windowKey, maxWeek);
        if (!row) continue;

        rows.push(row);
      }

      rankingsRows = rows;
      applySortAndRender();
      renderCompareTable(); // keep comparator synced
      window.dispatchEvent(new Event("dynasty-median-change"));
    }

    function sortRows(rows, state) {
      const dirMul = state.dir === "asc" ? 1 : -1;
      const key = state.key;

      return rows.slice().sort((a, b) => {
        if (key === "name" || key === "pos" || key === "team") {
          return (String(a[key]).localeCompare(String(b[key])) || (b.median - a.median)) * dirMul;
        }
        return (safeNum(a[key]) - safeNum(b[key])) * dirMul;
      });
    }

    function applySortAndRender() {
      const tbody = document.getElementById("rankingsTbody");
      const rows = sortRows(rankingsRows, sortState);

      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="muted">No players match the current filters.</td></tr>';
        return;
      }

      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.pos)}</td>
          <td>${escapeHtml(r.team)}</td>
          <td class="right">${r.games}</td>
          <td class="right">${r.median.toFixed(2)}</td>
          <td class="right">${r.avg.toFixed(2)}</td>
          <td class="right">${r.diff.toFixed(2)}</td>
        </tr>
      `).join("");
    }

    function escapeHtml(str) {
      return String(str || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function wireSorting(tableId, stateObj, onChange) {
      const table = document.getElementById(tableId);
      table.querySelectorAll("th[data-sort]").forEach(th => {
        th.addEventListener("click", () => {
          const key = th.dataset.sort;
          if (stateObj.key === key) {
            stateObj.dir = stateObj.dir === "asc" ? "desc" : "asc";
          } else {
            stateObj.key = key;
            stateObj.dir = (key === "name" || key === "pos" || key === "team") ? "asc" : "desc";
          }
          onChange();
        });
      });
    }

    // Comparator
    function getCompareIds() {
      const names = [
        document.getElementById("compare1").value,
        document.getElementById("compare2").value,
        document.getElementById("compare3").value,
      ].map(s => (s || "").trim()).filter(Boolean);

      if (!names.length) return [];

      // build a name->id map from current rankingsRows (already filtered by pos/scoring/window)
      const byName = new Map();
      for (const r of rankingsRows) {
        byName.set(r.name.toLowerCase(), r.id);
      }

      const ids = [];
      for (const n of names) {
        const id = byName.get(n.toLowerCase());
        if (id && !ids.includes(id)) ids.push(id);
      }
      return ids;
    }

    function renderCompareTable() {
      const tbody = document.getElementById("compareTbody");
      if (!rawData) return;

      const players = rawData.players || {};
      const scoring = document.getElementById("scoringFilter").value;
      const windowKey = document.getElementById("windowFilter").value;
      const maxWeek = getMaxWeek(rawData.meta, players);

      const ids = getCompareIds();
      if (!ids.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="muted">Add players above to compare.</td></tr>';
        return;
      }

      const rows = [];
      for (const pid of ids) {
        const p = players[pid];
        if (!p) continue;
        const row = computePlayerRow(pid, p, scoring, windowKey, maxWeek);
        if (row) rows.push(row);
      }

      const sorted = sortRows(rows, compareSortState);

      tbody.innerHTML = sorted.map(r => `
        <tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.pos)}</td>
          <td>${escapeHtml(r.team)}</td>
          <td class="right">${r.games}</td>
          <td class="right">${r.median.toFixed(2)}</td>
          <td class="right">${r.avg.toFixed(2)}</td>
          <td class="right">${r.diff.toFixed(2)}</td>
        </tr>
      `).join("");
    }

    // Autocomplete (lightweight: datalist-style suggestions using current ranking names)
    function wireAutocomplete(inputId) {
      const input = document.getElementById(inputId);
      let box = null;

      function close() {
        if (box) { box.remove(); box = null; }
      }

      function open(matches) {
        close();
        box = document.createElement("div");
        box.style.position = "absolute";
        box.style.zIndex = 9999;
        box.style.background = "#fff";
        box.style.border = "1px solid #ccc";
        box.style.borderRadius = "10px";
        box.style.boxShadow = "0 6px 18px rgba(0,0,0,0.12)";
        box.style.maxHeight = "220px";
        box.style.overflowY = "auto";
        box.style.fontFamily = "Open Sans, sans-serif";
        box.style.fontSize = "13px";

        const rect = input.getBoundingClientRect();
        box.style.left = (rect.left + window.scrollX) + "px";
        box.style.top = (rect.bottom + window.scrollY + 6) + "px";
        box.style.width = rect.width + "px";

        matches.slice(0, 12).forEach(name => {
          const item = document.createElement("div");
          item.textContent = name;
          item.style.padding = "10px 12px";
          item.style.cursor = "pointer";
          item.addEventListener("mouseenter", () => item.style.background = "#e9f7f6");
          item.addEventListener("mouseleave", () => item.style.background = "#fff");
          item.addEventListener("mousedown", (e) => {
            e.preventDefault();
            input.value = name;
            close();
            if (inputId.startsWith("compare")) renderCompareTable();
            else buildRankings();
          });
          box.appendChild(item);
        });

        document.body.appendChild(box);
      }

      input.addEventListener("input", () => {
        const q = (input.value || "").trim().toLowerCase();
        if (!q || !rankingsRows.length) { close(); return; }

        const matches = rankingsRows
          .map(r => r.name)
          .filter(n => n.toLowerCase().includes(q));

        if (!matches.length) close();
        else open(matches);
      });

      input.addEventListener("blur", () => setTimeout(close, 120));
      window.addEventListener("scroll", close, { passive: true });
      window.addEventListener("resize", close);
      window.addEventListener('dynasty-premium-clear', close);
    }

    function wireControls() {

        // Wire controls
        ["searchInput","posFilter","scoringFilter","windowFilter"].forEach(id => {
          document.getElementById(id).addEventListener("input", buildRankings);
          document.getElementById(id).addEventListener("change", buildRankings);
        });

        ["compare1","compare2","compare3"].forEach(id => {
          document.getElementById(id).addEventListener("input", renderCompareTable);
          wireAutocomplete(id);
        });

        wireAutocomplete("searchInput");

        wireSorting("rankingsTable", sortState, applySortAndRender);
        wireSorting("compareTable", compareSortState, renderCompareTable);

    }
    wireControls();
    DynastyPremiumPage.start({feature:'medianRankings',
      async load(isCurrent) {
        const result = await DynastyAccount.request('median-data');
        if (!isCurrent()) return;
        rawData = result.data;
        buildRankings();
      },
      clear() {
        rawData = null; rankingsRows = [];
        document.getElementById('rankingsTbody').replaceChildren();
        document.getElementById('compareTbody').replaceChildren();
        ['searchInput','compare1','compare2','compare3'].forEach(id=>{document.getElementById(id).value='';});
        document.querySelectorAll('.autocomplete-list').forEach(el=>el.replaceChildren());
        window.dispatchEvent(new Event('dynasty-premium-clear'));
      }
    });

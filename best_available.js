/* ---------- Config ---------- */
let waiverPlayers = [];
let sortField = "score";
let sortAsc = false;

function normalizeId(v){
    return String(v).trim();
}

let availableLeague = null;
let availableLoading = false;
async function loadLeague(refresh = true) {
  const leagueId = document.getElementById("leagueInput").value.trim();
  if (!leagueId || availableLoading) return;
  availableLoading = true;
  const button = document.getElementById("loadAvailableBtn");
  const select = document.getElementById("rankingType");
  button.disabled = select.disabled = true;
  waiverPlayers = [];
  document.getElementById("waiverTable").innerHTML = "<tr><td colspan='5'>Loading...</td></tr>";
  try {
    const [rankingMap, sleeperPlayers, bundle] = await Promise.all([
      fetchRankingMap(select.value),
      DynastySleeper.players(),
      refresh || availableLeague?.id !== leagueId ? DynastySleeper.league(leagueId, { picks: false }) : availableLeague
    ]);
    const owned = new Set();
    bundle.rosters.forEach(r => {
      ["players", "reserve", "taxi", "starters"].forEach(key => {
        if (Array.isArray(r[key])) r[key].forEach(id => owned.add(normalizeId(id)));
      });
    });
    const rows = Object.values(rankingMap).map(r=>({Player:r.name,Position:r.pos,ranked:r}));
    const freeAgents = [];
    for (const [id,row] of DynastySleeper.matchRankings(rows,sleeperPlayers).byId) {
      const ranked = row.ranked;
      const sleeper = DynastySleeper.playerInfo(id,sleeperPlayers);
      if (owned.has(normalizeId(sleeper.player_id))) continue;
      freeAgents.push({ id: sleeper.player_id, name: ranked.name, pos: sleeper.position,
        team: sleeper.team || ranked.team || "-", age: sleeper.age || ranked.age || "?", score: Number(ranked.score) });
    }
    availableLeague = bundle;
    waiverPlayers = freeAgents.sort((a,b) => b.score - a.score);
    renderTable();
    try { if (window.DynastyAccount?.allowsHistory()) localStorage.setItem("best_available_league", leagueId); } catch (_) {}
    storeLeague(leagueId, bundle.meta.name);
  } catch (error) {
    availableLeague = null;
    document.getElementById("waiverTable").innerHTML = `<tr><td colspan="5">${DynastySleeper.escapeHTML(error.message || "Unable to load league. Please try again.")}</td></tr>`;
  } finally {
    availableLoading = false;
    button.disabled = select.disabled = false;
  }
}

function handleRankingChange() {
  const input = document.getElementById("leagueInput");
  let leagueId = input ? input.value.trim() : "";

  // If input is blank, fall back to last used league
  if (!leagueId && window.DynastyAccount?.allowsHistory()) {
    leagueId = localStorage.getItem("best_available_league") || "";
    if (input && leagueId) input.value = leagueId;
  }

  if (!leagueId) {
    // No league yet – nothing to rebuild, just re-render existing table
    renderTable();
    return;
  }

  // Re-run full load using the new rankingType
  loadLeague(false);
}




/* Recent League Storage (shared with other pages) */
function getAvailableRecents() {
  if (!window.DynastyAccount?.allowsHistory()) return [];
  try {
    const list = JSON.parse(localStorage.getItem("recent_leagues") || "[]");
    return Array.isArray(list) ? list.map(item => typeof item === "object" ? item : { id: String(item), name: String(item) }).filter(item => item?.id).slice(0, 5) : [];
  } catch (_) { return []; }
}
function storeLeague(id, name) {
  if (!window.DynastyAccount?.allowsHistory()) return;
  const list = [{ id, name: name || id }, ...getAvailableRecents().filter(item => item.id !== id)].slice(0, 5);
  try { localStorage.setItem("recent_leagues", JSON.stringify(list)); } catch (_) {}
  renderRecent();
}
function renderRecent() {
  const box = document.getElementById("recentLeagues");
  if (!box) return;
  box.innerHTML = "";
  getAvailableRecents().forEach(item => {
    const button = document.createElement("button");
    button.className = "recent-league-btn";
    button.textContent = item.name || item.id;
    button.onclick = () => {
      document.getElementById("leagueInput").value = item.id;
      loadLeague();
    };
    box.appendChild(button);
  });
}
renderRecent();
window.addEventListener("dynasty-account-change", renderRecent);

function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/[.\']/g, "") // remove periods and apostrophes: C.J. -> cj, D'Andre -> dandre
    .trim();
}


async function fetchRankingMap(type){
  const rows = await DynastyRankings.getRows(type);
  const map = {};
  rows.forEach(row => {
    if (!row.Player || !row.Score) return;
    const score = Number(row.Score);
    if (Number.isNaN(score)) return;
    map[normalizeName(row.Player)] = {
      name: row.Player, team: row.Team || "", age: row.Age,
      pos: row.Position.toUpperCase(), score
    };
  });
  return map;
}


/* ---------- Render Table ---------- */
function renderTable(){
    const allowed=[...document.querySelectorAll(".pos-box:checked")].map(b=>b.value);

    let data=waiverPlayers.filter(p=>allowed.includes(p.pos));

    data.sort((a,b)=>{
        let A=a[sortField],B=b[sortField];
        return sortAsc?(A>B?1:-1):(A<B?1:-1);
    });

    document.getElementById("waiverTable").innerHTML =
        data.map(p=>`
        <tr>
            <td>${p.name}</td>
            <td>${p.pos}</td>
            <td>${p.team}</td>
            <td>${p.age}</td>
            <td class="right">${p.score.toFixed(2)}</td>
        </tr>
        `).join("") || "<tr><td colspan=5>No players match filters.</td></tr>";
}

/* ---------- Sorting ---------- */
function sortBy(field){
    if(sortField===field) sortAsc=!sortAsc;
    else{sortField=field;sortAsc=false;}
    renderTable();
}

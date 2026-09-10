/* ---------- Config ---------- */
let waiverPlayers = [];
let sortField = "score";
let sortAsc = false;

function normalizeId(v){
    return String(v).trim();
}

async function loadLeague() {
    const leagueId = document.getElementById("leagueInput").value.trim();
    if (!leagueId) return;

    localStorage.setItem("best_available_league", leagueId);
    storeLeague(leagueId);

    document.getElementById("waiverTable").innerHTML =
        "<tr><td colspan='5'>Loading...</td></tr>";

    const rankingType = document.getElementById("rankingType").value;
    const rankingMap = await fetchRankingMap(rankingType);
    const sleeperPlayers = await fetch("https://api.sleeper.app/v1/players/nfl").then(r=>r.json());
    const rosters = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r=>r.json());

 const owned = new Set();

rosters.forEach(r => {
    ["players","reserve","taxi","starters"].forEach(key=>{
        if (Array.isArray(r[key])) {
            r[key].forEach(id => owned.add(normalizeId(id)));
        }
    });

    if (r.player_map) {  // some leagues store players here
        Object.values(r.player_map).forEach(id => owned.add(normalizeId(id)));
    }
});


    console.log("Owned contains Walker?",
    [...owned].some(id => id == "11564" || id == 11564),
    "Owned IDs example:", [...owned].slice(0,50)
);


    const freeAgents = [];

    for (const key in rankingMap) {
        const ranked = rankingMap[key];
        const nameKey = normalizeName(ranked.name);

        const sleeper = Object.values(sleeperPlayers).find(sp => {
    const s = normalizeName(sp.full_name);

    // Exact match first = safest
    if (s === nameKey) return true;

    // Allow match without suffix (III Jr II Sr) but only at end of name
    const base = s.replace(/\b(iii|ii|iv|jr|sr)\b/g,"").trim();
    const baseKey = nameKey.replace(/\b(iii|ii|iv|jr|sr)\b/g,"").trim();

    return base === baseKey;
});



       if (!sleeper) continue;

const sid = normalizeId(sleeper.player_id);
if (owned.has(sid)) continue; // blocks Walker, Thomas, etc.
    // If rankings file has a position, require it to match Sleeper's position
    if (ranked.pos && sleeper.position && ranked.pos !== sleeper.position) {
        continue;
    }


        freeAgents.push({
            id: sleeper.player_id,
            name: ranked.name,
            pos: sleeper.position,
            team: sleeper.team || ranked.team || "-",
            age: sleeper.age || ranked.age || "?",
            score: Number(ranked.score)
        });
    }

    waiverPlayers = freeAgents.sort((a,b)=> b.score - a.score);
    renderTable();
}

function handleRankingChange() {
  const input = document.getElementById("leagueInput");
  let leagueId = input ? input.value.trim() : "";

  // If input is blank, fall back to last used league
  if (!leagueId) {
    leagueId = localStorage.getItem("best_available_league") || "";
    if (input && leagueId) input.value = leagueId;
  }

  if (!leagueId) {
    // No league yet – nothing to rebuild, just re-render existing table
    renderTable();
    return;
  }

  // Re-run full load using the new rankingType
  loadLeague();
}




/* Recent League Storage (shared with other pages) */
function storeLeague(id){
  const strId = String(id);
  let list = JSON.parse(localStorage.getItem("recent_leagues") || "[]");

  // Keep unique, newest first
  list = list.filter(x => String(x) !== strId);
  list.unshift(strId);
  if (list.length > 5) list = list.slice(0, 5);

  localStorage.setItem("recent_leagues", JSON.stringify(list));
  renderRecent();
}

async function renderRecent(){
  const box = document.getElementById("recentLeagues");
  if (!box) return;

  box.innerHTML = "";

  const list = JSON.parse(localStorage.getItem("recent_leagues") || "[]").slice(0, 5);

  for (const id of list) {
    try {
      const info = await fetch(`https://api.sleeper.app/v1/league/${id}`).then(r => r.json());
      const label = info.name || id;

      const b = document.createElement("button");
      b.className = "recent-league-btn";
      b.innerText = label;
      b.onclick = () => {
        const input = document.getElementById("leagueInput");
        if (input) input.value = id;
        loadLeague();
      };
      box.appendChild(b);
    } catch (e) {
      console.error("Failed to load league name for", id, e);
    }
  }
}

/* initial render */
renderRecent();


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

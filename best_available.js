/* ---------- Config ---------- */
const RANKING_FILES = {
      competing: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQPMs1DdGgohxRyuKn95x0xIXNOmMLhFFlAf7Bh4yym02mISdp1sp_XrtmAVJwoxcOsSyls_4as-Yi8/pub?gid=0&single=true&output=csv",
      overall:   "https://docs.google.com/spreadsheets/d/e/2PACX-1vQPMs1DdGgohxRyuKn95x0xIXNOmMLhFFlAf7Bh4yym02mISdp1sp_XrtmAVJwoxcOsSyls_4as-Yi8/pub?gid=116299513&single=true&output=csv",
      tanking:   "https://docs.google.com/spreadsheets/d/e/2PACX-1vQPMs1DdGgohxRyuKn95x0xIXNOmMLhFFlAf7Bh4yym02mISdp1sp_XrtmAVJwoxcOsSyls_4as-Yi8/pub?gid=1543093851&single=true&output=csv"
    };
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
    const rankingMap = await fetchCSV(RANKING_FILES[rankingType]);
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


async function fetchCSV(url){
  const text = await fetch(url).then(r => r.text());
  const rows = text.trim().split(/\r?\n/);
  const map = {};

  if (rows.length <= 1) return map;

const header = rows[0].split(",");
const lowerHeader = header.map(h => h.toLowerCase());

// Try to detect columns by name
const nameIdx  = lowerHeader.findIndex(h => h.includes("player"));
let scoreIdx   = lowerHeader.findIndex(h => h.includes("score"));
const teamIdx  = lowerHeader.findIndex(h => h.includes("team"));
const ageIdx   = lowerHeader.findIndex(h => h.includes("age"));
const posIdx   = lowerHeader.findIndex(
  h => h === "pos" || h.includes("position")
);


  // Fallback: if we didn't find "score" by name, assume last column is score
  if (scoreIdx === -1) scoreIdx = header.length - 1;

  rows.slice(1).forEach(line => {
    if (!line.trim()) return;
    const cols = line.split(",");
    const rawName  = (cols[nameIdx]  || "").trim();
    const rawScore = (cols[scoreIdx] || "").trim();

    if (!rawName || !rawScore) return;
    const score = Number(rawScore);
    if (Number.isNaN(score)) return;

    const key = normalizeName(rawName);

   map[key] = {
  name: rawName,
  team: teamIdx !== -1 ? (cols[teamIdx] || "").trim() : "",
  age:  ageIdx !== -1  ? (cols[ageIdx]  || "").trim() : "",
  pos:  posIdx !== -1  ? (cols[posIdx]  || "").trim().toUpperCase() : "",
  score
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

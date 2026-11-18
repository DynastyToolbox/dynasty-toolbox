/* ---------- Config ---------- */
let waiverPlayers = [];
let sortField = "score";
let sortAsc = false;

let availableLoading = false, availableRequest = 0;
const availableAccess = DynastyPremiumPage.start({feature:'bestAvailable', clear() {
  availableRequest++; availableLoading=false; waiverPlayers=[];
  document.getElementById('waiverTable').replaceChildren();
  document.getElementById('loadAvailableBtn').disabled=false;
  document.getElementById('rankingType').disabled=false;
}});
async function loadLeague() {
  const leagueId = document.getElementById('leagueInput').value.trim();
  if (!leagueId || availableLoading || !availableAccess.allowed) return;
  const version=++availableRequest, accessVersion=availableAccess.revision;
  const current=()=>version===availableRequest && accessVersion===availableAccess.revision;
  availableLoading=true;
  const button=document.getElementById('loadAvailableBtn'), select=document.getElementById('rankingType');
  button.disabled=select.disabled=true;
  waiverPlayers=[];
  document.getElementById('waiverTable').innerHTML='<tr><td colspan="5">Loading…</td></tr>';
  try {
    const result=await DynastyAccount.request('available-players',{league_id:leagueId,ranking_type:select.value});
    if(!current())return;
    waiverPlayers=result.players; renderTable();
    storeLeague(leagueId,result.league.name);
  } catch(error) {
    if(!current())return;
    document.getElementById('waiverTable').innerHTML=`<tr><td colspan="5">${DynastySleeper.escapeHTML(error.message || 'Unable to load league.')}</td></tr>`;
  } finally {if(current()){availableLoading=false;button.disabled=select.disabled=false;}}
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
  loadLeague();
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
document.querySelectorAll('.pos-box').forEach(box => box.addEventListener('change', renderTable));

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
            <td>${DynastySleeper.escapeHTML(p.name)}</td>
            <td>${DynastySleeper.escapeHTML(p.pos)}</td>
            <td>${DynastySleeper.escapeHTML(p.team)}</td>
            <td>${DynastySleeper.escapeHTML(p.age)}</td>
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

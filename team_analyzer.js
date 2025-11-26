// team_analyzer.js

document.addEventListener("DOMContentLoaded", () => {
  // ─── Element refs ─────────────────────────────
  const leagueInput        = document.getElementById("analyzerLeagueId");
  const loadBtn            = document.getElementById("analyzeBtn");
  const teamDropdown       = document.getElementById("teamDropdown");
  const resultsDiv         = document.getElementById("results");
  const sideDepthPanel     = document.getElementById("sideDepthPanel");
  const depthChartType     = document.getElementById("depthChartType");
  const depthChartTeamCard = document.getElementById("depthChartTeamCard");
  const cornerstonesDiv    = document.getElementById("cornerstones");
  const lineupDiv          = document.getElementById("startingLineup");
  const needsSurplusDiv    = document.getElementById("needsSurplus");
  const tradeIdeasDiv      = document.getElementById("tradeIdeas");
  const recentLeaguesDiv   = document.getElementById("recentLeagues");

  // ─── Recent leagues (localStorage) ─────────────────────
  const STORAGE_KEY_LAST    = "dt_lastLeagueId";
  const STORAGE_KEY_RECENTS = "dt_recentLeagues";

  // Load array of { id, name }  (handles old string-only format too)
  function getRecentLeagues() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_RECENTS);
      if (!raw) return [];

      let parsed = JSON.parse(raw);

      // If older format was just ["123","456"], convert it
      if (Array.isArray(parsed)) {
        if (parsed.length && (typeof parsed[0] === "string" || typeof parsed[0] === "number")) {
          parsed = parsed.map(id => ({ id: String(id), name: String(id) }));
        } else {
          parsed = parsed.filter(l => l && l.id); // drop any bad entries
        }
      } else {
        parsed = [];
      }

      return parsed;
    } catch (e) {
      console.error("Error parsing recent leagues:", e);
      return [];
    }
  }

  // Save one league (newest first, max 10)
  function saveRecentLeague(leagueId, leagueName) {
    let list = getRecentLeagues().filter(l => l.id !== leagueId);
    list.unshift({ id: leagueId, name: leagueName });
    if (list.length > 10) list = list.slice(0, 10);

    localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(list));
    localStorage.setItem(STORAGE_KEY_LAST, leagueId);
  }

  // Render buttons under the input
  function renderRecentLeagues() {
    const container = recentLeaguesDiv;
    if (!container) return;

     const list = getRecentLeagues().filter(l => l && l.id);
    container.innerHTML = "";

    if (!list.length) return;

    const title = document.createElement("div");
    title.textContent = "Recent leagues:";
    title.style.marginTop = "12px";
    container.appendChild(title);

    list.forEach(lg => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "recent-league-btn";
      btn.textContent = lg.name || lg.id;
      btn.onclick = () => {
  leagueInput.value = lg.id;
  loadBtn.click();   // ✅ automatically loads teams
};
      container.appendChild(btn);
    });
  }
   

  // hide until data loaded
  [teamDropdown, resultsDiv, sideDepthPanel].forEach(el => el.style.display = "none");

  // ─── Data stores ──────────────────────────────
  let allPlayers = {}, users = [], rosters = [];
  let rankings   = { competing: [], tanking: [], overall: [] };
  let lineupConfig = [];
  const rosterMap = {}, userMap = {};

  // ─── Utils ────────────────────────────────────
  const normalize = s => s ? s.toLowerCase().replace(/[^a-z0-9]/g,"") : "";
  const ordinalSuffix = n => {
    const s=["th","st","nd","rd"], v=n%100;
    return n + (s[(v-20)%10]||s[v]||s[0]);
  };

  async function fetchPlayers() {
    if (Object.keys(allPlayers).length) return allPlayers;
    allPlayers = await fetch("https://api.sleeper.app/v1/players/nfl").then(r=>r.json());
    return allPlayers;
  }

  async function fetchRankings(type) {
    const urls = {
      competing: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQPMs1DdGgohxRyuKn95x0xIXNOmMLhFFlAf7Bh4yym02mISdp1sp_XrtmAVJwoxcOsSyls_4as-Yi8/pub?gid=0&single=true&output=csv",
      overall:   "https://docs.google.com/spreadsheets/d/e/2PACX-1vQPMs1DdGgohxRyuKn95x0xIXNOmMLhFFlAf7Bh4yym02mISdp1sp_XrtmAVJwoxcOsSyls_4as-Yi8/pub?gid=116299513&single=true&output=csv",
      tanking:   "https://docs.google.com/spreadsheets/d/e/2PACX-1vQPMs1DdGgohxRyuKn95x0xIXNOmMLhFFlAf7Bh4yym02mISdp1sp_XrtmAVJwoxcOsSyls_4as-Yi8/pub?gid=1543093851&single=true&output=csv"
    };
    const csv = await fetch(urls[type]).then(r=>r.text());
    const [hdr, ...lines] = csv.trim().split("\n");
    const cols = hdr.split(",");
    return lines.map(line => {
      const vals = line.split(",");
      const obj = {};
      cols.forEach((c,i)=>obj[c.trim()]=(vals[i]||"").trim());
      return obj;
    });
  }

  function mapScores(arr) {
    const m = {};
    arr.forEach(r=>{
      if (r.Player && r.Score) m[normalize(r.Player)] = parseFloat(r.Score);
    });
    return m;
  }

  function getTop15Avg(roster, scoreMap) {
    const items = [];
    roster.players.forEach(pid => {
      const p = allPlayers[pid];
      if (!p) return;
      const sc = scoreMap[normalize(p.full_name)]||0;
      if (sc>0) items.push({pos:p.position,score:sc});
    });
    roster.picks.forEach(pk => {
      const label = `${pk.season} Round ${pk.round}`;
      const sc = scoreMap[normalize(label)]||0;
      if (sc>0) items.push({pos:"PICK",score:sc});
    });
    items.sort((a,b)=>b.score-a.score);
    const limits={QB:3,RB:5,WR:5,TE:2,PICK:8}, cnt={QB:0,RB:0,WR:0,TE:0,PICK:0}, top=[];
    for (const it of items) {
      if (cnt[it.pos]<limits[it.pos]) { top.push(it); cnt[it.pos]++; }
      if (top.length>=15) break;
    }
    const sum = top.reduce((s,i)=>s+i.score,0);
    return sum/Math.max(top.length,1);
  }

  function getStarters(roster, scoreMap) {
    if (!Array.isArray(lineupConfig) || lineupConfig.length === 0) {
      lineupConfig = ["QB","RB","RB","WR","WR","TE","FLEX","FLEX","FLEX"];
    }

    const used = new Set();
    const counts = {};
    const slots  = {};

    lineupConfig.forEach(raw => {
      let base, allowedPos;
      if (raw==="DEF") {
        base="DEF"; allowedPos=[];
      } else if (raw==="K") {
        base="K"; allowedPos=[];
      } else if (raw.toUpperCase().includes("SUPER")) {
        base="SF"; allowedPos=["QB","RB","WR","TE"];
      } else if (raw.toUpperCase().includes("FLEX")) {
        base="FLEX"; allowedPos=["RB","WR","TE"];
      } else {
        base=raw; allowedPos=[base];
      }

      counts[base] = (counts[base]||0) + 1;
      const key = (base==="DEF"||base==="K") ? base : `${base}${counts[base]}`;

      if (base==="DEF"||base==="K") {
        const entry = roster.players.map(id=>allPlayers[id]).find(p=>p&&p.position===base);
        slots[key] = { name: entry?(entry.team||base):"N/A", pos:base, score:0 };
      } else {
        const candidates = roster.players
          .map(id=> {
            const p = allPlayers[id];
            return p ? {
              name:  p.full_name,
              pos:   p.position,
              score: scoreMap[normalize(p.full_name)]||0
            } : null;
          })
          .filter(p=>p && allowedPos.includes(p.pos) && !used.has(p.name))
          .sort((a,b)=>b.score-a.score);

        if (candidates.length) {
          slots[key] = candidates[0];
          used.add(candidates[0].name);
        } else {
          slots[key] = { name:"N/A", pos:base, score:0 };
        }
      }
    });

    return slots;
  }

  // ─── Load teams & picks ─────────────────────────
  loadBtn.addEventListener("click", async ()=>{
    const lid = leagueInput.value.trim();
    if (!lid) { alert("Enter league ID"); return; }
    // ← Clear out old ranking data so fetchRankings() will run again
   rankings = { competing: [], tanking: [], overall: [] };

    loadBtn.disabled=true; loadBtn.textContent="Loading...";

    const [uData,rData,meta] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${lid}/users`).then(r=>r.json()),
      fetch(`https://api.sleeper.app/v1/league/${lid}/rosters`).then(r=>r.json()),
      fetch(`https://api.sleeper.app/v1/league/${lid}`).then(r=>r.json())
    ]);
    lineupConfig = (meta.roster_positions||meta.settings?.roster_positions||[])
      .filter(slot=>!/^B[EN]/.test(slot));

    users=uData; rosters=rData;
    users.forEach(u=>userMap[u.user_id]=u.display_name);
    rosters.forEach(r=>{ r.picks=[]; rosterMap[r.roster_id]=r; });

    const drafts = await fetch(`https://api.sleeper.app/v1/league/${lid}/drafts`)
                         .then(r=>r.json()).catch(()=>[]);
    const seasons = drafts.filter(d=>d.status==="complete").map(d=>+d.season);
    const last = seasons.length?Math.max(...seasons):0;

    const rounds = meta.settings.draft_rounds||0;
    [last+1,last+2,last+3].forEach(y=>{
      rosters.forEach(r=>{
        for(let rd=1;rd<=rounds;rd++){
          r.picks.push({
            season:String(y), round:rd,
            roster_id:r.roster_id,
            previous_owner_id:r.roster_id,
            owner_id:r.roster_id
          });
        }
      });
    });

    const traded = await fetch(`https://api.sleeper.app/v1/league/${lid}/traded_picks`)
                         .then(r=>r.json()).catch(()=>[]);
    traded.filter(p=>+p.season>last).forEach(p=>{
      const from = rosterMap[p.previous_owner_id];
      if (from) from.picks = from.picks.filter(x=>!(x.season===p.season&&x.round===p.round));
      rosterMap[p.owner_id].picks.push(p);
    });

        teamDropdown.innerHTML = "";

    // Add "Select a team" placeholder (disabled & selected)
    const placeholder = new Option("Select a team", "", true, true);
    placeholder.disabled = true;
    teamDropdown.add(placeholder);

    rosters.forEach(r => {
      const o = new Option(userMap[r.owner_id] || r.owner_id, r.roster_id);
      teamDropdown.add(o);
    });

    teamDropdown.style.display = "inline-block";
    loadBtn.disabled = false;
    loadBtn.textContent = "Load Teams";

    // Save & render recent leagues (using Sleeper league name if available)
    const leagueName = meta.name || `League ${lid}`;
    saveRecentLeague(lid, leagueName);
    renderRecentLeagues();
  });

  // ─── Main render ───────────────────────────────
  async function renderAnalysis(){
    const rid = +teamDropdown.value;
    if(!rid) return;
    const roster = rosterMap[rid];
    const owner  = userMap[roster.owner_id]||"Unknown";
    resultsDiv.style.display = sideDepthPanel.style.display = "block";

    await fetchPlayers();
    if(!rankings.competing.length){
      rankings.competing = await fetchRankings("competing");
      rankings.tanking   = await fetchRankings("tanking");
      rankings.overall   = await fetchRankings("overall");
    }
    const cMap = mapScores(rankings.competing),
          tMap = mapScores(rankings.tanking),
          oMap = mapScores(rankings.overall);

    // top-15 & ranks
    const scores = rosters.map(r=>({
      id:   r.roster_id,
      comp: getTop15Avg(r,cMap),
      tank: getTop15Avg(r,tMap),
      over: getTop15Avg(r,oMap)
    }));
    const rankOf = k=>scores.slice().sort((a,b)=>b[k]-a[k])
                           .findIndex(x=>x.id===rid) + 1;
    const compRank = rankOf("comp"),
          tankRank = rankOf("tank"),
          N        = rosters.length;


    // — New title & description logic —
    let title, desc;

    if (compRank === 1 && tankRank === 1) {
      title = "Dynasty Juggernaut";
      desc  = "You’re sitting atop the league now and have the draft capital, breakout youngsters, and proven veterans to stay there for years. Your depth chart reads like an all-star roster, so don’t hesitate to deal from surplus. Package an extra mid-round pick or borderline starter to upgrade an elite position or scoop up a potential breakout rookie. Keep a close eye on bye-week coverage and injury news, but otherwise lean into your window: swing for impact trades at the deadline, and shore up any thin spots in RB/WR depth. Your job now is to stay ahead of the curve. Anticipate opponents’ moves, diversify your upside, and defend your juggernaut crown.";
    }
    else if (compRank <= 3 && tankRank <= 3) {
      title = "Powerhouse Dynasty";
      desc  = "You’re among the top three today and the top three tomorrow. Your roster combines established stars with high-upside youth, and your draft assets are equally strong. Use our Rankings pages to spot under-the-radar sleepers you can add on the waiver wire, then leverage the trade deadline. When buyers are most aggressive, to turn surplus depth into additional picks. Hold those selections until just before the rookie draft, when demand and value peak, and then reinvest in talent that fits your long-term core. With elite present performance and a stacked pipeline, you’re set up to win now and build sustained success.";
    }
    else if (compRank <= 3 && tankRank > 3 && tankRank <= 7) {
      title = "Win-Now Contender";
      desc  = "You’ve built a lineup that’s firing on all cylinders, a top three contender, but your future stock sits squarely in the middle of the pack. To lean into this window, consider using the trade tool to move a couple of your younger stashes or mid-round picks for a proven veteran who can deliver right now. Keep an eye on the waiver wire for a high-floor streamer to cover any week-to-week gaps, but don’t be afraid to convert some long-term upside into immediate production. This is the season to cash in your future chips for present firepower. Make your moves, set your lineup, and go get that title.";
    }
    else if (compRank > 3 && compRank <= 7 && tankRank <= 3) {
      title = "Future Builder";
      desc  = "You’re sitting in the middle of the pack right now (4th–7th ranked in contending), but your real advantage is your future assets, top three in rebuilding. Harness that strength by using our trade calculator to turn a veteran fringe‐starter or a mid‐round pick into high-upside talent or additional draft capital. Look for second-year players or breakout sleepers on the waiver wire who can develop into your core pieces. Don’t be afraid to package an aging starter for a late-round pick, then reinvest that pick in a lottery ticket with league-winning potential. Your goal is simple: convert today’s depth into tomorrow’s stars so that when your window fully opens, you’ll have the firepower to seize it.";
    }
    else if (compRank > Math.ceil(N * 0.8) && tankRank > Math.ceil(N * 0.8)) {
      title = "Ground-Up Rebuild";
      desc  = "You’re in the trenches, bottom of the standings today and without much future upside, so it’s time for a full reset. Open up those bench spots and turn any veteran fringe-starter into draft capital via our trade calculator. Target lottery-ticket rookies or unproven youngsters who can blossom next year, even if they carry risk. Scan the waiver wire aggressively for high-ceiling sleepers and stash them before anyone else sees the upside. In every transaction, prioritize picks and upside over immediate production: package aging vets for mid-to-late-round draft assets, and parlay those into rookie-season flyers. This rebuild isn’t about quick fixes, it’s about stocking your farm system with the kinds of lottery tickets that become difference-makers when your window finally arrives. Give yourself time, play the long game, and let the rebuild begin.";
    }
    else if (tankRank <= 3 && compRank > Math.ceil(N * 0.7)) {
      title = "Capital Architect";
      desc  = "You’re sitting near the bottom as a contender but have built a premium war chest for the future, top three in rebuilding value, so your focus is pure asset growth. Leading up to the trade deadline, when contending teams pay top dollar for proven players, consider moving a veteran on your roster to maximize returns. Likewise, picks carry peak value just before and during the rookie draft, so time your pick swaps to when demand is highest. Over the next year, scour the waiver wire for high-upside sleepers and stash them for development, and don’t shy away from packaging aging role-players into additional mid-to-late round selections. Your mission is simple: accumulate as much draft capital and breakout upside as possible now, so when your window finally opens, you’ll have every tool you need to strike";
    }
    else if (compRank <= Math.ceil(N * 0.3) && tankRank > Math.ceil(N * 0.7)) {
      title = "Contender with Capital Concerns";
      desc  = "You’ve assembled a championship-caliber lineup you're in the top tier contenders, but your future war chest is running on fumes. Now’s the moment to lean into your win-now edge without mortgaging what little draft capital you have left. As the trade deadline looms, use our Trade Calculator to pinpoint which depth pieces you can flip for a late-round pick, then bank those selections until they’re hottest just before the rookie draft. After the season, dive into our Rankings pages to spot under-the-radar sleepers and stash them on your roster, adding youth without giving up picks. This isn’t just about today’s glory, it’s about engineering a balance of firepower now and sustainable upside tomorrow. Get ready to make the moves that turn your contender status into a legacy.";
    }
    else {
      title = "Middle-of-the-Pack";
      desc  = "You’re sitting squarely in the middle, neither a league juggernaut nor in full rebuild mode, so your biggest advantage is flexibility. You’ve got trade fodder, waiver wire fodder, and draft picks to work with, but no clear path yet. Start by diving into our Rankings pages to identify which positions you truly need to upgrade and which assets you can move without hurting your depth. Leading up to the trade deadline, use the Trade Calculator to shop those extra pieces to contenders who overpay, then reinvest in high-upside rookies or breakout veterans. During the offseason, keep your finger on the pulse of the rookie draft, those mid-round selections can turn into game-changers. In short: set a bold strategy, whether you decide to push for a run or build toward next season, and then use your toolbox (trades, waivers, rankings, draft capital) to execute it. Your window is wide open, you just have to choose your direction and go all-in.";
    }

 document.getElementById("teamTitle").innerHTML = `
      <div class="title-card">
        <h1>${title}</h1>
        <div>${owner}</div>
        <div>Contending Rank: ${compRank} / ${N}<br>Rebuilding Rank: ${tankRank} / ${N}</div>
        <p>${desc}</p>
      </div>`;


    // Cornerstones
    const posLimits={QB:8,RB:8,WR:8,TE:6}, leaguePos={QB:[],RB:[],WR:[],TE:[]};
    rankings.overall.forEach(r=>{
      const p=r.Position.toUpperCase();
      if(leaguePos[p]&&leaguePos[p].length<posLimits[p]) leaguePos[p].push(r.Player);
    });
    const owned=new Set(roster.players.map(id=>normalize(allPlayers[id].full_name)));
    let csHTML=`<h3>Cornerstones</h3><div class="cornerstones-grid">`;
    Object.entries(leaguePos).forEach(([p,list])=>{
      list.forEach(name=>{
        if(owned.has(normalize(name))){
          csHTML+=`
            <div class="cornerstone-bubble cs-${p}">
              ${name}<span class="cornerstone-pos">(${p})</span>
            </div>`;
        }
      });
    });
    cornerstonesDiv.innerHTML=csHTML+"</div>";

    // — Starting Lineup —
    const starters = getStarters(roster, cMap);
    let lineupHTML = `<h3>Starting Lineup</h3><ul class="player-list">`;
    Object.entries(starters).forEach(([slot, pl])=>{
      const posKey = slot.match(/^[A-Z]+/)[0];
      lineupHTML += `
        <li class="pos-${posKey}">
          <strong>${slot}</strong>: ${pl.name}
        </li>`;
    });
    lineupHTML += `</ul>`;
    lineupDiv.innerHTML = lineupHTML;

// Tier color maps and descriptor function
const tierPos = {
  none:       "#333",
  slight:     "#57a773",
  well:       "#008000",
  sig:        "#00A000",
  extreme:    "#00C000"
};
const tierNeg = {
  slight:   "#ffb3b3",
  well:     "#ff6666",
  sig:      "#cc0000",
  extreme:  "#8B0000"
};
const descFn = diff => {
  const a = Math.abs(diff), pos = diff > 0;
  if      (a <= 500)  return { txt: pos ? "above avg"          : "below avg",           col: tierPos.none };
  else if (a <= 750)  return { txt: pos ? "slightly above avg" : "slightly below avg",  col: pos ? tierPos.slight : tierNeg.slight };
  else if (a <= 1250) return { txt: pos ? "well above avg"      : "well below avg",      col: pos ? tierPos.well   : tierNeg.well };
  else if (a <= 2000) return { txt: pos ? "significantly above avg" : "significantly below avg", col: pos ? tierPos.sig   : tierNeg.sig };
  else                return { txt: pos ? "extremely above avg" : "extremely below avg", col: pos ? tierPos.extreme: tierNeg.extreme };
};
   // ─── Strengths & Gaps ─────────────────────────
    // build our actual starter‐slots in order:
    const slotsOrder = Object.keys(starters);
    const leagueStarAvg = {};
    slotsOrder.forEach(slot => {
      const arr = rosters.map(r=>getStarters(r,cMap)[slot]?.score||0);
      leagueStarAvg[slot] = arr.reduce((s,v)=>s+v,0)/arr.length;
    });
    const yourS = starters, str = [], g = [];
    slotsOrder.forEach(s => {
      const diff = (yourS[s]?.score||0) - leagueStarAvg[s];
      if (Math.abs(diff)>500) {
        const d = descFn(diff);
        (diff>0?str:g).push(
          `<li><strong>${s}</strong> is <span style="color:${d.col};font-weight:bold;">${d.txt}</span>.</li>`
        );
      }
    });
    let sgHTML = "";
    if (str.length) sgHTML += "<h3>Strengths</h3><ul class='gs-list'>" + str.join("") + "</ul>";
    if (g.length)   sgHTML += "<h3>Gaps</h3><ul class='gs-list'>"     + g.join("")   + "</ul>";
    needsSurplusDiv.innerHTML = sgHTML;

// — Top Targets (strictly better upgrades, SF → QB) —

const L = rosters.length;

// 1) Build three bucket sets (comp/overall/tank) just once
const rankingSrc = {
  competing: rankings.competing,
  overall:   rankings.overall,
  tanking:   rankings.tanking
};
const bucketsMap = {};
Object.entries(rankingSrc).forEach(([key, data]) => {
  // per‐position lists
  const pls = { QB:[], RB:[], WR:[], TE:[] };
  data.forEach(r => {
    const p = r.Position.toUpperCase();
    if (pls[p]) pls[p].push({ name: r.Player, score: +r.Score });
  });
  Object.values(pls).forEach(arr => arr.sort((a,b)=>b.score-a.score));

  // dynamic shifts
  const qbStar = lineupConfig.filter(x=>"QB"===x).length;
  const rbStar = lineupConfig.filter(x=>"RB"===x).length;
  const wrStar = lineupConfig.filter(x=>"WR"===x).length;
  const teStar = lineupConfig.filter(x=>"TE"===x).length;
  const shifts = {
    QB: qbStar + 2,
    RB: rbStar + 4,
    WR: wrStar + 4,
    TE: teStar + 2
  };

  // build buckets for this ranking
  const b = {};
  ["QB","RB","WR","TE"].forEach(pos => {
    const arr = pls[pos], s = shifts[pos];
    b[`${pos}1`]      = arr.slice(s,       s + L);
    b[`${pos}2`]      = arr.slice(s + L,   s + 2*L);
    b[`${pos} Depth`] = arr.slice(s + 2*L, s + 3*L);
  });
  // flex buckets
  const flexArr = [...pls.RB, ...pls.WR].sort((a,b)=>b.score-a.score);
  const flexStart = 30;
  ["1","2","3"].forEach(i => {
    b[`FLEX${i}`] = flexArr.slice(
      flexStart + (i-1)*L,
      flexStart +   i  *L
    );
  });

  bucketsMap[key] = b;
});

// 2) Get your own starter‐scores for each ranking
const myComp    = getStarters(roster, mapScores(rankings.competing));
const myOverall = getStarters(roster, mapScores(rankings.overall));
const myTank    = getStarters(roster, mapScores(rankings.tanking));

// 3) Extract your gap slots as before
const gapSlots = g.map(li => {
  const m = li.match(/<li><strong>(.*?)<\/strong>/);
  return m ? m[1] : null;
}).filter(Boolean);

// 4) Render one true upgrade per ranking
let tHTML = `<div id="topTargets"><h3>Top Targets</h3>`;
gapSlots.forEach(slot => {
  tHTML += `<h4>${slot}</h4><div class="targets-container">`;
  const seen = new Set();

  // map “SF” back into the next QB slot, otherwise use the slot name
  const pickSlot = slot.startsWith("SF")
    ? `QB${ lineupConfig.filter(x => x === "QB").length + 1 }`
    : slot;

  // **NEW**: extract the base position for your bubble class
  const posKey = pickSlot.match(/^[A-Z]+/)[0];

  [
    ["Contending", "competing", myComp],
    ["Overall",   "overall",   myOverall],
    ["Rebuilding",   "tanking",   myTank]
  ].forEach(([label, key, myMap]) => {
    let pool = (bucketsMap[key][pickSlot] || [])
      .filter(p => p.score > (myMap[slot]?.score||0))
      .filter(p => !seen.has(p.name) &&
                   !roster.players.some(pid =>
                     normalize(allPlayers[pid]?.full_name) === normalize(p.name)
                   ));

    if (pool.length) {
       // pick a random candidate out of the pool
       const pick = pool[Math.floor(Math.random() * pool.length)];
      seen.add(pick.name);
      tHTML += `
        <div class="target-bubble tb-${posKey}">
          <small>${label}</small><br>${pick.name}
        </div>`;
    }
  });

  tHTML += `</div>`;
});

tHTML += `</div>`;

tradeIdeasDiv.innerHTML = tHTML;

    // Depth panel
    renderDepthPanel(depthChartType.value, roster, cMap, tMap, oMap, owner);
  }

 // wire controls
  teamDropdown.addEventListener("change", renderAnalysis);
  depthChartType.addEventListener("change", renderAnalysis);
  // No auto-render here – user must pick "Select a team" → actual team

  function renderDepthPanel(type, roster, cMap, tMap, oMap, owner){
    const map = type==="competing"?cMap:type==="tanking"?tMap:oMap;
    const allP = roster.players.map(id=>{
      const p=allPlayers[id]; if(!p)return null;
      const sc=map[normalize(p.full_name)]||0;
      return sc>0?{name:p.full_name,pos:p.position,score:sc}:null;
    }).filter(Boolean).sort((a,b)=>{
      const o={QB:1,RB:2,WR:3,TE:4};
      return a.pos!==b.pos?(o[a.pos]||9)-(o[b.pos]||9):b.score-a.score;
    });
    const groups={QB:[],RB:[],WR:[],TE:[]};
    allP.forEach(x=>groups[x.pos]?.push(x));

    let html=`<div class="depth-team-card"><h3>${owner}</h3><div class="position-breakdown">`;
    ["QB","RB","WR","TE"].forEach(pos=>{
      if(groups[pos].length){
        html+=`<div class="position-group position-${pos}"><h4>${pos}</h4><ul>`;
        groups[pos].forEach(pl=>html+=`<li>${pl.name} (${pl.score})</li>`);
        html+=`</ul></div>`;
      }
    });

    let picks=[...roster.picks];
    picks.sort((a,b)=>+a.season-+b.season||a.round-b.round);
    if(picks.length){
      html+=`<div class="position-group draft-picks"><h4>Draft Picks</h4><ul>`;
      picks.forEach(pk=>{
        const pn=`${pk.season} ${ordinalSuffix(pk.round)} Round`;
        const prev=rosterMap[pk.previous_owner_id], orig=prev?userMap[prev.owner_id]:"Unknown";
        const sc=oMap[normalize(pn)]||0;
        html+=`<li>${pn}
                  <span class="pick-origin">(${orig})</span>
                  <span class="pick-score">(${sc.toLocaleString()})</span>
               </li>`;
      });
      html+=`</ul></div>`;
    }

    html+=`</div></div>`;
    depthChartTeamCard.innerHTML=html;
  }

   // ─── On initial load: show recent leagues (but don’t auto-fill ID) ───
  renderRecentLeagues();
  // we still keep STORAGE_KEY_LAST for future use, but we don't pre-populate the input

});



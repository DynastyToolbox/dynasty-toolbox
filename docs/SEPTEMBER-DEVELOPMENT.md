# Homepage, Trade Finder, simulator and rolling medians

Development branch only. Do not publish subscription screens, new limits, or paid access
until the owner separately approves launch and business/licensing readiness. No billing added.
Analytics work was explicitly deferred; existing tracking has not been changed.

## Homepage

Preserves site colors, font and navigation; adds a compact hero, six linked tool cards,
owner-ordered mock catalogue links and short feature highlights. `home.js` takes the first
two NFL mock titles and first dynasty title from the published catalogue, without guessing
dates from titles. Both mock pages accept a validated catalogue ID in `?draft=`. Static
links remain usable if catalogue loading fails. Longer editorial copy remains the owner's.

## Trade Finder

Free server result: team selection and explanations of complementary roster depth.
Premium server result: specific targets, up to three one-for-one proposals per partner,
and up to 120 untouchable players across rosters. Exclusions last for the current visit.
Saved accounts/leagues/default team use the existing shared integration.

First-version method: sum top three ranked players at each of QB/RB/WR/TE, compare against
the league median positional sum; below 80% is a need, above 120% is depth. The selected
Overall/Contending/Rebuilding system and scoring adjustments apply to these profiles.
Picks/unranked players do not create positional needs. This does not model starting slots,
injuries, age curves, managers' preferences, or actual willingness to trade. Proposals
require mutually matching positions and Overall market values within 25% of the larger
side; no stud bonus. No promise of fairness or of a player being undervalued.

Only Sleeper dynasty leagues are currently supported, via the calculator's server loader.
Premium checks happen before private target-roster responses and on every match request.
Calculator handoff validates roster IDs and current asset ownership, preserves scoring,
and recalculates using the established calculator server logic. No trade is sent to Sleeper.

## Simulator

`devy-config` returns two NFL draft rounds for free access, seven for verified premium.
`devy-evaluate` calculates results on the server from published source data, refusing
unknown/duplicate picks or players and later-round submissions without premium access.
Existing hit rates, opportunity, Superflex and Devy scoring formulas are preserved.
Published underlying CSV datasets remain public: this protects hosted calculations and
service access, not secrecy of historical data or mathematical formulas. Additional
premium-page data protection is still separate work before subscription launch.

All new server actions remain behind SUBSCRIPTION_ACCESS_ENABLED; local preview uses the
separate development Supabase project. No live membership or production config changes.

## Rolling median data

Scheduled workflow confirmed successful on Sep 16 2026, 11:38am MDT, run 35129493240.
Existing schedule remains Wednesday. New schema 2 stores chronological `meta.week_slots`;
player `weeks` keys are window slots 1–17, not season week numbers. Last slot points to
`meta.season` / `meta.week_built_through`. Week 18 and postseason are always excluded.
At 2026 completed Week 2 the range is 2025 Weeks 3–17 + 2026 Weeks 1–2. Shorter windows
also cross seasons. These are league calendar weeks, not 17 appearances per player.

Keep minimum three qualifying games, active status, and existing opportunity thresholds:
8 pass attempts OR 2 rush attempts OR 2 targets. Save offensive snap percentage from
off_snp / tm_off_snp and enforce the existing 40% page threshold; the old builder did
not persist snaps and therefore often bypassed that page rule. Missing snap data uses
the prior opportunity fallback, explicit zero snaps are excluded. Sleeper omits zero-valued
points fields; qualifying zero-point games are retained. Any request failure aborts before
writing; output validation rejects invalid ranges and backwards publication.

Current and season-2026 snapshot rebuilt locally through Week 2. The 2025 historical file
is unchanged. JS and data must ship together. Until separately published, the live weekly
workflow keeps its old single-season behavior.

## Validation

50 account/access/calculator/finder/simulator/median tests passed; additional focused median
checks passed after date-label refinement. Real Sleeper data rebuilt successfully; 310
players have at least three qualifying games. Browser: saved team import, rolling Last5/PPR
team medians and QB/FLEX/Superflex lineup, real partner matches, player proposal handoff
(Quinshon Judkins / Harold Fannin, +293 Overall), simulator assignment/result, and mock
deep link checked. No production deployment or GitHub push performed.

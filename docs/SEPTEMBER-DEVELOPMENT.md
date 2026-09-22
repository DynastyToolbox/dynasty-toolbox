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
Premium adds up to six package proposals per partner, team-specific ranking
systems and Low/Neutral/High pick weights (0.8/1/1.2), and up to 120 untouchable players
or picks. Preferences and exclusions apply to the current page visit. Roster checklists
are position-grouped, use analyzer colors, and sort by the roster's preference-adjusted
score and shared scoring format. Picks retain owner/origin identities and compact labels.
Saved accounts/leagues/default team use the existing shared integration.

Needs/depth: sum the top three ranked players at QB/RB/WR/TE, compare with league median;
below 80% is need, above 120% is depth. Each roster is compared against ALL rosters in
its own selected ranking system so differently scaled rankings are never mixed. Picks
and unranked players do not create positional needs. Profiles do not model starting slots.

Packages: each side requires an asset worth at least 3,000 unweighted Overall points
after scoring adjustments; smaller assets can balance the trade. Shapes: 1:1, 2:1, 3:1, 2:2 and reverse; at most three assets/two picks per side and four
assets total. At least one player must change teams. In consolidations, the larger
package's best asset must be at least 50% of the smaller package's best asset. Only
positive Overall assets ranked in both selected modes enter the candidate pool. Deep
rosters are bounded to their top 40 players and 24 picks by Overall value (UI explains
this and flags when it applies). Sorted value ranges avoid a full Cartesian package search.

Market difference <=15% of the larger unweighted Overall total, with shared scoring
adjustments and WITHOUT Stud Bonus. Each team's own net must be >=-1000 using its own
ranking mode and pick weight for BOTH sends/receives, including the existing calculator
Stud Bonus. Pick preference never affects league rank scores or the market graph.
Need improvements and mutual preference gains prioritize suggestions; player-for-pick
ideas can appear without complementary positions. Results cap repetitive main exchanges.
No claim that a manager will accept or that ranking value equals actual market price.

Finder cards now show the partner's needs and concise preference/value information, with
no target list or calculator link. The calculator's existing deep-link support remains
for compatibility, but new Finder ideas use account-backed pins instead.

Pinned trades: migration 202609220001_saved_trades.sql creates owner-only RLS storage,
a 50-pin account cap, structure constraints, and duplicate fingerprints. Applied only to
DEVELOPMENT phkbpputgegvesmpscrx on September22; production still needs this migration
with a separately approved release. No service-role key is used. Each pin is scoped to
account + exact league ID + selected source roster. League renewal does not silently
transfer pins to a different league.

The server validates current ownership and score/anchor/package limits before saving;
client IDs/labels/scores do not establish ownership or value. Reads recalculate with
current rankings, scoring filters and the page's current team preferences. The assets
stay fixed. Pins outside current limits or marked untouchable remain visible with a
notice; moved/missing or unranked assets display a warning instead of invented scores.
Pin removal is scoped to the verified account; losing premium does not delete pins.
Preferences/untouchables remain visit-specific. Pins use the database, not local storage.

Homepage copy now explains the three systems and distinguishes numbers-based values
from crowdsourced market prices, in the owner's voice. Mock draft team/logo normalization
preserves traded-pick arrow files. The local preview file allowlist now permits those
existing filenames while keeping all other file/path restrictions.

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

September 22 refinement validation: 72 tests passed, including seven focused package /
preference / threshold tests. Real 10-team league search produced 54 proposals across
nine partners in 652ms after roster import. Three-for-one browser handoff retained both
modes/weights and produced matching +1244 / +2303 totals. All 521 published NFL pick
rows resolve to existing logos; browser full (100), condensed (100), and team (32) views
had zero broken logos. No production deployment or GitHub push.
Responsive review: Trade Finder and Home at 375px had no horizontal overflow; roster groups, pick preference controls, and exclusion updates worked. Desktop Finder also had no horizontal overflow.

September 22 pin refinement validation: all81 tests pass including real local PostgreSQL
RLS/limits/constraints checks (zero skipped). Hosted development anonymous reads denied.
Browser pin Jake Ferguson /2027 1st(alexyskay) saved, survived page reload, and showed
-246 Overall net at Neutral, +728 at High picks; Contending/Low changed it to-2356 and
kept the pin with an outside-limits notice. Production remains unchanged.

Phone verification: saved-trade card fits a 375px viewport (360px content area) without horizontal overflow. The test-created pin was unchecked successfully; the page confirmed Trade unpinned. No production publication or database changes.

## September 22: lineup-aware Trade Finder and persistent preferences

Sleeper roster_positions and scoring settings now travel with the imported league. Finder scoring defaults follow reception scoring, SF/two-QB starters, and TE reception bonus, using the site's existing supported scoring modifiers. Ordinary FLEX is split half RB/WR; SF counts as QB when enabled, or ordinary flex when unchecked. Explicit multi-QB slots remain QB. Receiving flex splits WR/TE. Missing offensive slots have a visibly disclosed default lineup.

Usable-player cutoffs are QB 5000 and RB/WR/TE 3000 in each team's selected rankings; both scores and cutoff receive the same scoring multiplier. These are tunable dynasty-value heuristics, not actual weekly start/sit predictions. Need is count below floor(demand); depth is at least ceil(demand)+1. Both proposed post-trade rosters must avoid increasing positional and shared-flex deficits. Subthreshold players cannot provide a need-fit bonus. Saved pins are also rechecked against the new rules. Matching year/round/tier picks cancel for evaluating whether a trade is just an equivalent pick plus a throw-in; their original-team identities are preserved.

Team approach and pick preference changes autosave to private account+league storage, then reload on league import. A failed read prevents running with silently reset preferences. Failed saves show a retry message; Update matches retries. Untouchable selections remain per visit. Label fallbacks now say None.

Migration 202609220002_finder_preferences.sql applied only to development phkbpputgegvesmpscrx, success confirmed in SQL editor. RLS checks account ownership for reads/inserts/updates/deletes. Production untouched. 86 tests passed including positional/flex protection, equivalent picks, saved settings validation and SQL isolation. Browser confirmed Contending/High preferences returned after reload; QA settings restored to Overall/Neutral. Real-league search with roster checks took about 1.37 seconds for 54 ideas across 9 partners before final need-fit refinement. Phone width 375/360 content fits with no overflow.

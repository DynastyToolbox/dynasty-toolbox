# League Outlook: first development checkpoint

The first implementation is `lib/outlook-foundation.cjs`. It is not connected to a public page or membership endpoint and does not yet generate projected records, probabilities or championship odds.

## What is verified

- Read-only Sleeper league/state/roster and weekly matchup inspection, with numeric ID checks, timeouts and bounded request batches.
- In-progress weeks excluded from completed history; regular-season schedule ends before configured playoff start. Missing or invalid matchups are flagged, never invented.
- Exact supported raw offensive stat scoring using league weights. Missing records remain missing rather than becoming zero. Unsupported scoring keys and starting positions are reported explicitly.
- September 25 live development check: the owner's 10-team league has five valid pairings each week from Week 3 through Week 14; playoffs start Week 15. Two completed weeks, no extra median game. The offense scorer matched all 273 numeric-player Week 2 stat records compared against Sleeper's league-scored player totals (within 0.01). This is scoring agreement, NOT forecasting validation.
- Five regression tests cover weights, missing data, unsupported scoring/positions, pair validation, history boundaries and schedule fetching.

## Proposed projection pipeline

1. Collect unfiltered historical raw stats, availability and role information. Do not reuse the Median Rankings dataset as the forecasting dataset: its 40% snap/opportunity exclusions condition on substantial participation and omit low-snap outcomes. Keep the median tool's existing rules unchanged.
2. Recompute history using league scoring. Identify DNP/bye/missing records separately. Include low-output games actually played. Choose a recent-form/longer-history blend through evaluation, not an arbitrary final weight.
3. Forecast each eligible player's weekly points and uncertainty. Treat rookies and role changes explicitly; missing history cannot become zero or a dynasty-score conversion. NFL bye schedule, known availability and roster eligibility (including IR/taxi) must be integrated before presenting actionable weekly forecasts. Unsupported K/DEF/IDP/custom-scoring leagues should load a clear coverage report, not receive incomplete full-team odds.
4. Select the best expected eligible lineup for each future week using the actual slot restrictions. Select it before outcome simulation; selecting the best realized scorers after each simulation would incorrectly turn managed leagues into best ball. Best-ball leagues need their own rule.
5. Model the variation and relevant correlations in lineup points. Compare simulated totals for actual opponents, including ties and any league-median game. Convert outcomes to weekly win probabilities and distributions of final records.
6. Add league seeding, divisions/tiebreakers, playoff reseeding, multi-week rounds, championship probabilities and draft-order rules only after their inputs and semantics are confirmed. Draft-order projection follows the original team and displays the current pick owner separately. Max PF and lotteries require distinct logic.

## Validation before presenting odds

Use rolling historical cutoffs: train only on earlier weeks, predict the next week, and compare against actual results. Track player/team point error and probability calibration/Brier score against simple baselines. Current rosters and current injury labels are not historical snapshots; do not use them to claim an unbiased historical league backtest. Historical starters can measure conditional-on-lineup forecast accuracy but do not validate automatic lineup selection. Do not label uncalibrated simulation frequencies as established real-world probabilities.

## Historical baseline checkpoint — September 25, 2026

Implemented `lib/outlook-research.cjs` and a manual `scripts/research_outlook.cjs` runner. Research files are deliberately required to live outside the website repository. No endpoint, public page, membership settings or published Median Rankings data changed.

The first run used 36 completed NFL weeks: 2024 Weeks 1–17, 2025 Weeks 1–17, and 2026 Weeks 1–2. Week 18 is excluded throughout. League scoring is applied to raw stats; no dynasty scores, precomputed fantasy totals or median snap filters are used. Active games with low or zero production remain observations. Missing, explicitly inactive and unknown records remain separate from zero-point games.

The 2024 season warms up the player histories. The first eight weeks of 2025 choose among five fixed baselines by mean absolute error on the established-role group. Week 9 onward evaluates the chosen model without retuning it. Each next-week estimate uses only earlier observations, including during evaluation. A player needs at least four prior active games. The role group requires at least two of the previous four active games with 40% offensive snaps, plus an active game within four included NFL weeks; it does not use the target game's snaps. This group is a research proxy, not a claim that we knew each fantasy starting lineup.

The selected baseline gives equal weight to the last four active-game average and the last sixteen (or available history up to sixteen). The shorter games also occur in the longer window, intentionally giving recent performance extra weight.

| Baseline | Later observed role-group games | Mean absolute point error | Root mean square error |
| --- | ---: | ---: | ---: |
| Previous active game | 2,453 | 6.070 | 8.610 |
| Last four average | 2,453 | 5.179 | 6.925 |
| Last eight average | 2,453 | 5.036 | 6.785 |
| Last sixteen average | 2,453 | 5.032 | 6.811 |
| Four/sixteen blend (selected on earlier weeks) | 2,453 | 4.970 | 6.661 |

For that blend, mean absolute errors were QB 7.426, RB 6.027, WR 4.594 and TE 3.483 points. This is a comparison against simple historical baselines, not against expert weekly projections. The estimates averaged 0.375 points above actual results in the evaluated role group.

Residual ranges intended to cover 80% of active-game outcomes, estimated on the earlier tuning period, covered 74.4% of later QB games, 83.3% RB, 82.4% WR and 80.1% TE. QB uncertainty is not yet adequate. These player ranges do not establish team-score distributions, joint correlations or win-probability calibration.

Of 2,821 role-group forecasts in the later period, 2,453 had active outcomes, 367 were missing and one had unknown activity. Those missing outcomes are not silently scored as zero: bye/injury/availability information is still needed. Four offensive player-week records had inconsistent snap totals; their fantasy points were retained and their snap fractions marked unknown. No numeric historical player IDs were missing from the downloaded registry in this run, but the registry's current position labels are not historical roster or injury snapshots.

Seven additional tests cover time cutoffs, zero/low-snap outcomes, cold starts, target-outcome leakage, frozen model selection/calibration, missing-data coverage and unsupported input. Combined with the foundation suite, 12 tests pass.

### Reproduce the research

Run `node scripts/research_outlook.cjs --league YOUR_LEAGUE_ID --work-dir PATH_OUTSIDE_WEBSITE` manually. Windows environments that require it can add `--preserve-symlinks --preserve-symlinks-main` before the script name. The runner uses three concurrent stats requests, timeouts, retries, completeness checks and a reusable raw-data cache. Add `--refresh` to fetch corrected history and a fresh player registry. It fetches current season state and league scoring each run; a new season cutoff constitutes a new experiment, not identical reproduction of this checkpoint.

The work directory contains cached public source data, aggregate `report.json`, and `inputs.json` with the state/scoring snapshot and SHA-256 fingerprints of all inputs. The September 25 working copy is in the workspace's `work/outlook-research` directory, outside the served repository. Re-evaluation of those exact cached files with the recorded scoring and week slots reproduces the numeric report. Do not publish these research files through the development server or add automatic deployment jobs for them.

## Lineup and availability checkpoint — September 25, 2026

Implemented `lib/outlook-lineups.cjs` and the manual `scripts/research_outlook_lineups.cjs` runner. These remain isolated research modules, with no public route or page changes.

- The NFL schedule is validated across all 32 teams: 17 games each over 18 weeks, unique game IDs, no team twice in one week, and 272 non-canceled games. The live feed contained one canceled duplicate, which is ignored. Missing or inconsistent schedules cannot manufacture bye weeks. Team abbreviation aliases are normalized. Postponed/unrecognized game statuses remain unknown.
- Current fantasy IR and taxi players cannot be auto-started. Their current placement is held fixed for the research scenario; future activation is not assumed. Players without a known NFL team are unresolved rather than assigned a bye or zero.
- Out, IR, PUP, suspended, inactive and practice-squad designations exclude players from this week's candidates. For future weeks those designations produce an unknown-return flag, not an invented season-long absence or recovery date. Questionable/doubtful/probable players remain conditional, without assigning an arbitrary probability or discount.
- Missing history, old role history and uncertain QB roles are explicitly unresolved. QBs listed below first on the current depth chart, or without two substantial-snap games among their last four active games, need role review instead of inheriting a former starter's projection. This is a conservative coverage rule, not a new trained injury or depth-chart model.
- An exact assignment solver fills as many eligible starting slots as possible, then maximizes their expected points. It supports fixed positions, FLEX, SUPER_FLEX, WRRB_FLEX, REC_FLEX and multiple eligible positions. Each player can appear only once. This avoids greedy ordering mistakes between overlapping slots. Unfilled K/DEF/IDP slots remain visible; they do not receive fabricated scores.
- Current-week optimization after an NFL game has started is flagged: locked fantasy starters are not yet modeled. All output totals are explicitly conditional modeled sums; `projectedTeamPoints` remains null. Future NFL matchups are used for byes/eligibility, not yet defensive matchup adjustments.

### Live league coverage

Checked all 120 team-weeks across the owner's 10-team league in Weeks 3–14. 117 had enough modeled, eligible players to fill every slot; three did not. All 120 had at least one unresolved roster player, often a bench player; filling the slots does not establish that the selected lineup is truly strongest when other player projections are missing.

Unique unresolved player/reason pairs: 16 insufficient-history players, nine uncertain QB roles, three without an NFL team, ten unknown future return dates and one unrecognized status. Counts can overlap for the same player across different future conditions. Across the full set of team-weeks, 237 player-week entries were excluded for byes, 192 for fantasy IR and 564 for taxi placement. These are repeated weekly roster entries, not distinct players.

### Historical team-score check

Evaluated the actual recorded starters from 2025 regular-season Weeks 9–14 in the linked prior-year league, plus completed 2026 Weeks 1–2. Every prediction uses only earlier stats, rescored with that season's league settings. Current injuries/depth charts do not retroactively filter these historical starter forecasts.

Of 80 team-week lineups, 74 had complete forecasts and reconciled individual points against the reported team total. Five were excluded for insufficient player history and one for an empty/duplicate starter. Partial scores and commissioner overrides never enter full-team error.

| Model | Complete team-weeks | Mean absolute error | Root mean square error | Mean forecast minus actual |
| --- | ---: | ---: | ---: | ---: |
| Four/sixteen blend | 74 | 20.311 | 26.100 | +2.150 |
| Previous active game | 74 | 32.775 | 38.981 | +3.846 |

This small, single-league sample tests points **conditional on knowing the actual historical starting lineup**. It does not validate automatic lineup selection, availability forecasts, probability calibration or championship odds. Excluding incomplete cases is a coverage limitation, particularly for rookies.

Ten additional tests cover exact assignment (including comparison with exhaustive search across 60 deterministic small cases), restricted FLEX, negative scores, multiple positions, unknown slots, IR/taxi, uncertain injury duration, incomplete schedules, current-week locks, future-data leakage and complete-team scoring. Together the Outlook suites contain 22 passing tests.

Run `node scripts/research_outlook_lineups.cjs --league YOUR_LEAGUE_ID --work-dir EXISTING_NON_PUBLIC_RESEARCH_DIRECTORY` after the baseline runner. This writes `lineup-snapshot.json`, `lineups-report.json`, previous-league metadata and historical matchup snapshots outside the site. The runner verifies cached stats against baseline fingerprints and checks the season/week cutoff. `--snapshot` reuses the saved snapshot and historical matchup files; it fetches prior-league metadata once if absent, then subsequent complete replays are offline. The output distinguishes source snapshot time from report generation time. The player registry must not be refreshed repeatedly for each team/week.

Sources: [Sleeper's weekly injury-designation explanation](https://support.sleeper.com/en/articles/3570017-injury-statuses-and-ir-eligibility), [documented roster and matchup APIs](https://docs.sleeper.com/), and the directly inspected schedule feed at `https://api.sleeper.app/schedule/nfl/regular/2026`. That schedule endpoint, like raw stats, is outside the documented matchup contract; commercial licensing and schema stability remain dependencies.

## Next checkpoint

Handle limited-history players and distinguish a potentially missing starter from an uncertain bench asset. Add current-week locked-lineup handling and explicit availability scenarios before presenting live-week estimates. Build the first League Outlook development page using the existing visual style, saved-league picker and secure premium endpoint, surfacing actual schedule, candidate lineups and coverage first. Team uncertainty/correlations and win-probability calibration remain prerequisites for actionable win/playoff odds. No new production publication or payments.

Sleeper's documented schedule interface: https://docs.sleeper.com/#getting-matchups-in-a-league. Raw stats endpoint is already used by this repository but is not covered by that documented matchup contract; availability and commercial licensing remain dependencies.

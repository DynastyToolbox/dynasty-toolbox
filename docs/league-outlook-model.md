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

## Next checkpoint

Build the weekly NFL availability/bye layer and eligible starting-lineup selection, with explicit treatment for missing history and roster exclusions. QB/role-change uncertainty and team-level testing must come before actionable weekly win odds. Then build the first League Outlook page using the existing visual style, saved-league picker and secure premium endpoint. Surface actual schedule/coverage first; show predictions only when the required inputs and limitations are understood. No new production publication or payments.

Sleeper's documented schedule interface: https://docs.sleeper.com/#getting-matchups-in-a-league. Raw stats endpoint is already used by this repository but is not covered by that documented matchup contract; availability and commercial licensing remain dependencies.

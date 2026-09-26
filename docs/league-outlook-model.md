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

## Next checkpoint

Build the historical dataset and evaluate an initial player-points baseline. Then build the first League Outlook page using the existing visual style, saved-league picker and secure premium endpoint. Surface actual schedule/coverage first; show predictions only when the required inputs and limitations are understood. No new production publication or payments.

Sleeper's documented schedule interface: https://docs.sleeper.com/#getting-matchups-in-a-league. Raw stats endpoint is already used by this repository but is not covered by that documented matchup contract; availability and commercial licensing remain dependencies.

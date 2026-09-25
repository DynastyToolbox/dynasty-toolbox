# Development readiness — September 25, 2026

These findings apply to the subscription development branch, not a production launch approval.

## Verified at this checkpoint

- 96 automated tests, including account verification, expired/revoked/complimentary membership policy, forged access requests, simulator round restrictions, imported-asset ownership, and isolated-database row access for memberships, leagues, pins and preferences.
- Compatibility fixtures: 8, 10, 12, 14 and 16 teams; empty rosters; unknown player records; K/DEF/IDP; taxi/reserve deduplication; one/two QB, two TE, receiving flex, RB/WR flex and all-flex configurations.
- Unsupported dynasty positions remain unranked, cannot enter trade recommendations, and no longer dilute calculator/league dynasty averages. This does not add kicker, defense or IDP scoring support.
- Team Analyzer handles missing registry entries, distinguishes restricted flex eligibility, handles repeated K/DEF slots, and scales strategy tiers by league size. Imported team/player names are escaped in the older analyzer HTML renderers.
- Actual saved league/default-team import and Team Analyzer rendering checked in the authenticated development browser. Other league sizes are synthetic fixtures, not live user leagues.

## Launch blockers / next work

1. Median Rankings and Best Available still have their original client-side password gates and public data paths. Membership feature flags alone do not protect these pages/data. Add server-enforced access and review which underlying datasets must remain public for free tools. Do not represent these pages as securely paywalled yet.
2. Trade Finder still intentionally returns a free positional-match summary while reserving proposals/roster editing/pins for premium. Confirm whether the final product is fully premium or retains the previously discussed free summary; navigation lock styling does not settle backend policy.
3. Complete hosted free/premium journey checks after the final gates are implemented. Isolated policy/database tests do not replace this. Do not revoke the owner's real access or send unrequested emails just to test.
4. Dynasty ranking models differ today: calculator and League Rankings use a top-15 asset average; Team Analyzer additionally caps positional contributions. Starter need/depth is a separate lineup-based model. Unifying these models or adjusting roster-depth normalization requires an explicit design decision rather than silently changing established scores.
5. Legacy Team Analyzer target buckets still use heuristic offsets/flex buckets, and starter selection is greedy in supplied slot order. Review these before claiming fully optimized lineup/target support for every unusual format. The current change fixes restricted-flex eligibility, not a global optimizer.
6. Full custom scoring, IDP analysis, redraft/keeper trade imports and other platforms are not implemented. Unsupported players should not crash imports, but tolerance is not equivalent to analytical support.
7. No checkout, pricing, billing webhooks or production subscription release. Await LLC and Sleeper licensing/reporting clarification.

## Candidate premium additions

First: Roster Outlook, using the existing forward-year rankings to show which players drive value gains/losses, positional replacement needs and future draft capital. Label projections as model estimates; do not equate age or a projected decline with certainty.

Second: Season Outlook, with confirmed remaining matchups, weekly win probabilities, record ranges and eventually playoff odds. Sleeper documents weekly matchups (https://docs.sleeper.com/#getting-matchups-in-a-league), not a complete documented weekly player projection model. First verify future schedule availability and obtain licensed projections or validate a transparent in-house model. Include actual scoring, starting slots, bye weeks, injuries, median-game rules and K/DEF contributions, or explicitly limit supported formats. Dynasty value scores are not weekly points projections.

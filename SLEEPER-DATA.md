# Sleeper imports and draft picks

The Team Analyzer, League Rankings, and Best Available share `sleeper_data.js`.

## Loading

- NFL players are downloaded once and cached in this browser for up to 24 hours, including between these pages. The cache is optional: blocked/full storage falls back to a normal request. Expired data is refreshed; failed requests can be retried.
- Load Teams / Load League requests current league data. Independent requests run together and simultaneous identical requests share a response.
- Switching ranking systems reuses the loaded league and published rankings. League Rankings also reuses the import for its projection chart.
- Best Available indexes player names once, checks positions, preserves roster/reserve/taxi ownership, and skips ambiguous name matches. Recent league names are stored after a successful load instead of re-fetched on each visit.

## Pick ownership

Sleeper documents a traded pick as its current ownership state: `roster_id` is its original team, `owner_id` its current team, and `previous_owner_id` its most recent seller. See https://docs.sleeper.com/#get-traded-picks.

Each pick has a unique season + round + original roster identity. Start with each team's own picks and replace that identity's owner with the API's current owner. A multi-hop trade or returned pick therefore appears exactly once. The displayed original manager is the current Sleeper manager of that original roster; historical manager names are not available from this import.

The inventory covers three undrafted seasons using the league season and rookie-round settings. Completed drafts are excluded. Pre-draft leagues include the current season; startup selections are not valued as rookie picks. A draft actively in progress, conflicting owners, or unmatched roster/round settings produces an explicit error rather than potentially incorrect scores. Future rookie picks are included only for Sleeper dynasty leagues (`settings.type = 2`).

## Values and formulas

Both pages now look up the published generic round label, such as `2027 1ST ROUND`. The Analyzer formerly looked up `2027 Round 1`, so all of its pick contributions were zero. Its depth-panel values now follow the selected Overall / Contending / Rebuilding view instead of always using Overall.

An original-team label does not predict an exact draft slot or early/mid/late value. Picks with no published round value display Unranked (zero contribution). No values in the rankings data were changed.

Existing formulas remain different:

- Analyzer: highest 15 positive-valued assets, with limits QB 3 / RB 5 / WR 5 / TE 2 / PICK 8; divide by the number selected.
- League Rankings: highest 15 player/pick values with no positional caps. Position ranks use QB 3 / RB 5 / WR 5 / TE 2 / PICK 10 averages.
- Future projection points: top-15 projected player values plus existing rank-based adjustments. Picks affect current team ranking but are not directly included in the future points.

These differences can produce different team ranks on the two pages. Changing that scoring design is a separate decision.

## Regression checks

Run `node scripts/test_sleeper_data.cjs` (17 offline checks). Covers repeated trades, reacquired picks, duplicates, identity types, conservation, invalid owners, season boundaries, multiple drafts, missing values, the real Analyzer averaging function, cache reuse/expiry/retry, fresh league requests, and name indexing.

Manual checks: load a dynasty league in all three pages; change ranking systems; inspect original team labels and several acquired picks; verify an invalid ID has a useful error and permits retry; inspect phone and desktop layouts.

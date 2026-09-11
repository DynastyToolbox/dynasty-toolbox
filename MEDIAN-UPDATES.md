# Weekly median updates

The `Update weekly medians` GitHub Actions workflow runs on Wednesdays at 13:23 UTC (7:23am Mountain daylight time, 6:23am Mountain standard time). It can also be started with **Actions → Update weekly medians → Run workflow**. GitHub scheduling may be delayed and can be disabled after extended repository inactivity.

The workflow rebuilds Sleeper regular-season data, validates it, commits only the weekly JSON files, and calls a Vercel deploy hook for `main`. No local computer or Codex session needs to stay open. Data-fetch or validation failures leave the published data in place; failed runs appear in GitHub Actions.

Before enabling the schedule, create a Vercel deploy hook for this project and the `main` branch. Store its URL in the repository Actions secret `VERCEL_MEDIANS_DEPLOY_HOOK`. Never commit the URL. A deploy hook is used so publication does not depend on whether a bot-authored commit triggers the Git integration. It can only request a deployment of the configured branch. The workflow needs repository contents write permission to commit data; it does not use Supabase or account credentials.

Run the workflow once after merging and confirm the latest Vercel production deployment is Ready. Page and scoring-code changes still go through normal preview review; this automation only edits the weekly data files.

The current week is excluded until Sleeper moves to the next week. Until three weeks are complete in the new season, the previous full regular season remains visible and is labeled with its year. Once the new season qualifies, the current file switches to it. Historical season files remain in the repository. Scoring and qualifying-game thresholds are unchanged.

The roster and rankings list use the same median calculation, scoring selection, time window, and three-game minimum. Players without a qualifying median stay visible on rosters but are not selected for the best-median lineup. The displayed lineup total is the sum of individual medians, not a statistical median for the combined lineup.

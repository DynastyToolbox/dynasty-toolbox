# Updating the published NFL rankings

Keep editing Overall, Contending and Rebuilding in the existing Google spreadsheet. Website visitors use a reviewed copy stored in `data/nfl_rankings.json`. Editing Sheets alone does not change that copy.

To prepare an update, run `python scripts/publish_nfl_rankings.py` from the working folder. You can also ask your coding assistant to prepare a rankings update. No Google login is needed: the script uses the same public CSV exports the website previously used. Python 3 is required; there are no additional packages.

The script downloads all three sheets, validates them, then replaces one file containing the entire release. It retains row order and string values, including existing duplicate names and incomplete rows, and records warnings under `sources`. Named players with invalid scores, incorrect columns, fewer than 100 scored records, or a change in scored record count above 20% stop publication. The last good file remains intact if downloading or validation fails. `--allow-large-change` is available only after reviewing an intentional change in the record count.

To use CSVs you exported yourself, put `competing.csv`, `overall.csv`, and `tanking.csv` in one folder, then run `python scripts/publish_nfl_rankings.py --source-dir PATH_TO_FOLDER`. Contending is called `competing` internally and Rebuilding is called `tanking`; these names preserve existing page controls.

Review warnings and compare the update on a development branch. Upload the prepared data file, check its Vercel preview, then merge the approved change into `main` to publish. The script does not commit, upload, merge, or deploy. Git history retains the older releases for rollback. No scheduled update has been enabled.

The displayed publication date is when the snapshot was prepared, not when an individual player was last edited. Unchanged data retains its existing date. Downloading three published Google tabs cannot guarantee they were edited together; finish editing and allow Google's published exports to update before preparing a release.

NFL Rankings, Trade Calculator, Team Analyzer, League Rankings, and Best Available share the same snapshot and request it once per page visit. Search and filter changes reuse the loaded copy. Each new page visit revalidates the browser's cached copy. Existing open pages keep their loaded release until refreshed. No direct Sheets fallback is used, so an outage cannot silently mix releases.

League Rankings still retrieves its separate projection sheets, and the tools still retrieve leagues and players from Sleeper. Other pages' data sources are unchanged. This migration does not change ranking multipliers, trade bonuses, or league analysis formulas.

Validation commands: `python -m unittest discover -s scripts -p "test_*.py"` and `node --test scripts/nfl_rankings_data.test.cjs`.

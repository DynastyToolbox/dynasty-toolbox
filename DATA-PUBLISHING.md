# Publishing website data

Keep editing the current Google Sheets. To prepare an update for all connected data, run this from the working folder:

```text
python scripts/publish_website_data.py
```

You can also ask your coding assistant to prepare the update. Python 3 is required; no extra packages or Google login are needed. The script uses your public CSV exports.

This prepares `data/nfl_rankings.json` and `data/site_sheets.json`. Review any changes, commit both changed files together to a development branch, check the Vercel preview, then merge the approved update to `main`. Vercel publishes that commit. The script itself does not upload, deploy, or enable a schedule. Editing Sheets alone does not update these published copies.

The publisher refreshes 12 current exports: three NFL ranking views, three league projection years, Devy Rankings, four simulator inputs, and Strength of Schedule. The site currently also has eight archived draft exports. Stable source URLs and expected columns live in `data/sheet_sources.json`. The League Rankings graph uses all three projection sheets; its formulas are unchanged.

All downloads and data checks finish before either local output is replaced. A network failure, invalid CSV, unexpected source columns, or a substantial record loss stops preparation. Current values, blank rows, duplicate columns and existing data quirks are retained for compatibility. These checks detect structural problems; they do not certify that every fantasy value is correct. Inspect the preview before publishing. Commit both outputs together; the Vercel deployment is the release boundary.

## Adding a new mock draft

1. Make and publish the new draft sheet in Google Sheets as you do now. Copy its published CSV link, including the correct tab (`gid`).
2. Add one entry to `mockDrafts` in `data/sheet_sources.json`. It needs a unique `id`, a `kind` of `nfl` or `dynasty`, your displayed `title`, and the CSV `url`. Put the entry first to display it first. Your existing eight drafts are already listed there.
3. Run the publication command, review the preview, and publish the catalogue and changed data outputs together. The appropriate page creates the draft card automatically; no HTML editing is needed.

For example, use `nfl-september-2026` as a new id, `nfl` as the kind, and `September 2026 NFL Mock` as the title, along with your real published CSV link. You can simply give your coding assistant the title, kind, and link to add it.

New drafts download once. Existing drafts retain their published picks during routine updates, so later edits or removal of an old sheet do not change the archive. Use a **new id** for each new draft. Display titles and ordering can be edited in the catalogue without replacing archived picks. Removing an entry removes its card from the next publication; Git history retains the older release.

To deliberately correct an existing archived draft, run:

```text
python scripts/publish_website_data.py --refresh-mock THE_EXISTING_DRAFT_ID
```

This also applies to the existing `NFL DRAFT` entry if you want to refresh it. Repeat `--refresh-mock` for multiple corrections. A changed link on an existing id requires this explicit refresh, preventing accidental replacement of a past draft.

NFL ranking-only publication remains available through `scripts/publish_nfl_rankings.py`, as described in `RANKINGS-PUBLISHING.md`. Median Rankings uses a separate weekly-points file and builder; it is not part of this Sheets publisher. Sleeper league/roster requests remain live. Website layout changes and new pages continue through normal branch, preview and merge steps.

Validation: `python -m unittest discover -s scripts -p "test_*.py"` and `node --test scripts/nfl_rankings_data.test.cjs scripts/site_sheets.test.cjs`.

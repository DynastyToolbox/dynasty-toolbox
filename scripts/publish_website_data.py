"""Prepare the site's public sheet data; never upload, merge, or deploy it."""
import argparse
import concurrent.futures
import csv
import hashlib
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlparse
import publish_nfl_rankings as nfl

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "data/sheet_sources.json"
OUTPUT = ROOT / "data/site_sheets.json"


def validate_catalog(config):
    seen = set(config["sources"])
    titles = set()
    for draft in config["mockDrafts"]:
        if not re.fullmatch(r"[a-z0-9_-]+", draft["id"]) or draft["id"] in seen:
            raise ValueError("Each mock draft needs a unique id containing letters, digits, underscores or hyphens")
        if draft["kind"] not in ("nfl", "dynasty") or not draft["title"].strip():
            raise ValueError("Mock drafts need a title and kind: nfl or dynasty")
        key = (draft["kind"], draft["title"])
        if key in titles:
            raise ValueError("Mock draft titles must be unique within each kind")
        titles.add(key)
        seen.add(draft["id"])
    for source in list(config["sources"].values()) + config["mockDrafts"]:
        url = urlparse(source["url"])
        if url.scheme != "https" or url.hostname != "docs.google.com" or "output=csv" not in url.query:
            raise ValueError("Use the published Google Sheets CSV link for each source")


def validate_csv(raw, spec):
    text = raw.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text), strict=True))
    if not rows or "<html" in text[:500].lower() or "<!doctype" in text[:500].lower():
        raise ValueError("Expected a CSV export, received an empty file or web page")
    count = sum(any(c.strip() for c in row) for row in rows[1:])
    if "headers" in spec:
        if rows[0] != spec["headers"] or count < spec["minRecords"]:
            raise ValueError("Sheet columns changed or too many records are missing; review the source configuration")
    else:
        width = 5 if spec["kind"] == "nfl" else 4
        if len(rows[0]) < width or not any(len(row) >= width and re.match(r"\d", row[0].strip()) and row[2 if width == 5 else 1].strip() for row in rows[1:]):
            raise ValueError("Mock draft has no valid picks or has an unexpected column layout")
    # Preserve the original CSV, including blank/duplicate columns and existing irregular rows.
    return text, count


def prepare(config, previous, read, refresh_mocks=()):
    validate_catalog(config)
    known = {m["id"] for m in config["mockDrafts"]}
    if set(refresh_mocks) - known:
        raise ValueError("Unknown --refresh-mock id")
    entries = dict(config["sources"])
    entries.update({m["id"]: m for m in config["mockDrafts"]})
    previous = previous or {"sheets": {}}

    def build(item):
        key, spec = item
        old = previous["sheets"].get(key)
        if "kind" in spec and old and key not in refresh_mocks:
            if old["url"] != spec["url"]:
                raise ValueError(f"{key}: archived draft URL changed. Use a new id for a new draft, or --refresh-mock {key} for an intentional correction")
            return key, old
        raw = read(key, spec["url"])
        text, count = validate_csv(raw, spec)
        if old and key not in refresh_mocks and count < old["records"] * .8:
            raise ValueError(f"{key}: over 20% of records disappeared; previous release retained")
        digest = hashlib.sha256(raw).hexdigest()
        if old and old["sha256"] == digest and old["url"] == spec["url"]:
            return key, old
        return key, {"csv": text, "sha256": digest, "records": count,
                     "url": spec["url"], "publishedAt": datetime.now(timezone.utc).isoformat()}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        sheets = dict(pool.map(build, entries.items()))
    drafts = [{k: m[k] for k in ("id", "kind", "title")} for m in config["mockDrafts"]]
    digest = hashlib.sha256(json.dumps({"sheets": sheets, "mockDrafts": drafts}, sort_keys=True).encode()).hexdigest()[:16]
    return {"schemaVersion": 1, "version": digest,
            "publishedAt": datetime.now(timezone.utc).isoformat(), "sheets": sheets, "mockDrafts": drafts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, help="Use reviewed local exports named by source id, plus competing.csv, overall.csv and tanking.csv")
    parser.add_argument("--refresh-mock", action="append", default=[], help="Intentionally replace one archived draft by id; repeat for multiple drafts")
    args = parser.parse_args()
    config = json.loads(CONFIG.read_text(encoding="utf-8"))

    def read(key, url):
        if args.source_dir:
            return (args.source_dir / f"{key}.csv").read_bytes()
        # Retry transient network failures; a persistent failure never replaces the previous release.
        for attempt in range(3):
            try:
                with urlopen(url, timeout=30) as response:
                    return response.read()
            except OSError:
                if attempt == 2:
                    raise

    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else None
    sheets = prepare(config, previous, read, args.refresh_mock)
    previous_nfl = json.loads(nfl.OUTPUT.read_text(encoding="utf-8")) if nfl.OUTPUT.exists() else None
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        raw = dict(pool.map(lambda item: (item[0], read(item[0], f"{nfl.SHEET}?gid={item[1]}&single=true&output=csv")), nfl.SOURCES.items()))
    rankings = nfl.prepare_snapshot(raw, previous_nfl)
    # Validate everything before changing either local file. Commit both together for one Vercel release.
    for data, old, destination in [(sheets, previous, OUTPUT), (rankings, previous_nfl, nfl.OUTPUT)]:
        if old and old.get("version") == data["version"]:
            print(f"Unchanged: {destination.name}")
        else:
            nfl.write_snapshot(data, destination)
            print(f"Prepared: {destination.name} ({data['version']})")
    print(f"Checked {len(config['sources']) + 3} current exports; retained/published {len(config['mockDrafts'])} draft archives. No upload or deployment made.")


if __name__ == "__main__":
    main()

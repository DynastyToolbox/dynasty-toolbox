"""Prepare one validated NFL rankings snapshot; publishing to GitHub is a separate step."""

import argparse
import concurrent.futures
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import tempfile
from datetime import datetime, timezone
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "nfl_rankings.json"
SHEET = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQPMs1DdGgohxRyuKn95x0xIXNOmMLhFFlAf7Bh4yym02mISdp1sp_XrtmAVJwoxcOsSyls_4as-Yi8/pub"
SOURCES = {"competing": "0", "overall": "116299513", "tanking": "1543093851"}
HEADERS = ["Rank", "Player", "Position", "Age", "Score"]


def parse_source(raw, name):
    lines = list(csv.reader(io.StringIO(raw.decode("utf-8-sig")), strict=True))
    if not lines or lines[0] != HEADERS:
        raise ValueError(f"{name}: expected columns {HEADERS}")
    rows, warnings, seen = [], [], set()
    scored = 0
    for number, values in enumerate(lines[1:], 2):
        if not values:
            continue
        if len(values) != len(HEADERS):
            raise ValueError(f"{name}: row {number} has the wrong number of columns")
        row = dict(zip(HEADERS, (value.strip() for value in values)))
        player, score = row["Player"], row["Score"]
        if player and score:
            try:
                valid = math.isfinite(float(score)) and float(score) >= 0
            except ValueError:
                valid = False
            if not valid:
                raise ValueError(f"{name}: invalid score for {player} at row {number}")
            scored += 1
        if not player or not score:
            warnings.append(f"Row {number}: incomplete record retained")
        if player:
            key = player.lower()
            if key in seen:
                warnings.append(f"Row {number}: duplicate name retained: {player}")
            seen.add(key)
        rows.append(row)
    if scored < 100:
        raise ValueError(f"{name}: only {scored} scored records; refusing an incomplete release")
    return rows, warnings, scored


def prepare_snapshot(raw_sources, previous=None, allow_large_change=False):
    rankings, metadata = {}, {}
    for name in SOURCES:
        raw = raw_sources[name]
        rows, warnings, scored = parse_source(raw, name)
        if previous and not allow_large_change:
            old = previous["sources"][name]["scoredRecords"]
            if abs(scored - old) > old * 0.20:
                raise ValueError(f"{name}: scored record count changed by over 20%; review before using --allow-large-change")
        rankings[name] = rows
        metadata[name] = {"sha256": hashlib.sha256(raw).hexdigest(),
                          "rows": len(rows), "scoredRecords": scored, "warnings": warnings}
    digest = hashlib.sha256(json.dumps(rankings, sort_keys=True).encode()).hexdigest()
    return {"schemaVersion": 1, "version": digest[:16],
            "publishedAt": datetime.now(timezone.utc).isoformat(),
            "sources": metadata, "rankings": rankings}


def write_snapshot(snapshot, output):
    # Only replace the last good file after every source and the complete release pass validation.
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent,
                                         suffix=".tmp", delete=False, newline="\n") as handle:
            temp_path = Path(handle.name)
            json.dump(snapshot, handle, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            handle.write("\n")
        os.replace(temp_path, output)
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, help="Read competing.csv, overall.csv and tanking.csv from a reviewed local export")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--allow-large-change", action="store_true", help="Allow a reviewed change in scored record count above 20 percent")
    args = parser.parse_args()

    def download(name):
        if args.source_dir:
            return name, (args.source_dir / f"{name}.csv").read_bytes()
        url = f"{SHEET}?gid={SOURCES[name]}&single=true&output=csv"
        with urlopen(url, timeout=40) as response:
            return name, response.read()

    previous = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else None
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        raw_sources = dict(pool.map(download, SOURCES))
    snapshot = prepare_snapshot(raw_sources, previous, args.allow_large_change)
    if previous and previous.get("version") == snapshot["version"]:
        print("No ranking changes. Existing snapshot and publication time retained.")
        return
    write_snapshot(snapshot, args.output)
    print(f"Prepared {args.output} (version {snapshot['version']}). No GitHub upload or deployment was made.")
    for name, source in snapshot["sources"].items():
        print(f"{name}: {source['rows']} rows, {source['scoredRecords']} scored records, {len(source['warnings'])} review warnings")


if __name__ == "__main__":
    main()

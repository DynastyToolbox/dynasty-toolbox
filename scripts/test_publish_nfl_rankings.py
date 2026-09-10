import csv
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("publisher", ROOT / "scripts/publish_nfl_rankings.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def source(count=120):
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(publisher.HEADERS)
    for index in range(count):
        writer.writerow([index + 1, f"Player {index}", "WR", "24 Years", str(1000-index)])
    return stream.getvalue().encode()


class PublicationTests(unittest.TestCase):
    def test_quoted_names_and_legacy_warnings_preserve_values_and_order(self):
        raw = source() + b'121,"Player, Junior",WR,22 Years,123.50\r\n122,Player 0,WR,24 Years,88\r\n123,,#N/A,#N/A,#N/A\r\n'
        rows, warnings, scored = publisher.parse_source(raw, "overall")
        self.assertEqual(rows[-3]["Player"], "Player, Junior")
        self.assertEqual(rows[-3]["Score"], "123.50")
        self.assertEqual(rows[-2]["Score"], "88")
        self.assertEqual(rows[-1]["Score"], "#N/A")
        self.assertEqual(len(warnings), 2)
        self.assertEqual(scored, 122)

    def test_invalid_or_partial_release_keeps_previous_file(self):
        sources = {key: source() for key in publisher.SOURCES}
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "rankings.json"
            publisher.write_snapshot(publisher.prepare_snapshot(sources), output)
            original = output.read_bytes()
            for invalid in [b'<html>Service unavailable</html>', source(12),
                            source() + b'121,Named Player,QB,24 Years,#N/A\r\n']:
                broken = {**sources, "tanking": invalid}
                with self.assertRaises(ValueError):
                    publisher.write_snapshot(publisher.prepare_snapshot(broken), output)
                self.assertEqual(output.read_bytes(), original)

    def test_large_loss_requires_explicit_override(self):
        old = publisher.prepare_snapshot({key: source(200) for key in publisher.SOURCES})
        smaller = {key: source(120) for key in publisher.SOURCES}
        with self.assertRaises(ValueError):
            publisher.prepare_snapshot(smaller, old)
        self.assertEqual(len(publisher.prepare_snapshot(smaller, old, True)["rankings"]["overall"]), 120)

    def test_committed_snapshot_has_valid_shape_and_counts(self):
        snapshot = json.loads((ROOT / "data/nfl_rankings.json").read_text(encoding="utf-8"))
        for kind in publisher.SOURCES:
            rows = snapshot["rankings"][kind]
            self.assertEqual(len(rows), snapshot["sources"][kind]["rows"])
            self.assertTrue(all(list(row) == publisher.HEADERS for row in rows))
            self.assertTrue(all(isinstance(v, str) for row in rows for v in row.values()))


if __name__ == "__main__":
    unittest.main()

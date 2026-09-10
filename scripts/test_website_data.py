import copy
import json
from pathlib import Path
import unittest
import publish_website_data as website

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'data/sheet_sources.json').read_text(encoding='utf-8'))
BUNDLE = json.loads((ROOT / 'data/site_sheets.json').read_text(encoding='utf-8'))


class WebsitePublicationTests(unittest.TestCase):
    def read(self, key, url):
        return BUNDLE['sheets'][key]['csv'].encode()

    def test_unchanged_release_preserves_archives_without_reading_them(self):
        calls = []
        def read(key, url):
            calls.append(key)
            return self.read(key, url)
        result = website.prepare(CONFIG, BUNDLE, read)
        self.assertEqual(set(calls), set(CONFIG['sources']))
        self.assertEqual(result['version'], BUNDLE['version'])
        self.assertEqual(result['sheets'], BUNDLE['sheets'])

    def test_new_mock_is_added_in_catalog_order_with_apostrophe_title(self):
        config = copy.deepcopy(CONFIG)
        draft = copy.deepcopy(config['mockDrafts'][0])
        original_id = draft['id']
        draft.update(id='september-new-mock', title="September's NFL Mock")
        config['mockDrafts'].insert(0, draft)
        def read(key, url):
            return self.read(original_id if key == draft['id'] else key, url)
        result = website.prepare(config, BUNDLE, read)
        self.assertEqual(result['mockDrafts'][0]['title'], draft['title'])
        self.assertEqual(result['sheets'][original_id], BUNDLE['sheets'][original_id])

    def test_changed_archive_link_requires_explicit_refresh(self):
        config = copy.deepcopy(CONFIG)
        draft = config['mockDrafts'][0]
        draft['url'] += '&test=correction'
        with self.assertRaises(ValueError):
            website.prepare(config, BUNDLE, self.read)
        result = website.prepare(config, BUNDLE, self.read, [draft['id']])
        # URL identity must follow an explicitly refreshed source even if its data is unchanged.
        self.assertEqual(result['sheets'][draft['id']]['url'], draft['url'])

    def test_bad_csv_and_duplicate_catalog_are_rejected(self):
        for raw in [b'<!doctype html><html>Error</html>', b'a,b\n1,2']:
            with self.assertRaises(ValueError):
                website.validate_csv(raw, next(iter(CONFIG['sources'].values())))
        config = copy.deepcopy(CONFIG)
        config['mockDrafts'].append(copy.deepcopy(config['mockDrafts'][0]))
        with self.assertRaises(ValueError):
            website.validate_catalog(config)

    def test_all_committed_csv_exports_validate(self):
        specs = {**CONFIG['sources'], **{m['id']: m for m in CONFIG['mockDrafts']}}
        for key, spec in specs.items():
            text, count = website.validate_csv(self.read(key, spec['url']), spec)
            self.assertEqual(count, BUNDLE['sheets'][key]['records'])
            self.assertEqual(text, BUNDLE['sheets'][key]['csv'])


if __name__ == '__main__':
    unittest.main()

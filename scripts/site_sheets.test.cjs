const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/site_sheets.json'), 'utf8'));
const script = fs.readFileSync(path.join(root, 'site_sheets.js'), 'utf8');

test('all sheet consumers, repeated sorts and draft navigation reuse one download', async () => {
  let calls = 0;
  const context = { window: {}, fetch: async () => { calls++; return { ok: true, json: async () => data }; } };
  vm.runInNewContext(script, context);
  const api = context.window.DynastySheets;
  await Promise.all(Object.keys(data.sheets).map(async id => assert.equal(await api.csv(id), data.sheets[id].csv)));
  const drafts = await api.mocks('nfl');
  drafts[0].title = 'Changed copy';
  assert.notEqual((await api.mocks('nfl'))[0].title, 'Changed copy');
  await api.csv('college_rankings_1');
  assert.equal(calls, 1);
  await assert.rejects(api.csv('missing'), /Missing published sheet/);
});

test('a failed request can be retried without falling back to live Sheets', async () => {
  let calls = 0;
  const context = { window: {}, fetch: async url => {
    assert.equal(url, '/data/site_sheets.json');
    return ++calls === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => data };
  } };
  vm.runInNewContext(script, context);
  await assert.rejects(context.window.DynastySheets.csv('sos_1'), /503/);
  assert.equal(await context.window.DynastySheets.csv('sos_1'), data.sheets.sos_1.csv);
});

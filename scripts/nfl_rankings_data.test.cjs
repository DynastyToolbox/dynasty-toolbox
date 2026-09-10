const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const bundle = JSON.parse(fs.readFileSync(path.join(root, 'data/nfl_rankings.json'), 'utf8'));
const code = fs.readFileSync(path.join(root, 'nfl_rankings_data.js'), 'utf8');

function setup(respond) {
  const calls = [];
  const status = { textContent: '' };
  const context = { window: {}, document: { querySelectorAll: () => [status] },
    fetch: async (...args) => { calls.push(args); return respond(calls.length); } };
  vm.runInNewContext(code, context);
  return { api: context.window.DynastyRankings, calls, status };
}
const ok = () => ({ ok: true, json: async () => structuredClone(bundle) });

test('parallel consumers and repeated filters share one request without mutating source rows', async () => {
  const { api, calls, status } = setup(ok);
  const lists = await Promise.all(['overall', 'competing', 'tanking'].map(type => api.getRows(type)));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/data/nfl_rankings.json');
  assert.equal(calls[0][1].cache, 'no-cache');
  lists[0][0].Score = '0';
  lists[0].reverse();
  assert.equal((await api.getRows('overall'))[0].Score, bundle.rankings.overall[0].Score);
  assert.equal(calls.length, 1);
  assert.match(status.textContent, /Rankings published/);
});

test('HTTP failure rejects all pending readers and a later action retries', async () => {
  const { api, calls, status } = setup(n => n === 1 ? { ok: false, status: 503 } : ok());
  const result = await Promise.allSettled([api.getRows('overall'), api.getRows('tanking')]);
  assert.ok(result.every(r => r.status === 'rejected'));
  assert.equal(calls.length, 1);
  assert.match(status.textContent, /could not load/);
  assert.ok((await api.getRows('overall')).length > 100);
  assert.equal(calls.length, 2);
});

test('incomplete releases and unknown modes cannot produce silent zero rankings', async () => {
  const { api } = setup(() => ({ ok: true, json: async () => ({ ...bundle, rankings: { overall: [] } }) }));
  await assert.rejects(api.getRows('overall'), /incomplete/);
  await assert.rejects(api.getRows('invalid'), /Unknown/);
});

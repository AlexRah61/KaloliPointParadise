// End-to-end over the CLI: a synthetic run folder -> analyze.mjs -> report.mjs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { campaignsCfg, files } from './scenario.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const root = mkdtempSync(join(tmpdir(), 'ad-funnel-'));
after(() => rmSync(root, { recursive: true, force: true }));

function makeRun(name, mutate = (f) => f) {
  const dir = join(root, name);
  for (const [path, body] of Object.entries(mutate({ ...files }))) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}
const cfgPath = join(root, 'campaigns.json');
writeFileSync(cfgPath, JSON.stringify(campaignsCfg));
const node = (script, dir) => execFileSync(process.execPath, [join(scripts, script), '--run', dir, '--campaigns', cfgPath], { encoding: 'utf8' });

test('analyze + report produce funnel.json, markdown, HTML and SVG charts without NaN', () => {
  const dir = makeRun('2026-01-02T1200');
  assert.match(node('analyze.mjs', dir), /2 campaigns/);
  node('report.mjs', dir);
  const model = JSON.parse(readFileSync(join(dir, 'funnel.json'), 'utf8'));
  assert.equal(model.campaigns.length, 2);
  assert.ok(model.findings.length > 0);
  const md = readFileSync(join(dir, 'report.md'), 'utf8');
  for (const heading of ['## Executive summary', '## Recommendations', '## Conversion by campaign', '## Scorecard', '## What works', '## What does not work, and why', '## Tracking and data quality', '### Validation checks', '## Sources for the recommendations']) {
    assert.ok(md.includes(heading), `report.md lacks ${heading}`);
  }
  assert.ok(!/NaN|undefined|\[object Object\]/.test(md), 'report.md contains NaN/undefined');
  const html = readFileSync(join(dir, 'report.html'), 'utf8');
  assert.ok(html.includes('<svg') && html.includes('<title id="funnel-t">'));
  assert.ok(!/NaN|undefined/.test(html));
  for (const chart of ['funnel', 'rates', 'daily', 'hourly', 'country']) assert.ok(existsSync(join(dir, 'charts', `${chart}.svg`)), `missing ${chart}.svg`);
});

test('a second run with the same window reports changes since the first', () => {
  const dir = makeRun('2026-01-02T1300', (f) => ({ ...f, 'run.json': JSON.stringify({ ...JSON.parse(f['run.json']), runId: '2026-01-02T1300', generatedAt: '2026-01-02T21:00:00.000Z' }) }));
  node('analyze.mjs', dir);
  node('report.mjs', dir);
  const model = JSON.parse(readFileSync(join(dir, 'funnel.json'), 'utf8'));
  assert.equal(model.deltas.previousRun, '2026-01-02T1200');
  assert.ok(readFileSync(join(dir, 'report.md'), 'utf8').includes('## Since the last report'));
});

test('missing sources are reported, not fatal', () => {
  const dir = makeRun('2026-01-02T1400', (f) => {
    const out = { ...f };
    for (const k of Object.keys(out)) if (k.startsWith('ga4/') || k === 'site.json') delete out[k];
    return out;
  });
  node('analyze.mjs', dir);
  node('report.mjs', dir);
  const model = JSON.parse(readFileSync(join(dir, 'funnel.json'), 'utf8'));
  assert.equal(model.sources.GA4.status, 'missing');
  assert.equal(model.sources.Website.status, 'missing');
  assert.equal(model.validation.find((v) => v.id === 'source-GA4').status, 'fail');
  assert.ok(!/NaN|undefined/.test(readFileSync(join(dir, 'report.md'), 'utf8')));
});

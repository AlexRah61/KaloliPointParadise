// Meta insights capture -> campaign settings, best-practice recommendations, the shared report and its PDF.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { practiceFor, recommendations } from '../scripts/lib/advice.mjs';
import { diagnose, priority } from '../scripts/lib/diagnose.mjs';
import { parseCampaignSettings, parseDateSpan } from '../scripts/lib/meta.mjs';
import { buildModel } from '../scripts/lib/model.mjs';
import { configIds, pdfName, sensitiveMatches } from '../scripts/lib/publish.mjs';
import { campaignsCfg, files, inputs } from './scenario.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, '..', 'scripts');
const bp = JSON.parse(readFileSync(join(here, '..', 'best-practices.json'), 'utf8'));
const funnelCfg = JSON.parse(readFileSync(join(here, '..', 'funnel.json'), 'utf8'));
const root = mkdtempSync(join(tmpdir(), 'ad-funnel-pdf-'));
after(() => rmSync(root, { recursive: true, force: true }));

// Ads Manager settings as collect-meta-insights.ps1 saves them: the Review tab and the edit panel's budget schedule.
const review = (name, { category = 'Housing', scheduling = 'No' } = {}) =>
  [
    '[heading] Campaign name', `[text] ${name}`, '[button] Edit',
    '[heading] Objective', '[text] Traffic', '[button] Edit',
    '[heading] Budget strategy', '[text] Campaign budget', '[text] Daily Budget $10.00', '[button] Edit',
    '[heading] Budget scheduling', '[text] Enabled:', `[text] ${scheduling}`, '[button] Edit',
    '[heading] Campaign bid strategy', '[text] Highest volume', '[button] Edit',
    '[heading] Special Ad Categories', `[text] ${category}`, '[button] Edit',
    '[heading] Special Ad Category countries', '[text] United States, Canada', '[button] Edit',
  ].join('\n');
const scheduleEdit = '[text] Budget scheduling\n[button] Spend $15 as the daily budget from Jan 2 \u2013 Jan 3 Scheduled\n[button] Add another time period';

test('campaign settings: budget, budget schedule and special ad category', () => {
  const s = parseCampaignSettings(scheduleEdit, review('Campaign B', { scheduling: 'Yes' }), 2026);
  assert.equal(s.name, 'Campaign B');
  assert.equal(s.dailyBudget, 10);
  assert.equal(s.budgetScheduling, true);
  assert.deepEqual(s.scheduledBudgets, [{ dailyBudget: 15, period: 'Jan 2 \u2013 Jan 3', status: 'Scheduled', from: '2026-01-02', to: '2026-01-03' }]);
  assert.deepEqual(s.specialAdCategories, ['Housing']);
  assert.deepEqual(parseCampaignSettings('', review('X', { category: 'None' }), 2026).specialAdCategories, []);
  assert.deepEqual(parseDateSpan('Dec 30 \u2013 Jan 2', 2026), { from: '2026-12-30', to: '2027-01-02' });
  assert.deepEqual(parseDateSpan('Oct 8, 2026, 12:00 AM \u2013 Oct 14, 2026, 12:00 AM', 2025), { from: '2026-10-08', to: '2026-10-14' });
});

const modelWith = (b = {}) => {
  const m = buildModel(inputs(funnelCfg));
  m.campaigns[0].campaignSettings = parseCampaignSettings('', review('Campaign A'), 2026);
  m.campaigns[1].campaignSettings = parseCampaignSettings(scheduleEdit, review('Campaign B', { scheduling: 'Yes', ...b }), 2026);
  return m;
};

test('A/B test length, budget parity and the Housing category become findings', () => {
  const f = diagnose(modelWith({ category: 'None' }), funnelCfg, campaignsCfg);
  const one = (id) => f.find((x) => x.id === id);
  assert.match(one('ab-duration').title, /runs 6 days, under Meta's 7-day minimum/);
  assert.match(one('ab-duration').action, /ending Jan 8 or later/);
  assert.match(one('ab-budget').title, /same budget on 2 test days/);
  assert.match(one('ab-budget').evidence, /^Jan 2: Video A \$10\.00 vs Video B \$15\.00; Jan 3: /);
  assert.equal(one('special-ad-category').campaign, 'b');
  assert.equal(one('special-ad-category-ok'), undefined);
  const ok = diagnose(modelWith(), funnelCfg, campaignsCfg);
  assert.equal(ok.find((x) => x.id === 'special-ad-category'), undefined);
  assert.equal(ok.find((x) => x.id === 'special-ad-category-ok').positive, true);
});

test('every finding cites a best practice, and recommendations are ranked with labelled evidence', () => {
  const src = readFileSync(join(scripts, 'lib', 'diagnose.mjs'), 'utf8');
  const ids = [
    ...[...src.matchAll(/\bid: '([a-z0-9-]+)'/g)].map((x) => x[1]),
    ...[...src.matchAll(/\bid: \w+ \? '([a-z0-9-]+)' : '([a-z0-9-]+)'/g)].flatMap((x) => [x[1], x[2]]),
    ...['day', 'trend', 'today'].flatMap((s) => [`${s}-cheaper`, `${s}-costlier`]),
  ];
  assert.ok(ids.length >= 35, `only ${ids.length} finding ids found`);
  for (const id of ids) {
    const b = practiceFor(bp, { id });
    assert.notEqual(b.key, 'default', `${id} has no best practice`);
    assert.ok(b.practice && b.expect && b.check && b.sources.length, `${id} lacks practice, expect, check or a source`);
  }
  assert.equal(practiceFor(bp, { id: 'ab-ctr', positive: true }).key, 'ab-winner');
  for (const s of Object.values(bp.sources)) assert.match(s.url, /^https:\/\/\S+$/);

  const m = modelWith();
  m.findings = diagnose(m, funnelCfg, campaignsCfg);
  const recs = recommendations(m, bp, priority);
  for (let i = 1; i < recs.length; i++) assert.ok(priority(recs[i - 1]) >= priority(recs[i]), 'recommendations out of order');
  assert.ok(recs.every((r) => !r.positive && r.basis.sources.length));
  const multi = recs.find((r) => r.campaigns.length > 1);
  if (multi) assert.match(multi.evidence, /^Video [AB]: .+; Video [AB]: /);
});

test('PDF file names group by campaign, then report date, then extraction time', () => {
  const name = (extractedAt) => pdfName({ campaigns: ['Hawaii House Sale', 'Test - Hawaii House Sale'], reportDate: '2026-10-08', extractedAt, timeZone: 'America/Los_Angeles' });
  const first = name('2026-10-09T02:30:00Z');
  const second = name('2026-10-09T05:05:00Z');
  assert.equal(first, 'Hawaii House Sale + Test - Hawaii House Sale_report 2026-10-08_extracted 2026-10-08 1930 PDT.pdf');
  assert.equal(second, 'Hawaii House Sale + Test - Hawaii House Sale_report 2026-10-08_extracted 2026-10-08 2205 PDT.pdf');
  assert.deepEqual([second, first].sort(), [first, second]);
  assert.equal(pdfName({ campaigns: ['A/B: "x"?'], reportDate: '2026-01-02', extractedAt: '2026-01-02T20:00:00Z', timeZone: 'America/Los_Angeles' }), 'A B x_report 2026-01-02_extracted 2026-01-02 1200 PST.pdf');
});

test('the shared report is checked for account IDs and personal data', () => {
  const ids = configIds({ meta: { adAccountId: '1234567890123456', timezone: 'America/Los_Angeles' }, edge: { profileDirectory: 'Default' }, cf: { zoneId: 'abcdef0123456789abcdef0123456789' }, turnstile: '0xAAAAAAAAtestkey00' });
  assert.deepEqual(ids, ['1234567890123456', 'abcdef0123456789abcdef0123456789', '0xAAAAAAAAtestkey00']);
  const clean = '<p>$12.65 spent, 3,041 impressions, 2026-10-08, CTR 5.9%, Oct 8, 1:05 PM.</p><img src="data:image/png;base64,AAAA1234567890123456AAAA">';
  assert.deepEqual(sensitiveMatches(clean, ids), []);
  const bad = sensitiveMatches('<p>act 1234567890123456; owner@example.com; (555) 555-0142; 203.0.113.7; C:\\Users\\someone\\report.html</p>', ids);
  assert.equal(bad.length, 5, bad.join(' | '));
  assert.ok(bad.every((x) => !x.includes('1234567890123456') && !x.includes('owner@example.com')), 'findings must not echo the value');
});

// --- End to end: a synthetic run with Meta's charts and settings -> analyze -> report -> PDF.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const insights = {
  'meta/insights/insights.json': JSON.stringify({
    range: '2026-01-01_2026-01-03',
    collectedAt: '2026-01-02T20:05:00.000Z',
    abTest: 'ab-test.png',
    campaigns: [
      { name: 'Campaign A', id: '9990001112223334', charts: [{ file: 'a-performance.png', kind: 'performance', title: 'Performance over time: Per Landing Page View' }], settings: { edit: 'a-edit.txt', review: 'a-review.txt' }, errors: [] },
      { name: 'Campaign B', id: '9990001112223335', charts: [{ file: 'b-demographics.png', kind: 'demographics', title: 'Age and gender distribution' }], settings: { edit: 'b-edit.txt', review: 'b-review.txt' }, errors: [] },
    ],
  }),
  'meta/insights/ab-test.png': PNG,
  'meta/insights/a-performance.png': PNG,
  'meta/insights/b-demographics.png': PNG,
  'meta/insights/a-edit.txt': '',
  'meta/insights/a-review.txt': review('Campaign A'),
  'meta/insights/b-edit.txt': scheduleEdit,
  'meta/insights/b-review.txt': review('Campaign B', { scheduling: 'Yes' }),
};
function makeRun(name, cfg) {
  const dir = join(root, name);
  for (const [path, body] of Object.entries({ ...files, ...insights })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  const cfgPath = join(root, `${name}.json`);
  writeFileSync(cfgPath, JSON.stringify(cfg));
  for (const script of ['analyze.mjs', 'report.mjs']) execFileSync(process.execPath, [join(scripts, script), '--run', dir, '--campaigns', cfgPath], { encoding: 'utf8' });
  return dir;
}
const exportPdf = (dir, out) => spawnSync(process.execPath, [join(scripts, 'export-pdf.mjs'), '--run', dir, '--out', out], { encoding: 'utf8', timeout: 180e3 });
const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].some((p) => existsSync(p)) || !!process.env.EDGE_PATH;

test('the report adds the executive summary, cited recommendations and Meta charts; the shared copy has no individual requests', () => {
  const dir = makeRun('2026-01-02T1200', campaignsCfg);
  const model = JSON.parse(readFileSync(join(dir, 'funnel.json'), 'utf8'));
  assert.equal(model.metaInsights.campaigns.length, 2);
  assert.equal(model.campaigns[1].campaignSettings.scheduledBudgets[0].dailyBudget, 15);
  assert.ok(model.changes.some((c) => c.what === 'Video B: scheduled daily budget $15.00 for Jan 2 \u2013 Jan 3 (Ads Manager budget scheduling)'));
  for (const id of ['ab-budget', 'ab-duration', 'special-ad-category-ok']) assert.ok(model.findings.some((f) => f.id === id), `missing finding ${id}`);
  const md = readFileSync(join(dir, 'report.md'), 'utf8');
  for (const s of ['## Executive summary', '**In one line:**', '## Recommendations', '**Best practice:**', 'https://www.facebook.com/business/help/1738164643098669', '## Meta Ads Manager charts', 'meta/insights/a-performance.png', 'Performance over time: cost per landing page view', 'Video B: scheduled daily budget $15.00 for Jan 2']) {
    assert.ok(md.includes(s), `report.md lacks ${s}`);
  }
  const full = readFileSync(join(dir, 'report.html'), 'utf8');
  const shared = readFileSync(join(dir, 'report-public.html'), 'utf8');
  assert.ok(full.includes('data:image/png;base64,') && shared.includes('data:image/png;base64,'));
  assert.ok(full.includes('<th>Visit seen by the website</th>'));
  assert.ok(!shared.includes('<th>Visit seen by the website</th>') && shared.includes('Individual requests are listed only'));
  assert.ok(!/NaN|undefined/.test(md + shared));
});

test('export-pdf prints the shared report and files it under its campaign / date name', { skip: !edge && 'Microsoft Edge is not installed' }, () => {
  const dir = makeRun('2026-01-02T1205', campaignsCfg);
  const out = join(root, 'filed');
  const res = exportPdf(dir, out);
  assert.equal(res.status, 0, res.stderr);
  const info = JSON.parse(readFileSync(join(dir, 'pdf.json'), 'utf8'));
  assert.equal(info.name, 'Campaign A + Campaign B_report 2026-01-02_extracted 2026-01-02 1200 PST.pdf');
  assert.ok(info.pages >= 3, `${info.pages} pages`);
  assert.deepEqual(info.sensitive, []);
  assert.equal(readFileSync(join(out, info.name)).subarray(0, 5).toString('latin1'), '%PDF-');
});

test('export-pdf keeps a report with personal data out of the repository folder', { skip: !edge && 'Microsoft Edge is not installed' }, () => {
  const cfg = { ...campaignsCfg, campaigns: campaignsCfg.campaigns.map((c) => (c.key === 'a' ? { ...c, label: 'Video A (owner@example.com)' } : c)) };
  const dir = makeRun('2026-01-02T1210', cfg);
  const out = join(root, 'blocked');
  const res = exportPdf(dir, out);
  assert.equal(res.status, 3);
  assert.match(res.stderr, /email address/);
  assert.ok(!existsSync(out) || readdirSync(out).length === 0);
  assert.ok(existsSync(join(dir, 'report.pdf')), 'the local PDF is still written');
});

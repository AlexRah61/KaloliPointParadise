import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deltas, diagnose, validate } from '../scripts/lib/diagnose.mjs';
import { buildModel, utmMatcher } from '../scripts/lib/model.mjs';
import { campaignsCfg, inputs } from './scenario.mjs';

const funnelCfg = JSON.parse(readFileSync(new URL('../funnel.json', import.meta.url), 'utf8'));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const model = () => buildModel(inputs(funnelCfg));

test('utmMatcher matches exact values case-insensitively and /regex/ patterns', () => {
  assert.ok(utmMatcher('Shared_Tag')('shared_tag'));
  assert.ok(!utmMatcher('shared_tag')('shared_tag_2'));
  assert.ok(utmMatcher('/video_b/i')('Video_B_tag'));
});

test('Meta delivery is summed per campaign and matches the country breakdown', () => {
  const m = model();
  const [a, b] = m.campaigns;
  assert.deepEqual([a.key, b.key], ['a', 'b']);
  assert.deepEqual([a.funnel.impressions, a.funnel.clicks, a.funnel.lpv, a.funnel.spend], [1600, 32, 28, 8]);
  assert.deepEqual([b.funnel.impressions, b.funnel.clicks, b.funnel.lpv, b.funnel.spend], [1500, 16, 14, 7]);
  assert.equal(a.funnel.reach, 1350);
  near(a.rates.ctr, 0.02);
  near(a.rates.lpvPerClick, 28 / 32);
  near(a.rates.costPerLpv, 8 / 28);
  assert.deepEqual(a.liveUtm, ['shared_tag']);
});

test('a shared UTM value is split by landing page views in the period each ad carried it', () => {
  const m = model();
  const row = m.ga4.rows.find((r) => r.campaign === 'shared_tag');
  assert.equal(row.kind, 'shared');
  // Video A still carries the tag (28 page views); Video B only until 10:00 on Jan 2 (8 + 4 page views).
  near(row.weights.a, 0.7);
  near(row.weights.b, 0.3);
  const [a, b] = m.campaigns;
  near(a.funnel.sessions, 14);
  near(b.funnel.sessions, 11);
  assert.equal(a.ga4.estimated, true);
  near(a.funnel.cta, 1.4);
  near(b.funnel.cta, 1.6);
  assert.equal(m.ga4.rows.find((r) => r.campaign === '(direct)').kind, 'non-ad');
  assert.equal(m.ga4.rows.find((r) => r.campaign === '(cross-network)').kind, 'pending');
  assert.equal(m.ga4.rows.find((r) => r.campaign === 'qa_tag').kind, 'ignored');
  assert.equal(m.ga4.rows.find((r) => r.campaign === 'mystery').kind, 'unmapped');
  near(m.total.funnel.sessions, 37);
  near(a.funnel.sessionsEstimated, 14 + 10 * (28 / 42));
});

test('stored requests are attributed by UTM; untagged social and internal requests are kept apart', () => {
  const m = model();
  const [a, b] = m.campaigns;
  assert.equal(a.funnel.leads, 0);
  assert.equal(b.funnel.leads, 1);
  assert.equal(m.leads.real, 3);
  assert.equal(m.leads.test, 1);
  assert.equal(m.leads.metaUntagged, 1);
  assert.equal(m.leads.internal, 1);
  assert.equal(m.total.funnel.leads, 1);
  near(b.rates.lpvToLead, 1 / 14);
  assert.equal(m.leads.rows.find((r) => r.created_at.endsWith('19:45:00.000Z')).attribution, 'internal (owner or QA address)');
});

test('zero-lead check, pacing and site summary are computed', () => {
  const m = model();
  const [a] = m.campaigns;
  near(a.zeroLeadCheck.chanceOfZero, Math.pow(1 - funnelCfg.benchmarks.leadPerLpv, 28));
  near(a.pacing.days, 1.5);
  near(a.pacing.ratio, 8 / 15);
  assert.equal(m.site.inApp.visits, 3);
  assert.equal(m.site.inApp.formOpened, 1);
  assert.equal(m.site.hoursToday[9], 3);
});

test('diagnose raises the expected findings with evidence and sorts them by value', () => {
  const m = model();
  const findings = diagnose(m, funnelCfg, campaignsCfg);
  const ids = findings.map((f) => f.id);
  for (const id of ['geo-outside-target', 'pacing', 'utm-shared', 'utm-unmapped', 'ab-key-metric', 'objective-traffic', 'utm-dynamic', 'zero-leads-normal', 'pixel-vs-db']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  const geo = findings.find((f) => f.id === 'geo-outside-target');
  assert.equal(geo.campaign, 'a');
  assert.match(geo.evidence, /JP \$1\.00/);
  for (const f of findings) {
    for (const k of ['title', 'evidence', 'why', 'action']) assert.ok(f[k] && !/NaN|undefined/.test(f[k]), `${f.id}.${k}: ${f[k]}`);
  }
  assert.equal(findings[0].impact, 'high');
  assert.ok(m.campaigns.every((c) => typeof c.verdict.status === 'string'));
});

test('spend in a country removed today is context, not a new problem', () => {
  const inp = inputs(funnelCfg);
  inp.campaignsCfg = { ...campaignsCfg, changes: [{ at: '2026-01-02T09:00:00-08:00', what: 'JP removed', removedCountries: ['JP'] }] };
  const m = buildModel(inp);
  const ids = diagnose(m, funnelCfg, inp.campaignsCfg).map((f) => f.id);
  assert.ok(ids.includes('geo-removed-today'));
  assert.ok(!ids.includes('geo-outside-target'));
});

test('website rules fire on first-screen exits and unfinished forms', () => {
  const m = model();
  m.site.inApp = { ...m.site.inApp, visits: 40, formOpened: 6, requestSent: 0 };
  m.site.depth = [
    { section: 'top', visits: 22 },
    { section: 'gallery', visits: 18 },
  ];
  m.site.markerSections = ['gallery', 'film'];
  m.total.funnel.formStarts = 11;
  m.total.funnel.leads = 0;
  const findings = diagnose(m, funnelCfg, campaignsCfg);
  const exit = findings.find((f) => f.id === 'first-screen-exit');
  assert.ok(exit, 'first-screen-exit missing');
  assert.match(exit.title, /^55% .* before reaching the gallery$/);
  const form = findings.find((f) => f.id === 'form-friction');
  assert.ok(form, 'form-friction missing');
  assert.match(form.evidence, /0 of 11 has a 2% chance/);
});

test('the country check allows a little more delivery in the later export only while the ads run', () => {
  const m = model();
  const status = () => validate(m, { sources: {} }).find((c) => c.id === 'meta-sum-a');
  const country = m.campaigns[0].meta.countries[0];
  country.spend += 0.25; // $8.00 -> $8.25 arrived between the daily and the country export
  assert.equal(status().status, 'pass');
  assert.match(status().detail, /taken after the daily one while the ads were delivering/);
  m.run.until = '2026-01-01'; // a window that ended yesterday cannot change between exports
  assert.equal(status().status, 'warn');
  m.run.until = '2026-01-02';
  country.spend -= 0.5; // less in the later export is a real mismatch
  assert.equal(status().status, 'warn');
});

test('validation passes on consistent inputs and deltas compare runs with the same window', () => {
  const m = model();
  const checks = validate(m, {
    sources: { Meta: { status: 'ok' }, GA4: { status: 'ok' }, Website: { status: 'ok' }, Leads: { status: 'ok' } },
    metaExports: [{ name: 'daily', ok: true, rows: 4, requested: '2026-01-01_2026-01-03', reportingStarts: '2026-01-01', reportingEnds: '2026-01-02' }],
  });
  const byId = Object.fromEntries(checks.map((c) => [c.id, c.status]));
  assert.equal(byId['meta-sum-a'], 'pass');
  assert.equal(byId['meta-sum-b'], 'pass');
  assert.equal(byId['meta-range-daily'], 'pass');
  assert.equal(byId['ga4-tables-consistent'], 'pass');
  assert.equal(byId['ga4-rows-sum'], 'pass');
  assert.equal(byId['funnel-order-a'], 'pass');
  // 2 unmapped sessions out of 37 ad sessions is below the 5% / 2-session noise floor.
  assert.equal(byId.mapping, 'pass');
  const prev = structuredClone(m);
  prev.run.generatedAt = '2026-01-02T18:00:00.000Z';
  prev.campaigns[0].funnel.clicks -= 5;
  prev.total.funnel.clicks -= 5;
  const d = deltas(m, prev);
  assert.equal(d.campaigns.a.clicks, 5);
  assert.equal(d.total.clicks, 5);
  assert.equal(deltas(m, { ...prev, run: { ...prev.run, since: '2025-12-01' } }), null);
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { costChange, comparePeriods, dayOverDay, recentTrend, sameTimeYesterday, siteDaily, siteDayOverDay, siteSameTime } from '../scripts/lib/daily.mjs';
import { diagnose, validate } from '../scripts/lib/diagnose.mjs';
import { buildModel } from '../scripts/lib/model.mjs';
import { campaignsCfg, multiDayFiles, multiDayInputs } from './scenario.mjs';

const funnelCfg = JSON.parse(readFileSync(new URL('../funnel.json', import.meta.url), 'utf8'));
const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const day = (d, impressions, clicks, lpv, spend, extra = {}) => ({ day: d, impressions, clicks, lpv, spend, leads: 0, ...extra });

test('cost per page view change uses a Poisson test on page views', () => {
  const c = costChange(9, 9, 5, 18);
  near(c.from, 1);
  near(c.to, 5 / 18);
  near(c.change, 5 / 18 - 1);
  near(c.z, Math.log(5 / 18) / Math.sqrt(1 / 9 + 1 / 18));
  assert.ok(c.pValue < 0.01);
  near(c.noise, Math.exp(1.96 * Math.sqrt(1 / 9 + 1 / 18)) - 1);
  assert.equal(costChange(5, 0, 5, 10), null);
});

test('comparePeriods labels direction, significance and drivers', () => {
  const steady = comparePeriods(day('a', 1000, 20, 18, 5), day('b', 1000, 20, 18, 5.2));
  assert.equal(steady.direction, 'steady');
  assert.equal(steady.significant, false);
  const worse = comparePeriods(day('a', 1000, 30, 27, 5), day('b', 1000, 10, 9, 5));
  assert.equal(worse.direction, 'costlier');
  assert.equal(worse.significant, true);
  assert.ok(worse.ctr.pValue < 0.01 && worse.ctr.p1 < worse.ctr.p2);
  near(worse.cpmChange, 0);
  const noisy = comparePeriods(day('a', 500, 5, 5, 2.5), day('b', 500, 6, 6, 2));
  assert.equal(noisy.direction, 'cheaper');
  assert.equal(noisy.significant, false);
});

test('day over day ignores today and needs two complete days; the trend needs four', () => {
  const days = [day('d1', 1000, 10, 9, 9), day('d2', 1000, 20, 18, 5), day('d3', 600, 12, 10, 3)];
  const dd = dayOverDay(days, 'd3', 0.1);
  assert.equal(dd.previousDay, 'd1');
  assert.equal(dd.latestDay, 'd2');
  assert.equal(dd.direction, 'cheaper');
  assert.equal(dayOverDay(days.slice(1), 'd3', 0.1), null);
  assert.equal(recentTrend(days, 'd3', 0.1), null);
  const week = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'].map((d, i) => day(d, 1000, 10 + 3 * i, 9 + 3 * i, 5));
  const t = recentTrend(week, 'd8', 0.1);
  assert.deepEqual(t.beforeDays, ['d2', 'd3', 'd4']);
  assert.deepEqual(t.recentDays, ['d5', 'd6', 'd7']);
  assert.equal(t.direction, 'cheaper');
  assert.equal(t.significant, true);
});

test('today is compared with yesterday only up to the last complete hour', () => {
  const h = (key, impressions, clicks, lpv, spend) => ({ key, impressions, clicks, lpv, spend });
  const s = sameTimeYesterday([h(9, 600, 12, 10, 3), h(12, 100, 2, 2, 0.5)], [h(8, 400, 8, 7, 2), h(14, 600, 12, 11, 3)], 12.6, 0.1);
  assert.equal(s.untilHour, 12);
  assert.equal(s.later.impressions, 600);
  assert.equal(s.earlier.impressions, 400);
  assert.equal(s.direction, 'steady');
  assert.equal(sameTimeYesterday([h(9, 1, 1, 1, 1)], [], 12, 0.1), null);
  assert.equal(sameTimeYesterday([h(9, 1, 1, 1, 1)], [h(9, 1, 1, 1, 1)], 0.5, 0.1), null);
});

test('website behaviour is summarised and compared by day', () => {
  const v = (dayKey, hour, depth, formOpened = false) => ({ day: dayKey, hour, depth, formOpened, film: false, requestSent: false });
  const visits = [
    ...Array.from({ length: 40 }, (_, i) => v('d1', 9, i < 30 ? 'top' : 'gallery')),
    ...Array.from({ length: 40 }, (_, i) => v('d2', 9, i < 10 ? 'top' : 'gallery', i === 39)),
    ...Array.from({ length: 10 }, (_, i) => v('d3', 9, i < 2 ? 'top' : 'film')),
  ];
  const rows = siteDaily(visits, 'd3');
  assert.deepEqual(rows.map((r) => [r.day, r.partial, r.visits, r.pastHero]), [['d1', false, 40, 10], ['d2', false, 40, 30], ['d3', true, 10, 8]]);
  const dd = siteDayOverDay(rows);
  assert.equal(dd.latestDay, 'd2');
  assert.ok(dd.pastHero.pValue < 0.001 && dd.pastHero.p1 > dd.pastHero.p2);
  const st = siteSameTime(visits, 'd3', 'd2', 12);
  assert.equal(st.later.visits, 10);
  assert.equal(st.earlier.visits, 40);
});

test('the model builds daily rows, comparisons and checks for every campaign and the total', () => {
  const m = buildModel(multiDayInputs(funnelCfg));
  const [a, b] = m.campaigns;
  assert.deepEqual(a.daily.map((d) => [d.day, d.partial]), [['2025-12-31', false], ['2026-01-01', false], ['2026-01-02', true]]);
  assert.equal(a.dayOverDay.direction, 'cheaper');
  assert.equal(a.dayOverDay.significant, true);
  assert.equal(b.dayOverDay.direction, 'costlier');
  assert.equal(b.dayOverDay.significant, true);
  assert.equal(b.daily.at(-1).leads, 1);
  assert.equal(a.sameTime.untilHour, 12);
  assert.equal(a.sameTime.direction, 'steady');
  assert.equal(b.sameTime.direction, 'cheaper');
  assert.equal(b.sameTime.significant, false);
  assert.deepEqual(m.total.daily.map((d) => d.impressions), [2000, 2000, 1100]);
  assert.ok(m.total.dayOverDay);

  const findings = diagnose(m, funnelCfg, campaignsCfg);
  const cheaper = findings.find((f) => f.id === 'day-cheaper');
  assert.equal(cheaper.campaign, 'a');
  assert.equal(cheaper.positive, true);
  const costlier = findings.find((f) => f.id === 'day-costlier');
  assert.equal(costlier.campaign, 'b');
  assert.match(costlier.why, /fatigue/);
  assert.match(costlier.evidence, /CTR 3\.0% \u2192 1\.0%/);
  assert.ok(!findings.some((f) => f.id === 'today-cheaper'), 'insignificant moves are not findings');

  const checks = validate(m, { sources: {}, metaExports: [] });
  assert.equal(checks.find((x) => x.id === 'meta-hours-a').status, 'pass');
  assert.equal(checks.find((x) => x.id === 'meta-hours-b').status, 'pass');
});

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const root = mkdtempSync(join(tmpdir(), 'ad-funnel-days-'));
after(() => rmSync(root, { recursive: true, force: true }));

test('the report shows the day-over-day section, the trend chart and today vs yesterday', () => {
  const dir = join(root, '2026-01-02T1230');
  for (const [path, body] of Object.entries(multiDayFiles)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  const cfg = join(root, 'campaigns.json');
  writeFileSync(cfg, JSON.stringify(campaignsCfg));
  for (const s of ['analyze.mjs', 'report.mjs']) execFileSync(process.execPath, [join(scripts, s), '--run', dir, '--campaigns', cfg], { encoding: 'utf8' });
  const md = readFileSync(join(dir, 'report.md'), 'utf8');
  assert.ok(md.includes('## Day over day'));
  assert.match(md, /Day over day \(Jan 1 vs Dec 31\):\*\* Video A cheaper, \u221272% cost per page view; Video B costlier, \+200% cost per page view/);
  assert.ok(md.includes('### Today until 12 PM vs yesterday until 12 PM'));
  assert.match(md, /\| Video B \| Jan 2 \(today, so far\) \|/);
  assert.ok(!/NaN|undefined/.test(md));
  assert.ok(existsSync(join(dir, 'charts', 'trend.svg')));
  assert.ok(readFileSync(join(dir, 'report.html'), 'utf8').includes('<title id="trend-t">'));
});

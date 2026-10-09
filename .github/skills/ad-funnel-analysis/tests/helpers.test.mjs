import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv, toNumber } from '../../_shared/csv.mjs';
import { addDays, datesBetween, zonedDate, zonedHour, zonedMidnightUtc } from '../../_shared/time.mjs';
import { int, money, pct, seconds, signed } from '../scripts/lib/format.mjs';
import { classifyAgent, ipId, summarizeVisits } from '../scripts/lib/site.mjs';
import { binomialCdf, chanceOfZero, triesForEvidence, twoProportion, wilson } from '../scripts/lib/stats.mjs';

test('parseCsv handles BOM, quotes, embedded commas, doubled quotes and CRLF', () => {
  const rows = parseCsv('\uFEFFa,"b, c",d\r\n1,"x ""y""",\r\n\r\n');
  assert.deepEqual(rows, [{ a: '1', 'b, c': 'x "y"', d: '' }]);
  assert.equal(toNumber('$1,234.50'), 1234.5);
  assert.equal(toNumber('—'), 0);
});

test('zoned helpers follow the ad account time zone across daylight saving', () => {
  assert.equal(zonedMidnightUtc('2026-10-08', 'America/Los_Angeles').toISOString(), '2026-10-08T07:00:00.000Z');
  assert.equal(zonedMidnightUtc('2026-11-02', 'America/Los_Angeles').toISOString(), '2026-11-02T08:00:00.000Z');
  assert.equal(zonedMidnightUtc('2026-10-08', 'Pacific/Honolulu').toISOString(), '2026-10-08T10:00:00.000Z');
  assert.equal(zonedDate(Date.parse('2026-10-09T03:00:00Z'), 'America/Los_Angeles'), '2026-10-08');
  assert.equal(zonedHour(Date.parse('2026-10-09T03:00:00Z'), 'America/Los_Angeles'), 20);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.deepEqual(datesBetween('2026-10-30', '2026-11-01'), ['2026-10-30', '2026-10-31', '2026-11-01']);
});

test('statistics match hand-computed values', () => {
  const t = twoProportion(50, 1000, 30, 1000);
  assert.ok(Math.abs(t.z - 2.2822) < 0.001);
  assert.ok(Math.abs(t.pValue - 0.0225) < 0.001);
  assert.equal(twoProportion(1, 0, 1, 10), null);
  const w = wilson(0, 100);
  assert.equal(w.low, 0);
  assert.ok(Math.abs(w.high - 0.037) < 0.001);
  assert.ok(Math.abs(chanceOfZero(92, 0.005) - 0.6308) < 0.0005);
  assert.equal(triesForEvidence(0.005), 598);
  assert.ok(Math.abs(binomialCdf(0, 11, 0.3) - Math.pow(0.7, 11)) < 1e-12);
  assert.ok(Math.abs(binomialCdf(2, 5, 0.5) - 0.5) < 1e-12);
  assert.ok(Math.abs(binomialCdf(5, 5, 0.3) - 1) < 1e-12);
});

test('formatters never print NaN or undefined', () => {
  for (const f of [int, money, pct, seconds, (v) => signed(v)]) {
    for (const v of [undefined, null, NaN, Infinity]) assert.equal(f(v), '–');
  }
  assert.equal(money(3.456), '$3.46');
  assert.equal(pct(0.0123), '1.2%');
  assert.equal(pct(0.004), '0.40%');
  assert.equal(seconds(95), '1m 35s');
  assert.equal(signed(-3), '−3');
  assert.equal(signed(-0.2), '±0');
  assert.equal(signed(0.4, money), '+$0.40');
});

test('agent classification separates in-app browsers, crawlers and tools', () => {
  const ig = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0';
  const fb = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0;]';
  assert.equal(classifyAgent(ig), 'instagram');
  assert.equal(classifyAgent(fb), 'facebook');
  assert.equal(classifyAgent('facebookexternalhit/1.1'), 'meta-crawler');
  assert.equal(classifyAgent('Mozilla/5.0 HeadlessChrome/129.0'), 'dev');
  assert.equal(classifyAgent('Mozilla/5.0 (compatible; Googlebot/2.1)', 'Search Engine Crawler'), 'verified-bot');
  assert.equal(classifyAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0 Safari/537.36'), 'browser');
  assert.equal(classifyAgent('zgrab/0.x'), 'bot');
});

test('ipId keeps IPv4 and reduces IPv6 to its /64 network', () => {
  assert.equal(ipId('203.0.113.9'), '203.0.113.9');
  assert.equal(ipId('2001:db8:1:2:aaaa::1'), '2001:0db8:0001:0002');
  assert.equal(ipId('2001:db8::1'), '2001:0db8:0000:0000');
});

test('summarizeVisits counts depth, form opens and median duration', () => {
  const order = ['top', 'residence', 'gallery', 'film'];
  const v = (depth, seconds, extra = {}) => ({ depth, seconds, country: 'US', day: '2026-01-01', source: 'facebook', formOpened: false, film: false, requestSent: false, sampled: false, ...extra });
  const s = summarizeVisits([v('top', 3), v('gallery', 70, { formOpened: true }), v('film', 200, { film: true })], order, 'gallery');
  assert.equal(s.visits, 3);
  assert.equal(s.pastHero, 2);
  assert.equal(s.engagedDepth, 2);
  assert.equal(s.formOpened, 1);
  assert.equal(s.film, 1);
  assert.equal(s.overOneMinute, 2);
  assert.equal(s.medianSeconds, 70);
});

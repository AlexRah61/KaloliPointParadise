import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv } from '../../_shared/csv.mjs';
import { normalizeMetaRows, parseExperiment, parseManageTable, parseUrlTags } from '../scripts/lib/meta.mjs';
import { ADS_TABLE, DAILY_HEADER, EXPERIMENT, HOURLY_HEADER, metaCsv } from './fixtures.mjs';

test('normalizeMetaRows maps export columns to funnel keys and numbers', () => {
  const rows = normalizeMetaRows(parseCsv(metaCsv(DAILY_HEADER, [['Campaign A', 'Set A', 'Video A ad', '2026-01-02', 900, 1000, 20, 18, '', '3.50', '2026-01-01', '2026-01-07']])));
  assert.deepEqual(rows[0], {
    campaign: 'Campaign A',
    adset: 'Set A',
    ad: 'Video A ad',
    day: '2026-01-02',
    reach: 900,
    impressions: 1000,
    clicks: 20,
    lpv: 18,
    metaLeads: 0,
    spend: 3.5,
    reportingStarts: '2026-01-01',
    reportingEnds: '2026-01-07',
  });
});

test('normalizeMetaRows reads the hour from the hourly breakdown', () => {
  const rows = normalizeMetaRows(parseCsv(metaCsv(HOURLY_HEADER, [['Campaign A', '09:00:00 - 09:59:59', 100, 3, 3, '0.5', '2026-01-01', '2026-01-01']])));
  assert.equal(rows[0].hour, 9);
  assert.equal(rows[0].clicks, 3);
});

test('parseUrlTags decodes URL parameters', () => {
  assert.deepEqual(parseUrlTags('utm_source=meta&utm_campaign=a%20b&utm_content={{ad.name}}'), {
    utm_source: 'meta',
    utm_campaign: 'a b',
    utm_content: '{{ad.name}}',
  });
  assert.deepEqual(parseUrlTags(''), {});
});

test('parseManageTable reads each ad row after its switch', () => {
  const ads = parseManageTable(ADS_TABLE);
  assert.equal(ads.length, 2);
  assert.equal(ads[0].name, 'Video A ad');
  assert.equal(ads[0].delivery, 'Active');
  assert.equal(ads[0].utm.utm_campaign, 'shared_tag');
  assert.equal(ads[0].website, 'https://example.com/');
  assert.equal(ads[1].delivery, 'Learning');
  assert.ok(!ads[0].cells.includes('Edit column'));
});

test('parseExperiment reads status, key metric, objective, duration and arms', () => {
  const x = parseExperiment(EXPERIMENT);
  assert.equal(x.status, 'Test in progress');
  assert.equal(x.keyMetric, 'Cost per post engagement');
  assert.equal(x.objective, 'Traffic');
  assert.equal(x.spent, '$9.50');
  assert.match(x.duration, /^Jan 1, 2026/);
  assert.deepEqual(x.arms, [
    { arm: 'A', name: 'Campaign A', value: '$0.03' },
    { arm: 'B', name: 'Campaign B', value: '$0.02' },
  ]);
});

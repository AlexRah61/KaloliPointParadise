import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeEventTables, parseCell, parseGa4Table } from '../scripts/lib/ga4.mjs';
import { ga4Text } from './fixtures.mjs';

test('parseCell reads GA4 number, percent, duration and money cells', () => {
  assert.equal(parseCell('64 (46.04%)'), 64);
  assert.equal(parseCell('1,234 (5%)'), 1234);
  assert.equal(parseCell('22.3% Avg 0%'), 0.223);
  assert.equal(parseCell('1m 13s Avg 0%'), 73);
  assert.equal(parseCell('1h 2m 3s'), 3723);
  assert.equal(parseCell('0s'), 0);
  assert.equal(parseCell('2.00 100% of total'), 2);
  assert.equal(parseCell('$0.00 (–)'), 0);
  assert.equal(parseCell(undefined), null);
  assert.equal(parseCell('n/a'), null);
});

test('parseGa4Table maps rows by header, with or without a checkbox, a warning or an empty dimension', () => {
  const lines = ga4Text('Session campaign', [
    { name: '(direct)', sessions: 64, engaged: 17, seconds: 95, events: 16 },
    { name: '(not set)', sessions: 34, engaged: 0, seconds: 64, events: 4, keyEvents: 1, checkbox: false, warning: true },
    { name: 'video_b_tag', sessions: 10, engaged: 5, seconds: 30, events: 2 },
    { name: '', sessions: 2, engaged: 0, seconds: 7, events: 0, checkbox: false },
  ]);
  const t = parseGa4Table(lines);
  assert.equal(t.dimension, 'Session campaign');
  assert.equal(t.rows.length, 4);
  assert.deepEqual(
    t.rows.map((r) => r.dimension),
    ['(direct)', '(not set)', 'video_b_tag', '(empty)'],
  );
  assert.equal(t.rows[0].sessions, 64);
  assert.equal(t.rows[0].avgEngagementSec, 95);
  assert.equal(t.rows[1].keyEvents, 1);
  assert.equal(t.rows[2].eventCount, 2);
  assert.equal(t.totals.sessions, 110);
  assert.equal(t.totals.eventCount, 22);
  assert.equal(t.shown, 4);
  assert.equal(t.available, 4);
  assert.equal(t.noData, false);
});

test('parseGa4Table recognises an empty report', () => {
  const t = parseGa4Table(['      [text] There is no data for this report']);
  assert.equal(t.noData, true);
  assert.equal(t.rows.length, 0);
});

test('mergeEventTables keeps one row per campaign with each event count', () => {
  const cta = parseGa4Table(ga4Text('Session campaign', [{ name: 'a', sessions: 10, engaged: 4, events: 3 }]));
  const starts = parseGa4Table(ga4Text('Session campaign', [{ name: 'a', sessions: 10, engaged: 4, events: 1 }], 'showing_form_start'));
  const rows = mergeEventTables({ cta, formStarts: starts, film: null });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].events, { cta: 3, formStarts: 1 });
  assert.equal(rows[0].sessions, 10);
});

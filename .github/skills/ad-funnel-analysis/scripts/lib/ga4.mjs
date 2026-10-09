// Parse GA4 explorer tables from the accessible text that EdgeSession.psm1 reads (one "[type] name" line per element).

const METRICS = [
  ['sessions', /^Sessions$/i],
  ['engaged', /^Engaged sessions$/i],
  ['engagementRate', /^Engagement rate$/i],
  ['engagedPerUser', /^Engaged sessions per active user$/i],
  ['avgEngagementSec', /^Average engagement time/i],
  ['eventsPerSession', /^Events per session$/i],
  ['eventCount', /^Event count/i],
  ['keyEvents', /^Key events/i],
  ['keyEventRate', /key event rate/i],
  ['activeUsers', /^Active users$/i],
  ['newUsers', /^New users$/i],
  ['revenue', /^Total revenue$/i],
];
const metricKey = (header) => METRICS.find(([, re]) => re.test(header))?.[0] ?? null;

// "1m 13s" -> 73, "22.3% Avg 0%" -> 0.223, "64 (46.04%)" -> 64, "$0.00 (–)" -> 0, "2.00 100% of total" -> 2.
export function parseCell(cell) {
  if (cell === undefined || cell === null) return null;
  const s = String(cell).trim();
  if (/^\d+[hms]\b/.test(s)) {
    const m = s.match(/^(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/);
    return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
  }
  const pct = s.match(/^(-?[\d,]*\.?\d+)%/);
  if (pct) return Number(pct[1].replace(/,/g, '')) / 100;
  const num = s.match(/^-?\$?(-?[\d,]*\.?\d+)/);
  return num ? Number(num[1].replace(/,/g, '')) : null;
}

const depth = (line) => line.match(/^ */)[0].length;
const body = (line) => line.trim();

function directChildren(lines, i) {
  const base = depth(lines[i]);
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    const d = depth(lines[j]);
    if (d <= base) break;
    if (d === base + 2) out.push(body(lines[j]));
  }
  return out;
}

export function parseGa4Table(input) {
  const lines = (Array.isArray(input) ? input : String(input).split(/\r?\n/)).filter((l) => l.trim());
  const text = lines.join('\n');
  const range = text.match(/\[text\] (\d+)-(\d+) of (\d+)/);
  const out = {
    noData: /There is no data for this report/i.test(text),
    shown: range ? Number(range[2]) - Number(range[1]) + 1 : null,
    available: range ? Number(range[3]) : null,
    dimension: null,
    columns: [],
    totals: null,
    rows: [],
  };
  let headers = null;
  for (let i = 0; i < lines.length; i++) {
    const m = body(lines[i]).match(/^\[row\] (.*)$/);
    if (!m) continue;
    const kids = directChildren(lines, i);
    if (/Checkbox for deselecting all rows/.test(m[1])) {
      headers = kids
        .filter((k) => k.startsWith('[column header] '))
        .map((k) => k.slice(16).trim())
        .filter((h) => !/^selection column/.test(h));
      const firstMetric = headers.findIndex((h) => metricKey(h));
      out.dimension = headers.slice(1, firstMetric).join(' / ') || null;
      out.columns = headers.slice(firstMetric).map((h) => ({ header: h, key: metricKey(h) }));
      continue;
    }
    if (!headers) continue;
    const k = out.columns.length;
    if (/^Checkbox for total row/.test(m[1])) {
      const cells = kids.filter((c) => c.startsWith('[column header] ')).map((c) => c.slice(16).trim());
      const at = cells.indexOf('Total');
      if (at >= 0) {
        out.totals = {};
        out.columns.forEach((c, n) => c.key && (out.totals[c.key] = parseCell(cells[at + 1 + n])));
      }
      continue;
    }
    const items = kids
      .filter((c) => c.startsWith('[item] '))
      .map((c) => c.slice(7).trim())
      .filter((c) => !/^Checkbox for selecting row/.test(c));
    if (items.length < k + 1 || !/^\d+$/.test(items[0])) continue;
    const values = items.slice(-k);
    const label = items
      .slice(1, items.length - k)
      .join(' ')
      .replace(/\s*Warning\. Get more information about this value\s*/g, '')
      .trim();
    const row = { dimension: label || '(empty)' };
    out.columns.forEach((c, n) => c.key && (row[c.key] = parseCell(values[n])));
    out.rows.push(row);
  }
  return out;
}

// Merge one campaign table per event (same sessions, different event counts) into rows keyed by campaign.
export function mergeEventTables(tables) {
  const byName = new Map();
  for (const [eventKey, t] of Object.entries(tables)) {
    if (!t) continue;
    for (const r of t.rows) {
      if (!byName.has(r.dimension)) {
        byName.set(r.dimension, {
          campaign: r.dimension,
          sessions: r.sessions ?? 0,
          engaged: r.engaged ?? 0,
          avgEngagementSec: r.avgEngagementSec ?? 0,
          keyEvents: r.keyEvents ?? 0,
          events: {},
        });
      }
      byName.get(r.dimension).events[eventKey] = r.eventCount ?? 0;
    }
  }
  return [...byName.values()];
}

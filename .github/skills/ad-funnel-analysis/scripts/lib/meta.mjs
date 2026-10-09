// Meta Ads Manager inputs: Ads Reporting CSV exports, the manage tables (ads / ad sets / campaigns) and A/B test pages.
import { toNumber } from '../../../_shared/csv.mjs';

const COLUMNS = [
  ['campaign', /^Campaign name$/i],
  ['adset', /^Ad set name$/i],
  ['ad', /^Ad name$/i],
  ['day', /^Day$/i],
  ['country', /^Country$/i],
  ['region', /^Region$/i],
  ['age', /^Age$/i],
  ['gender', /^Gender$/i],
  ['platform', /^Platform$/i],
  ['hour', /^Time of day/i],
  ['impressions', /^Impressions$/i],
  ['reach', /^Reach$/i],
  ['clicks', /link clicks/i],
  ['lpv', /landing page views/i],
  ['metaLeads', /\bleads\b/i],
  ['spend', /^Amount spent/i],
  ['reportingStarts', /^Reporting starts$/i],
  ['reportingEnds', /^Reporting ends$/i],
];
const NUMERIC = new Set(['impressions', 'reach', 'clicks', 'lpv', 'metaLeads', 'spend']);

export function normalizeMetaRows(rows) {
  if (!rows?.length) return [];
  const map = Object.keys(rows[0])
    .map((h) => [h, COLUMNS.find(([, re]) => re.test(h))?.[0]])
    .filter(([, k]) => k);
  return rows.map((r) => {
    const o = Object.fromEntries(map.map(([h, k]) => [k, NUMERIC.has(k) ? toNumber(r[h]) : r[h]]));
    if (typeof o.hour === 'string') o.hour = Number(o.hour.slice(0, 2));
    return o;
  });
}

export function parseUrlTags(tags) {
  const out = {};
  if (!tags) return out;
  for (const part of String(tags).replace(/^\?/, '').split('&')) {
    const [k, v = ''] = part.split('=');
    if (!k) continue;
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      out[k] = v;
    }
  }
  return out;
}

const DELIVERY = /^(Active|Learning limited|Learning|In review|Pending review|Rejected|Off|Paused|Not delivering|Completed|Scheduled|In draft|Draft|Ad set off|Campaign off|Inactive|Processing|Error|With issues)\b/i;
const DATE_TIME = /^[A-Z][a-z]{2} \d{1,2}, \d{4}(, \d{1,2}:\d{2} ?[AP]M)?$/;

// Rows of a manage table start at their on/off switch; the first text after it is the entity name.
export function parseManageTable(input) {
  const all = (Array.isArray(input) ? input : String(input).split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
  const lastHeader = all.findLastIndex((l) => l.startsWith('[column header] '));
  const lines = all.slice(lastHeader + 1);
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (/^\[switch\] /.test(line)) {
      cur = { name: null, cells: [] };
      out.push(cur);
      continue;
    }
    if (/^\[text\] Results from \d+/.test(line)) {
      cur = null;
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^\[(text|link)\] (.*)$/);
    if (!m || m[2] === 'Edit column' || !m[2].trim()) continue;
    if (!cur.name) cur.name = m[2];
    else if (cur.cells.at(-1) !== m[2]) cur.cells.push(m[2]);
  }
  return out
    .filter((r) => r.name)
    .map((r) => {
      const tags = r.cells.find((c) => /utm_[a-z]+=/i.test(c)) ?? null;
      return {
        name: r.name,
        delivery: r.cells.find((c) => DELIVERY.test(c)) ?? null,
        urlTags: tags,
        utm: parseUrlTags(tags),
        website: r.cells.find((c) => /^https?:\/\//i.test(c)) ?? null,
        budget: r.cells.find((c) => /^\$[\d,.]+/.test(c) || /^Using (ad set|campaign) budget/i.test(c)) ?? null,
        bidStrategy: r.cells.find((c) => /Highest volume|Highest value|Cost per result|Bid cap|Lowest cost|ROAS goal/i.test(c)) ?? null,
        goal: r.cells.find((c) => /^(Landing Page Views|Link Clicks|Leads|Conversions|Impressions|Reach|ThruPlay|Post Engagement|Daily Unique Reach|Conversations)$/i.test(c)) ?? null,
        objective: r.cells.find((c) => /^(Traffic|Leads|Sales|Engagement|Awareness|App promotion)$/i.test(c)) ?? null,
        dates: r.cells.filter((c) => DATE_TIME.test(c) || /\d{4} [–-] /.test(c)),
        cells: r.cells,
      };
    });
}

// A/B test page: status, key metric, objective, duration and each arm's key-metric value.
export function parseExperiment(input) {
  const lines = (Array.isArray(input) ? input : String(input).split(/\r?\n/))
    .map((l) => l.trim().replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter((l) => l && l !== '\u200b');
  const after = (label) => {
    const i = lines.findIndex((l) => l.replace(/:$/, '') === label);
    if (i < 0) return null;
    return lines.slice(i + 1).find((l) => l !== ':' && l.trim()) ?? null;
  };
  const arms = [];
  for (let i = 0; i < lines.length - 2; i++) {
    if (/^[A-E]$/.test(lines[i]) && /^\$?[\d,.]+%?$/.test(lines[i + 2] ?? '')) arms.push({ arm: lines[i], name: lines[i + 1], value: lines[i + 2] });
  }
  return {
    status: lines.find((l) => /^Test (in progress|completed|ended|scheduled)|^Your test/i.test(l)) ?? null,
    keyMetric: after('Key metric'),
    objective: after('Objective'),
    duration: after('Duration'),
    spent: after('Total amount spent'),
    winner: lines.find((l) => /winner|wins|won|likely to (win|perform)/i.test(l)) ?? null,
    confidence: lines.find((l) => /\d+%\s*(chance|confidence)/i.test(l)) ?? null,
    arms,
  };
}

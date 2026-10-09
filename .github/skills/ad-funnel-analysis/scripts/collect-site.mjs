// Website-side evidence from Cloudflare (read-only): Facebook / Instagram in-app visits (a lower bound on ad visits:
// the Free plan cannot see UTM parameters), how far each visit scrolled (lazy images that belong to one section),
// whether the tour form opened (Turnstile), the film played or a request was sent. The output is anonymised: no IP
// addresses or user agents are written.
//   node collect-site.mjs --since yyyy-MM-dd --until yyyy-MM-dd --out <run>/site.json [--leads <run>/leads.json]
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadSiteConfig, parseArgs, readJson, readJsonIfExists } from '../../_shared/config.mjs';
import { cloudflareGraphql, cloudflareToken } from '../../_shared/cloudflare.mjs';
import { addDays, zonedDate, zonedHour, zonedMidnightUtc } from '../../_shared/time.mjs';
import { classifyAgent, ipId } from './lib/site.mjs';

const args = parseArgs();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
if (!DATE.test(args.since ?? '') || !DATE.test(args.until ?? '') || !args.out) {
  console.error('usage: node collect-site.mjs --since yyyy-MM-dd --until yyyy-MM-dd --out <file> [--leads <file>]');
  process.exit(2);
}
const site = loadSiteConfig();
const funnel = readJson(join(dirname(fileURLToPath(import.meta.url)), '..', 'funnel.json'));
const tz = site.meta.timezone;
const HOST = site.site.host;
const token = cloudflareToken(site.cloudflare.accountId);
const errors = [];

let fromMs = zonedMidnightUtc(args.since, tz).getTime();
const toMs = Math.min(zonedMidnightUtc(addDays(args.until, 1), tz).getTime(), Date.now());

// The GraphQL API rations queries per user (about 300 per 5 minutes, less for large scans). Wait and retry when the
// budget runs out, but spend at most 2.5 minutes waiting per run; after that, failures are reported, not retried.
let waitBudgetMs = 150e3;
async function gql(query, variables) {
  for (;;) {
    try {
      return await cloudflareGraphql(token, query, variables);
    } catch (e) {
      if (!/budget|rate limit|too many/i.test(e.message) || waitBudgetMs <= 0) throw e;
      const wait = Math.min(30e3, waitBudgetMs);
      waitBudgetMs -= wait;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// One-day queries (split only when a day returns the 10,000-row maximum), within the plan's retention.
let stepMs = 24 * 3600e3;
try {
  const s = await gql('query($z:String!){viewer{zones(filter:{zoneTag:$z}){settings{httpRequestsAdaptiveGroups{enabled maxDuration notOlderThan}}}}}', { z: site.cloudflare.zoneId });
  const lim = s.viewer.zones[0]?.settings?.httpRequestsAdaptiveGroups;
  if (lim?.maxDuration) stepMs = Math.min(stepMs, lim.maxDuration * 1000);
  if (lim?.notOlderThan) {
    const oldest = Date.now() - lim.notOlderThan * 1000 + 10 * 60e3;
    if (fromMs < oldest) {
      errors.push(`Cloudflare keeps ${Math.round(lim.notOlderThan / 86400)} days of request data; visits before ${new Date(oldest).toISOString()} are not included.`);
      fromMs = oldest;
    }
  }
} catch (e) {
  errors.push(`could not read Cloudflare dataset limits: ${e.message}`);
}

// Only the requests the analysis uses: page loads, lazy images (scroll depth), the film and the form API.
const PATHS =
  'OR:[{clientRequestPath:"/"},{clientRequestPath_like:"/_astro/%.avif"},{clientRequestPath_like:"/_astro/%.webp"},{clientRequestPath_like:"/_astro/%.jpg"},' +
  '{clientRequestPath_like:"/_astro/%.png"},{clientRequestPath_like:"/media/film/%.m3u8"},{clientRequestPath_like:"/media/film/%.mp4"},{clientRequestPath_like:"/api/%"}]';
const FIELDS = 'datetime clientIP userAgent clientCountryName clientRequestHTTPMethodName clientRequestPath edgeResponseStatus verifiedBotCategory';
async function pull(from, to) {
  const d = await gql(
    `query($z:String!,$f:Time!,$t:Time!,$h:String!){viewer{zones(filter:{zoneTag:$z}){httpRequestsAdaptiveGroups(limit:10000,filter:{datetime_geq:$f,datetime_lt:$t,clientRequestHTTPHost:$h,requestSource:"eyeball",${PATHS}},orderBy:[datetime_ASC]){count avg{sampleInterval} dimensions{${FIELDS}}}}}}`,
    { z: site.cloudflare.zoneId, f: from, t: to, h: HOST },
  );
  const rows = d.viewer.zones[0]?.httpRequestsAdaptiveGroups ?? [];
  if (rows.length >= 10000 && Date.parse(to) - Date.parse(from) > 120e3) {
    const mid = new Date((Date.parse(from) + Date.parse(to)) / 2).toISOString();
    return [...(await pull(from, mid)), ...(await pull(mid, to))];
  }
  return rows;
}

const raw = [];
for (let t = fromMs; t < toMs; t += stepMs) {
  const f = new Date(t).toISOString();
  const e = new Date(Math.min(t + stepMs, toMs)).toISOString();
  try {
    raw.push(...(await pull(f, e)));
  } catch (err) {
    errors.push(`requests ${f}..${e}: ${err.message.slice(0, 200)}`);
  }
}
const ts = [];
async function pullTurnstile(from, to) {
  const d = await gql(
    'query($a:String!,$f:Time!,$t:Time!,$k:String!){viewer{accounts(filter:{accountTag:$a}){turnstileAdaptiveGroups(limit:10000,filter:{datetime_geq:$f,datetime_lt:$t,siteKey:$k}){count dimensions{datetime eventType ipv4 ipv6}}}}}',
    { a: site.cloudflare.accountId, f: from, t: to, k: site.cloudflare.turnstileSiteKey },
  );
  const rows = d.viewer.accounts[0]?.turnstileAdaptiveGroups ?? [];
  if (rows.length >= 10000 && Date.parse(to) - Date.parse(from) > 120e3) {
    const mid = new Date((Date.parse(from) + Date.parse(to)) / 2).toISOString();
    return [...(await pullTurnstile(from, mid)), ...(await pullTurnstile(mid, to))];
  }
  return rows;
}
for (let t = fromMs; t < toMs; t += stepMs) {
  const f = new Date(t).toISOString();
  const e = new Date(Math.min(t + stepMs, toMs)).toISOString();
  try {
    ts.push(...(await pullTurnstile(f, e)));
  } catch (err) {
    errors.push(`turnstile ${f}..${e}: ${err.message.slice(0, 200)}`);
  }
}

// Section markers: lazy images that appear in exactly one section of the live home page.
let order = [];
const marker = new Map();
try {
  const html = await (await fetch(`https://${HOST}/`, { headers: { 'User-Agent': 'ad-funnel-analysis (node)' } })).text();
  const wanted = new Set(funnel.site.sections);
  const marks = [...html.matchAll(/\sid="([a-z0-9-]+)"/g)].filter((m) => wanted.has(m[1])).map((m) => ({ sec: m[1], i: m.index }));
  order = [...new Set(['top', ...marks.map((m) => m.sec)])];
  const lazy = new Map();
  for (const m of html.matchAll(/<picture\b[\s\S]*?<\/picture>|<img\b[^>]*>/g)) {
    if (!/loading="lazy"/.test(m[0])) continue;
    const sec = marks.filter((x) => x.i <= m.index).at(-1)?.sec ?? 'top';
    for (const u of m[0].matchAll(/\/_astro\/[^"'\s,]+?\.(?:avif|webp|jpe?g|png)/g)) {
      if (!lazy.has(u[0])) lazy.set(u[0], new Set());
      lazy.get(u[0]).add(sec);
    }
  }
  for (const [path, secs] of lazy) if (secs.size === 1) marker.set(path, [...secs][0]);
} catch (err) {
  errors.push(`could not read section markers from the live page: ${err.message}`);
}

const rows = raw
  .map((g) => ({ t: Date.parse(g.dimensions.datetime), n: g.count, si: g.avg?.sampleInterval ?? 1, ...g.dimensions, kind: classifyAgent(g.dimensions.userAgent, g.dimensions.verifiedBotCategory) }))
  .sort((a, b) => a.t - b.t);

// Owner and QA traffic: any address that used a tool user agent, or that sent the stored test requests.
const devIds = new Set(rows.filter((r) => r.kind === 'dev').map((r) => ipId(r.clientIP)));
const leads = args.leads ? readJsonIfExists(args.leads, { rows: [] }) : { rows: [] };
const testTimes = (leads.rows ?? []).filter((l) => l.is_test).map((l) => Date.parse(l.created_at));
const ownerIds = new Set(
  rows
    .filter((r) => r.clientRequestHTTPMethodName === 'POST' && r.clientRequestPath.startsWith('/api/') && testTimes.some((t) => Math.abs(t - r.t) < 3 * 60e3))
    .map((r) => ipId(r.clientIP)),
);

const crawlers = { metaPreview: 0, verifiedBots: 0, otherBots: 0 };
for (const r of rows) {
  if (r.kind === 'meta-crawler') crawlers.metaPreview += r.n * r.si;
  else if (r.kind === 'verified-bot') crawlers.verifiedBots += r.n * r.si;
  else if (r.kind === 'bot') crawlers.otherBots += r.n * r.si;
}

const osOf = (ua = '') => (/iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : 'other');
// Visits are keyed by address + app + device type, not the exact user agent: Instagram's in-app browser sends the
// page request and its images with slightly different user agents.
const sessions = new Map();
for (const r of rows) {
  if (!['facebook', 'instagram', 'browser'].includes(r.kind)) continue;
  const key = `${ipId(r.clientIP)}|${r.kind}|${osOf(r.userAgent)}`;
  if (!sessions.has(key)) sessions.set(key, []);
  sessions.get(key).push(r);
}
const tsRows = ts.map((x) => ({ t: Date.parse(x.dimensions.datetime), id: ipId(x.dimensions.ipv4 || x.dimensions.ipv6), type: x.dimensions.eventType, n: x.count }));
const realLeadTimes = (leads.rows ?? []).filter((l) => !l.is_test).map((l) => ({ at: l.created_at, t: Date.parse(l.created_at) }));
const visits = [];
const leadVisits = [];
const excluded = { dev: 0, owner: 0 };
for (const [key, list] of sessions) {
  const id = key.split('|')[0];
  let cur = null;
  const groups = [];
  for (const r of list) {
    // A visit ends after 30 quiet minutes, except that a form submission within 3 hours still belongs to it
    // (filling in the form makes no requests).
    const isPost = r.clientRequestHTTPMethodName === 'POST' && r.clientRequestPath.startsWith('/api/');
    if (!cur || r.t - cur.end > (isPost ? 3 * 3600e3 : 30 * 60e3)) groups.push((cur = { start: r.t, end: r.t, rows: [] }));
    cur.end = r.t;
    cur.rows.push(r);
  }
  let lastVisit = null;
  for (const g of groups) {
    const doc = g.rows.find((r) => r.clientRequestHTTPMethodName === 'GET' && r.clientRequestPath === '/' && r.edgeResponseStatus < 400);
    const posts = g.rows.filter((r) => r.clientRequestHTTPMethodName === 'POST' && r.clientRequestPath.startsWith('/api/'));
    const first = doc ?? g.rows[0];
    const secs = new Set(g.rows.map((r) => marker.get(r.clientRequestPath)).filter(Boolean));
    let visit = {
      start: new Date(g.start).toISOString(),
      day: zonedDate(g.start, tz),
      hour: zonedHour(g.start, tz),
      source: first.kind,
      country: first.clientCountryName,
      os: osOf(first.userAgent),
      depth: order.filter((s) => secs.has(s)).at(-1) ?? 'top',
      formOpened: tsRows.some((x) => x.id === id && x.t >= g.start - 60e3 && x.t <= g.end + 30 * 60e3),
      film: g.rows.some((r) => r.clientRequestPath.startsWith('/media/film/')),
      requestSent: posts.length > 0,
      seconds: Math.round((g.end - g.start) / 1000),
      sampled: g.rows.some((r) => r.si > 1),
    };
    // A submission long after the page load (form left open) belongs to the visitor's last page load.
    if (!doc && posts.length && lastVisit) {
      lastVisit.requestSent = true;
      lastVisit.formOpened = true;
      visit = lastVisit;
    }
    // Which visit sent each real (non-test) tour request? Anonymised: source, country, device, depth only, plus how
    // long before the request the same device (same user agent, any address) was first seen in the window.
    for (const l of realLeadTimes) {
      const post = posts.find((r) => Math.abs(r.t - l.t) < 3 * 60e3);
      if (!post) continue;
      const firstSeen = Math.min(...rows.filter((r) => r.userAgent === post.userAgent && r.t <= post.t).map((r) => r.t));
      leadVisits.push({
        created_at: l.at,
        ...visit,
        firstSeenHoursBefore: Number.isFinite(firstSeen) ? Math.round(((post.t - firstSeen) / 3600e3) * 10) / 10 : null,
        excludedAs: devIds.has(id) ? 'dev' : ownerIds.has(id) ? 'owner' : null,
      });
    }
    if (!doc) continue;
    if (devIds.has(id)) { excluded.dev++; continue; }
    if (ownerIds.has(id)) { excluded.owner++; continue; }
    visits.push(visit);
    lastVisit = visit;
  }
}

const turnstile = {};
for (const x of tsRows) turnstile[x.type] = (turnstile[x.type] ?? 0) + x.n;

const out = {
  window: { since: args.since, until: args.until, timezone: tz, fromUtc: new Date(fromMs).toISOString(), toUtc: new Date(toMs).toISOString() },
  collectedAt: new Date().toISOString(),
  requestRows: rows.length,
  sampledRows: rows.filter((r) => r.si > 1).length,
  sections: order,
  markers: marker.size,
  markerSections: order.filter((sec) => [...marker.values()].includes(sec)),
  visits,
  leadVisits,
  excluded,
  crawlers,
  turnstile,
  errors,
};
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, JSON.stringify(out, null, 2));
const inApp = visits.filter((v) => v.source !== 'browser');
console.log(`site ${visits.length} human visits (${inApp.length} in Facebook/Instagram apps), ${rows.length} request groups, ${errors.length} warnings`);
for (const e of errors) console.log(`  warning: ${e}`);

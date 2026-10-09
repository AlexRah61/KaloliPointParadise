// Tour requests stored by the website (Cloudflare D1), read through Wrangler. Read-only and PII-free: the query selects
// attribution and status columns only, never name, phone, email, message or IP hash.
//   node collect-leads.mjs --since 2026-10-01 --until 2026-10-08 --out <run>/leads.json
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { cloudflareToken } from '../../_shared/cloudflare.mjs';
import { loadSiteConfig, parseArgs, runWrangler } from '../../_shared/config.mjs';
import { addDays, zonedMidnightUtc } from '../../_shared/time.mjs';

const args = parseArgs();
const site = loadSiteConfig();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
if (!DATE.test(args.since ?? '') || !DATE.test(args.until ?? '') || !args.out) {
  console.error('usage: node collect-leads.mjs --since yyyy-MM-dd --until yyyy-MM-dd --out <file>');
  process.exit(2);
}
const tz = site.meta.timezone;
const from = zonedMidnightUtc(args.since, tz).toISOString();
const to = zonedMidnightUtc(addDays(args.until, 1), tz).toISOString();
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
if (!ISO.test(from) || !ISO.test(to) || !/^[\w-]+$/.test(site.d1.database)) throw new Error('unsafe query input');

const sql =
  'SELECT id, created_at, is_test, status, tour_type, cta_origin, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ' +
  "CASE WHEN fbclid IS NULL OR fbclid = '' THEN 0 ELSE 1 END AS has_fbclid, referrer, landing_page " +
  `FROM showing_requests WHERE created_at >= '${from}' AND created_at < '${to}' ORDER BY created_at`;

// Refresh the OAuth login first if it has expired (D1 answers 7403 "not authorized" to a stale token).
cloudflareToken(site.cloudflare.accountId);
const stdout = runWrangler(['d1', 'execute', site.d1.database, '--remote', '--json', '--command', sql], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_ACCOUNT_ID: site.cloudflare.accountId },
});
const parsed = JSON.parse(stdout.slice(stdout.indexOf('[')));
// Referrer and landing page are reduced to a host name and a path: no query strings or click ids are written.
const host = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
};
const path = (p) => {
  try {
    return new URL(p, 'https://example.invalid').pathname;
  } catch {
    return null;
  }
};
const rows = parsed
  .flatMap((r) => r.results ?? [])
  .map(({ referrer, landing_page, ...r }) => ({ ...r, referrer_host: referrer ? host(referrer) : null, landing_path: landing_page ? path(landing_page) : null }));
const out = { window: { since: args.since, until: args.until, timezone: tz, fromUtc: from, toUtc: to }, collectedAt: new Date().toISOString(), rows };
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, JSON.stringify(out, null, 2));
const real = rows.filter((r) => !r.is_test).length;
console.log(`leads ${rows.length} rows (${real} real, ${rows.length - real} test) ${from} .. ${to}`);

// Turn a collected run folder into funnel.json: per-campaign funnel, findings, validation checks and deltas.
//   node analyze.mjs --run reports/ad-funnel-analysis/<run-id> [--campaigns <campaigns json>]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, readJson, readJsonIfExists } from '../../_shared/config.mjs';
import { parseCsv } from '../../_shared/csv.mjs';
import { offsetMs, zonedMidnightUtc } from '../../_shared/time.mjs';
import { deltas, diagnose, validate } from './lib/diagnose.mjs';
import { money } from './lib/format.mjs';
import { parseGa4Table } from './lib/ga4.mjs';
import { normalizeMetaRows, parseCampaignSettings, parseExperiment, parseManageTable } from './lib/meta.mjs';
import { buildModel } from './lib/model.mjs';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs();
if (!args.run || !existsSync(join(args.run, 'run.json'))) {
  console.error('usage: node analyze.mjs --run <run folder containing run.json>');
  process.exit(2);
}
const dir = args.run;
const runInfo = readJson(join(dir, 'run.json'));
const funnelCfg = readJson(join(SKILL_DIR, 'funnel.json'));
const campaignsCfg = args.campaigns
  ? readJson(args.campaigns)
  : readJsonIfExists(join(SKILL_DIR, 'campaigns.local.json')) ?? readJson(join(SKILL_DIR, 'campaigns.example.json'));
const text = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/^\uFEFF/, '') : null);
const csv = (name) => {
  const t = text(join(dir, 'meta', `${name}.csv`));
  return t === null ? null : normalizeMetaRows(parseCsv(t));
};
const lines = (p) => text(p)?.split(/\r?\n/) ?? null;

// --- Run clock in the ad account's time zone.
const generatedAt = runInfo.generatedAt ?? new Date().toISOString();
const now = Date.parse(generatedAt);
const tz = runInfo.metaTimezone;
const local = new Date(now + offsetMs(now, tz));
const run = {
  ...runInfo,
  generatedAt,
  metaToday: local.toISOString().slice(0, 10),
  metaNowHour: local.getUTCHours() + local.getUTCMinutes() / 60,
  windowStartUtc: zonedMidnightUtc(runInfo.since, tz).toISOString(),
};

// --- Inputs.
const metaCollect = readJsonIfExists(join(dir, 'meta', 'collect.json'));
const meta = existsSync(join(dir, 'meta'))
  ? {
      daily: csv('daily') ?? [],
      country: csv('country') ?? [],
      countryToday: csv('country-today'),
      countryDaily: csv('country-daily'),
      hourly: csv('hourly-today') ?? [],
      hourlyYesterday: csv('hourly-yesterday') ?? [],
      region: csv('region'),
      ageGender: csv('age-gender'),
      platform: csv('platform'),
      adsTable: lines(join(dir, 'meta', 'table-ads.txt')) && parseManageTable(lines(join(dir, 'meta', 'table-ads.txt'))),
      adsetsTable: lines(join(dir, 'meta', 'table-adsets.txt')) && parseManageTable(lines(join(dir, 'meta', 'table-adsets.txt'))),
      campaignsTable: lines(join(dir, 'meta', 'table-campaigns.txt')) && parseManageTable(lines(join(dir, 'meta', 'table-campaigns.txt'))),
      experiments: readdirSync(join(dir, 'meta'))
        .filter((f) => /^experiment-\d+\.txt$/.test(f))
        .map((f) => parseExperiment(lines(join(dir, 'meta', f)))),
    }
  : null;
const gaDir = join(dir, 'ga4');
const ga4Table = (name) => (lines(join(gaDir, name)) ? parseGa4Table(lines(join(gaDir, name))) : null);
const ga4 = existsSync(gaDir)
  ? {
      tables: Object.fromEntries(Object.keys(funnelCfg.ga4.events).map((k) => [k, ga4Table(`campaign-${k}.txt`)])),
      sourceMedium: ga4Table('source-medium.txt'),
      channel: ga4Table('channel.txt'),
      city: ga4Table('city.txt'),
      country: ga4Table('country.txt'),
    }
  : null;
const ga4Collect = readJsonIfExists(join(gaDir, 'collect.json'));
const leads = readJsonIfExists(join(dir, 'leads.json'));
const site = readJsonIfExists(join(dir, 'site.json'));

// --- Source status for validation.
const skipped = new Set(runInfo.skipped ?? []);
const status = (name, present, partial, detail) => ({ status: skipped.has(name) ? 'skipped' : !present ? 'missing' : partial ? 'partial' : 'ok', detail });
const metaFailed = (metaCollect?.items ?? []).filter((i) => !i.ok).map((i) => i.name);
const gaFailed = (ga4Collect?.items ?? []).filter((i) => !i.ok).map((i) => i.name);
const sources = {
  Meta: status('meta', !!meta?.daily.length, metaFailed.length > 0, metaFailed.length ? `not read: ${metaFailed.join(', ')}` : `${meta?.daily.length ?? 0} daily rows`),
  GA4: status('ga4', !!ga4 && Object.values(ga4.tables).some(Boolean), gaFailed.length > 0, gaFailed.length ? `not read: ${gaFailed.join(', ')}` : 'all tables read'),
  Website: status('site', !!site, (site?.errors ?? []).length > 0, site ? `${site.visits.length} human visits; ${(site.errors ?? []).length} warnings` : 'not collected'),
  Leads: status('leads', !!leads, false, leads ? `${leads.rows.length} stored requests` : 'not collected'),
};

const model = buildModel({ run, funnelCfg, campaignsCfg, meta, ga4, leads, site });

// Charts and settings from each campaign's Ads Manager insights page (collect-meta-insights.ps1).
const insightsDir = join(dir, 'meta', 'insights');
const insights = readJsonIfExists(join(insightsDir, 'insights.json'));
model.metaInsights = null;
if (insights) {
  model.metaInsights = { range: insights.range, collectedAt: insights.collectedAt, abTest: insights.abTest ?? null, campaigns: [] };
  for (const x of insights.campaigns ?? []) {
    const settings = x.settings ? parseCampaignSettings(lines(join(insightsDir, x.settings.edit)), lines(join(insightsDir, x.settings.review)), Number(run.until.slice(0, 4))) : null;
    model.metaInsights.campaigns.push({ name: x.name, charts: x.charts ?? [], settings, errors: x.errors ?? [] });
    const c = model.campaigns.find((y) => y.metaCampaign === x.name);
    if (c) c.campaignSettings = settings;
    for (const s of settings?.scheduledBudgets ?? []) {
      const what = `${c?.label ?? x.name}: scheduled daily budget ${money(s.dailyBudget)} for ${s.period} (Ads Manager budget scheduling)`;
      if (s.from && !model.changes.some((y) => y.what === what)) model.changes.push({ at: zonedMidnightUtc(s.from, tz).toISOString(), what, source: 'Ads Manager', campaigns: c ? [c.key] : [] });
    }
  }
  model.changes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

model.findings = diagnose(model, funnelCfg, campaignsCfg);
model.validation = validate(model, { sources, metaExports: (metaCollect?.items ?? []).filter((i) => i.requested) });
model.sources = sources;

// Previous run with the same window start (for "since last report" deltas).
const parent = dirname(dir);
const previous = readdirSync(parent, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name < basename(dir) && existsSync(join(parent, d.name, 'funnel.json')))
  .map((d) => d.name)
  .sort()
  .reverse()
  .map((n) => readJson(join(parent, n, 'funnel.json')))
  .find((m) => m.run?.since === run.since);
model.deltas = deltas(model, previous);

writeFileSync(join(dir, 'funnel.json'), JSON.stringify(model, null, 2));
const t = model.total.funnel;
console.log(`analyze: ${model.campaigns.length} campaigns | spend $${t.spend.toFixed(2)} | ${t.impressions} impressions | ${t.clicks} clicks | ${t.lpv} landing page views | ${Math.round(t.sessions)} GA4 ad sessions | ${t.leads} ad leads`);
console.log(`analyze: ${model.findings.length} findings | validation ${['pass', 'warn', 'fail'].map((s) => `${model.validation.filter((v) => v.status === s).length} ${s}`).join(', ')}`);

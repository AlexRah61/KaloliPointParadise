// A small synthetic two-campaign run (no real IDs or personal data), as files and as parsed model inputs.
import { parseCsv } from '../../_shared/csv.mjs';
import { parseGa4Table } from '../scripts/lib/ga4.mjs';
import { normalizeMetaRows, parseExperiment, parseManageTable } from '../scripts/lib/meta.mjs';
import { ADS_TABLE, COUNTRY_HEADER, DAILY_HEADER, EXPERIMENT, HOURLY_HEADER, ga4Text, metaCsv } from './fixtures.mjs';

export const run = {
  runId: '2026-01-02T1200',
  since: '2026-01-01',
  until: '2026-01-02',
  quick: false,
  generatedAt: '2026-01-02T20:00:00.000Z',
  metaTimezone: 'America/Los_Angeles',
  ga4Timezone: 'Pacific/Honolulu',
  skipped: [],
};

export const campaignsCfg = {
  priorityMarkets: ['US'],
  targeting: { countries: ['US', 'CA'], regions: { US: ['Hawaii', 'California'] } },
  campaigns: [
    { key: 'a', label: 'Video A', metaCampaign: 'Campaign A', utm: ['shared_tag'], dailyBudget: 10 },
    { key: 'b', label: 'Video B', metaCampaign: 'Campaign B', utm: ['/video_b/i'], dailyBudget: 10 },
  ],
  sharedUtm: [{ utm: 'shared_tag', until: '2026-01-02T10:00:00-08:00', campaigns: ['a', 'b'] }],
  ignoreUtm: ['qa_tag'],
  experiments: [],
  changes: [{ at: '2026-01-02T10:00:00-08:00', what: 'Video B retagged' }],
};

const R = (c, d) => [c, `Set ${c.slice(-1)}`, `Video ${c.slice(-1)} ad`, d];
const daily = metaCsv(DAILY_HEADER, [
  [...R('Campaign A', '2026-01-01'), 900, 1000, 20, 18, '', 5, '2026-01-01', '2026-01-02'],
  [...R('Campaign A', '2026-01-02'), 550, 600, 12, 10, '', 3, '2026-01-01', '2026-01-02'],
  [...R('Campaign B', '2026-01-01'), 900, 1000, 10, 8, '', 5, '2026-01-01', '2026-01-02'],
  [...R('Campaign B', '2026-01-02'), 450, 500, 6, 6, '', 2, '2026-01-01', '2026-01-02'],
]);
const country = metaCsv(COUNTRY_HEADER, [
  ['Campaign A', 'US', 700, 800, 16, 14, 4, '2026-01-01', '2026-01-02'],
  ['Campaign A', 'CA', 500, 600, 12, 10, 3, '2026-01-01', '2026-01-02'],
  ['Campaign A', 'JP', 150, 200, 4, 4, 1, '2026-01-01', '2026-01-02'],
  ['Campaign B', 'US', 1200, 1500, 16, 14, 7, '2026-01-01', '2026-01-02'],
]);
const countryToday = metaCsv(COUNTRY_HEADER, [
  ['Campaign A', 'US', 300, 400, 8, 6, 2, '2026-01-02', '2026-01-02'],
  ['Campaign A', 'JP', 150, 200, 4, 4, 1, '2026-01-02', '2026-01-02'],
  ['Campaign B', 'US', 450, 500, 6, 6, 2, '2026-01-02', '2026-01-02'],
]);
const hourly = metaCsv(HOURLY_HEADER, [
  ['Campaign B', '08:00:00 - 08:59:59', 200, 3, 3, 0.8, '2026-01-02', '2026-01-02'],
  ['Campaign B', '09:00:00 - 09:59:59', 100, 1, 1, 0.4, '2026-01-02', '2026-01-02'],
  ['Campaign B', '11:00:00 - 11:59:59', 200, 2, 2, 0.8, '2026-01-02', '2026-01-02'],
  ['Campaign A', '09:00:00 - 09:59:59', 600, 12, 10, 3, '2026-01-02', '2026-01-02'],
]);

const EVENTS = { cta: 'showing_cta_click', formStarts: 'showing_form_start', submitted: 'showing_request_submitted', gallery: 'gallery_open', film: 'property_film_start', agentContact: 'agent_contact_click' };
const ga4Rows = (k) => [
  { name: '(direct)', sessions: 20, engaged: 10, seconds: 60, events: k === 'cta' ? 3 : 0 },
  { name: 'shared_tag', sessions: 20, engaged: 6, seconds: 30, events: k === 'cta' ? 2 : k === 'formStarts' ? 1 : 0 },
  { name: '(cross-network)', sessions: 10, engaged: 0, seconds: 0, events: 0 },
  { name: 'video_b_tag', sessions: 5, engaged: 2, seconds: 40, events: k === 'cta' ? 1 : k === 'submitted' ? 1 : 0, keyEvents: 1 },
  { name: 'qa_tag', sessions: 3, engaged: 3, seconds: 90, events: 0 },
  { name: 'mystery', sessions: 2, engaged: 1, seconds: 10, events: 0 },
];

export const leads = {
  rows: [
    { created_at: '2026-01-01T18:00:00.000Z', is_test: 1, status: 'notified', tour_type: 'in_person', utm_campaign: 'qa_tag', has_fbclid: 0 },
    { created_at: '2026-01-02T19:00:00.000Z', is_test: 0, status: 'notified', tour_type: 'video', cta_origin: 'hero', utm_source: 'meta', utm_campaign: 'video_b_tag', has_fbclid: 1 },
    { created_at: '2026-01-02T19:30:00.000Z', is_test: 0, status: 'notified', tour_type: 'in_person', cta_origin: 'mobile_sticky', has_fbclid: 0, referrer_host: 'l.instagram.com' },
    { created_at: '2026-01-02T19:45:00.000Z', is_test: 0, status: 'notified', tour_type: 'in_person', cta_origin: 'hero', has_fbclid: 0 },
  ],
};

const visit = (start, depth, extra = {}) => ({
  start,
  day: '2026-01-02',
  hour: 9,
  source: 'facebook',
  country: 'US',
  os: 'iOS',
  depth,
  formOpened: false,
  film: false,
  requestSent: false,
  seconds: 30,
  sampled: false,
  ...extra,
});
export const site = {
  window: { since: run.since, until: run.until },
  sections: ['top', 'residence', 'gallery', 'film', 'showing'],
  markers: 10,
  visits: [visit('2026-01-02T17:00:00.000Z', 'top'), visit('2026-01-02T17:10:00.000Z', 'gallery', { formOpened: true, seconds: 120 }), visit('2026-01-02T17:20:00.000Z', 'film', { source: 'instagram', film: true })],
  leadVisits: [{ created_at: '2026-01-02T19:45:00.000Z', source: 'browser', country: 'US', os: 'Windows', depth: 'top', excludedAs: 'dev' }],
  excluded: { dev: 4, owner: 1 },
  crawlers: { metaPreview: 12, verifiedBots: 3, otherBots: 2 },
  turnstile: { challenge_issued: 5 },
  errors: [],
};

export const files = {
  'run.json': JSON.stringify(run),
  'meta/daily.csv': daily,
  'meta/country.csv': country,
  'meta/country-today.csv': countryToday,
  'meta/hourly-today.csv': hourly,
  'meta/table-ads.txt': ADS_TABLE.join('\n'),
  'meta/experiment-1.txt': EXPERIMENT.join('\n'),
  'meta/collect.json': JSON.stringify({
    items: [
      { name: 'daily', ok: true, rows: 4, requested: '2026-01-01_2026-01-03', reportingStarts: '2026-01-01', reportingEnds: '2026-01-02' },
      { name: 'country', ok: true, rows: 4, requested: '2026-01-01_2026-01-03', reportingStarts: '2026-01-01', reportingEnds: '2026-01-02' },
    ],
  }),
  ...Object.fromEntries(Object.entries(EVENTS).map(([k, ev]) => [`ga4/campaign-${k}.txt`, ga4Text('Session campaign', ga4Rows(k), ev).join('\n')])),
  'ga4/collect.json': JSON.stringify({ items: Object.keys(EVENTS).map((k) => ({ name: `campaign-${k}.txt`, ok: true })) }),
  'leads.json': JSON.stringify(leads),
  'site.json': JSON.stringify(site),
};

// The same inputs, parsed the way analyze.mjs parses them.
export function inputs(funnelCfg) {
  const metaRows = (name) => normalizeMetaRows(parseCsv(files[`meta/${name}.csv`]));
  return {
    run: { ...run, metaToday: '2026-01-02', metaNowHour: 12, windowStartUtc: '2026-01-01T08:00:00.000Z' },
    funnelCfg,
    campaignsCfg,
    meta: {
      daily: metaRows('daily'),
      country: metaRows('country'),
      countryToday: metaRows('country-today'),
      hourly: metaRows('hourly-today'),
      region: null,
      ageGender: null,
      platform: null,
      adsTable: parseManageTable(ADS_TABLE),
      adsetsTable: null,
      campaignsTable: null,
      experiments: [parseExperiment(EXPERIMENT)],
    },
    ga4: { tables: Object.fromEntries(Object.keys(EVENTS).map((k) => [k, parseGa4Table(files[`ga4/campaign-${k}.txt`].split('\n'))])) },
    leads,
    site,
  };
}

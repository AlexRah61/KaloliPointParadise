// Render funnel.json as report.md (for chat / email), report.html (self-contained, with inline charts) and
// report-public.html (the same without individual tour requests; the source of the PDF kept in the repository).
//   node report.mjs --run reports/ad-funnel-analysis/<run-id>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadSiteConfig, parseArgs, readJson } from '../../_shared/config.mjs';
import { addDays, datesBetween, zonedLabel } from '../../_shared/time.mjs';
import { citedSources, recommendations } from './lib/advice.mjs';
import { countryChart, dailyChart, funnelChart, hourlyChart, ratesChart, trendChart } from './lib/charts.mjs';
import { dayLabel, drivers, pText, priority, signedPct } from './lib/diagnose.mjs';
import { escapeHtml, escapeMd, int, money, num, pct, signed } from './lib/format.mjs';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs();
if (!args.run || !existsSync(join(args.run, 'funnel.json'))) {
  console.error('usage: node report.mjs --run <run folder containing funnel.json>');
  process.exit(2);
}
const m = readJson(join(args.run, 'funnel.json'));
const funnelCfg = readJson(join(SKILL_DIR, 'funnel.json'));
const bestPractices = readJson(join(SKILL_DIR, 'best-practices.json'));
let siteName = 'Website';
try {
  siteName = loadSiteConfig().site.name;
} catch {}

const C = m.campaigns;
const T = m.total;
const all = [...C, T];
const doc = [];
// opts.private: left out of the public report; opts.publicOnly: only in the public report; opts.newPage: printed on a new page.
const h = (level, text, opts = {}) => doc.push({ t: 'h', level, text, ...opts });
const p = (text, opts = {}) => doc.push({ t: 'p', text, ...opts });
const ul = (items) => items.length && doc.push({ t: 'ul', items });
const table = (head, rows, opts = {}) => rows.length && doc.push({ t: 'table', head, rows, ...opts });
const img = (path, alt, caption) => existsSync(join(args.run, path)) && doc.push({ t: 'img', path, alt, caption });
const charts = {};
const chart = (name, svg, alt) => {
  charts[name] = svg;
  doc.push({ t: 'chart', name, svg, alt });
};
const est = (c) => (c.ga4?.estimated ? ' (est.)' : '');
// End a fragment with exactly one full stop.
const sentence = (s) => `${String(s ?? '').trim().replace(/[.\s]+$/, '')}.`;
const firstSentence = (s) => sentence(String(s ?? '').split(/(?<=[.;])\s+(?=[A-Z])/)[0]);
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const hourLabel = (hr) => new Date(Date.UTC(2000, 0, 1, hr)).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'UTC' });
const completeDays = (c) => (c.daily ?? []).filter((d) => !d.partial && d.impressions > 0).length;
const changeText = (cmp) => {
  if (!cmp?.cost) return 'not comparable (no page views on one side)';
  const noise = cmp.significant ? 'beyond daily noise' : `within daily noise of ±${pct(cmp.cost.noise, 0)}`;
  return `**${cmp.direction}**, cost per page view ${money(cmp.cost.from)} → ${money(cmp.cost.to)} (${signedPct(cmp.cost.change)}, ${noise}); ${drivers(cmp)}`;
};
const notYet = (c) =>
  completeDays(c) === 0
    ? 'the ads started today: tomorrow compares today with yesterday up to the same hour, and full days are compared from the day after'
    : 'full days are compared from tomorrow; until then see today vs yesterday at the same hour';

// --- Header.
const when = zonedLabel(Date.parse(m.run.generatedAt), m.run.metaTimezone);
const longDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const title = `Daily ad report: ${C.map((c) => c.metaCampaign).join(' + ') || siteName}`;
h(1, title);
p(
  `**Report date ${longDay(m.run.until)}** (data ${longDay(m.run.since)} to ${longDay(m.run.until)}, ${m.run.metaTimezone}${m.run.until === m.run.metaToday ? `; today's figures run to ${hourLabel(Math.floor(m.run.metaNowHour))}` : ''}). ` +
    `Extracted ${when}${m.run.quick ? ' (quick run)' : ''} for ${siteName}. ` +
    `Sources: ${Object.entries(m.sources).map(([k, v]) => `${k} ${v.status}`).join(', ')}.`,
);

// --- Executive summary.
const recs = recommendations(m, bestPractices, priority);
h(2, 'Executive summary');
const tf = T.funnel;
const bottom = [];
const extra = [];
if (m.leads.metaUntagged) extra.push(`${int(m.leads.metaUntagged)} from Facebook/Instagram without ad tags`);
if (m.leads.internal) extra.push(`${int(m.leads.internal)} internal`);
const otherLeads = m.leads.real - tf.leads - (m.leads.metaUntagged ?? 0) - (m.leads.internal ?? 0);
if (otherLeads > 0) extra.push(`${int(otherLeads)} from other sources`);
bottom.push(
  `**Results: ${money(tf.spend)} spent** for ${int(tf.impressions)} impressions, ${int(tf.clicks)} link clicks (CTR ${pct(T.rates.ctr)}), ` +
    `${int(tf.lpv)} landing page views (${money(T.rates.costPerLpv)} each) and **${int(tf.leads)} tour request${tf.leads === 1 ? '' : 's'}** with ad tags` +
    `${extra.length ? `; other real requests in the window: ${extra.join(', ')}` : ''}.`,
);
for (const c of C) bottom.push(`**${c.label}: ${c.verdict.status}.** ${sentence(c.verdict.notes.join('; '))}`);
const cmpAB = m.comparison;
const ahead = [];
if (C.length >= 2 && cmpAB) {
  const A = C.find((c) => c.key === cmpAB.a);
  const B = C.find((c) => c.key === cmpAB.b);
  const wins = [['ctr', 'link CTR', 1], ['lpvPerClick', 'clicks that load the page', 0], ['engagementRate', 'engaged visits', 0], ['ctaRate', 'tour-button clicks per visit', 1]]
    .filter(([k]) => cmpAB[k]?.pValue < 0.05)
    .map(([k, name, d]) => {
      const t = cmpAB[k];
      const [w, l, hi, lo] = t.p1 > t.p2 ? [A, B, t.p1, t.p2] : [B, A, t.p2, t.p1];
      return `${w.label} beats ${l.label} on ${name} (${pct(hi, d)} vs ${pct(lo, d)}, p = ${pText(t)})`;
    });
  ahead.push(
    wins.length
      ? `${wins.join('; ')}; other differences are still within chance`
      : `no difference is beyond chance yet (link CTR ${A.label} ${pct(A.rates.ctr)} vs ${B.label} ${pct(B.rates.ctr)}, p = ${pText(cmpAB.ctr)}); keep both running`,
  );
  const ranked = [...C].filter((c) => c.funnel.engaged > 0).sort((a, b) => a.rates.costPerEngaged - b.rates.costPerEngaged);
  if (ranked.length >= 2) {
    const t = cmpAB.engagementRate;
    const caveat = [ranked.some((c) => c.ga4.estimated) ? 'GA4 split partly estimated' : null, t && t.pValue >= 0.05 ? `not significant yet, p = ${t.pValue.toFixed(2)}` : null].filter(Boolean);
    ahead.push(`best value so far: ${ranked[0].label} at ${money(ranked[0].rates.costPerEngaged)} per engaged visit vs ${money(ranked[1].rates.costPerEngaged)} for ${ranked[1].label}${caveat.length ? ` (${caveat.join('; ')})` : ''}`);
  }
}
for (const x of m.experiments) {
  ahead.push(`Meta's own A/B test (${[x.status, x.duration].filter(Boolean).join(', ')}) judges on ${String(x.keyMetric ?? 'its key metric').toLowerCase()}: ${x.arms.map((a) => `${a.arm} ${a.name} ${a.value}`).join(', ')}`);
}
if (ahead.length) bottom.push(`**Which ad is ahead:** ${sentence(ahead.map(cap).join('. '))}`);
const withDod = C.filter((c) => c.dayOverDay);
if (withDod.length) {
  const d = withDod[0].dayOverDay;
  bottom.push(
    `**Day over day (${dayLabel(d.latestDay)} vs ${dayLabel(d.previousDay)}):** ` +
      withDod.map((c) => `${c.label} ${c.dayOverDay.direction}${c.dayOverDay.significant ? '' : ' (within daily noise)'}, ${signedPct(c.dayOverDay.cost?.change ?? 0)} cost per page view`).join('; ') +
      '.',
  );
} else if (C.some((c) => c.sameTime)) {
  const hr = hourLabel(C.find((c) => c.sameTime).sameTime.untilHour);
  bottom.push(
    `**Today until ${hr} vs yesterday until ${hr}:** ` +
      C.filter((c) => c.sameTime).map((c) => `${c.label} ${c.sameTime.direction}${c.sameTime.significant ? '' : ' (within noise)'}, ${signedPct(c.sameTime.cost?.change ?? 0)} cost per page view`).join('; ') +
      '.',
  );
} else if (C.length) {
  bottom.push(`**Day over day:** ${completeDays(T)} complete day${completeDays(T) === 1 ? '' : 's'} of delivery so far; ${notYet(T)}.`);
}
const issue = recs.find((r) => r.severity === 'high' || r.impact === 'high');
if (issue) bottom.push(`**Biggest issue:** ${sentence(issue.titles.join('; '))}`);
if (recs.length) bottom.push(`**Do next:** ${recs.slice(0, 3).map((r, i) => `(${i + 1}) ${firstSentence(r.action)}`).join(' ')}`);
const vCount = (s) => m.validation.filter((v) => v.status === s).length;
bottom.push(`**Data checks:** ${vCount('pass')} pass, ${vCount('warn')} warn, ${vCount('fail')} fail. GA4 per-campaign numbers settle 24–48 hours after the visit.`);
if (C.length) {
  const strong = C.filter((c) => c.verdict.traffic === 'strong').map((c) => c.label);
  const weak = C.filter((c) => c.verdict.traffic === 'weak').map((c) => c.label);
  const traffic =
    strong.length === C.length
      ? `the ads bring cheap, real visits (${money(T.rates.costPerLpv)} per landing page view, CTR ${pct(T.rates.ctr)})`
      : weak.length === C.length
        ? `the ads are not bringing enough real visits (CTR ${pct(T.rates.ctr)}, ${pct(T.rates.lpvPerClick, 0)} of clicks load the page)`
        : `${strong.length ? `${strong.join(' and ')} bring${strong.length === 1 ? 's' : ''} visits efficiently` : 'traffic is typical'}${weak.length ? ` while ${weak.join(' and ')} ${weak.length === 1 ? 'does' : 'do'} not` : ''}`;
  const leadsLine =
    tf.leads > 0
      ? `${int(tf.leads)} tour request${tf.leads === 1 ? '' : 's'} at ${money(T.rates.costPerLead)} each`
      : C.some((c) => c.verdict.leads === 'not converting')
        ? 'no tour requests, and at this volume that is now a real signal'
        : 'no tour requests yet, which is still normal at this volume';
  bottom.unshift(`**In one line:** ${cap(traffic)}; ${leadsLine}; ${recs.length ? `first fix: ${lowerFirst(firstSentence(recs[0].action))}` : 'no change needed.'}`);
}
ul(bottom);

// --- Recommendations: each backed by this run's data and by published platform guidance.
h(2, 'Recommendations');
p('Ranked by expected value and ease. Each change shows the evidence in this report, the guidance it follows (linked) and what the next report should show if it worked.');
const detailed = recs.slice(0, 6);
detailed.forEach((r, i) => {
  h(3, `${i + 1}. ${r.titles.slice(0, 2).join('; ')}${r.titles.length > 2 ? ` (+${r.titles.length - 2} more)` : ''}`);
  ul([
    `**Do:** ${sentence(r.action)}`,
    `**Where:** ${r.area}${r.campaigns.length ? ` (${r.campaigns.join(', ')})` : ''}; effort ${r.effort}, impact ${r.impact}.`,
    `**Evidence:** ${sentence(r.evidence)} ${sentence(r.why)}`,
    `**Best practice:** ${sentence(r.basis.practice)} ${r.basis.sources.map((s) => `[${s.title}](${s.url})`).join('; ')}`,
    `**Expect:** ${sentence(r.basis.expect)} **Check next report:** ${sentence(r.basis.check)}`,
  ]);
});
if (recs.length > detailed.length) {
  h(3, 'More changes to consider');
  table(['#', 'Change', 'Where', 'Why', 'Effort', 'Impact'], recs.slice(detailed.length).map((r, i) => [String(detailed.length + i + 1), r.action, r.area + (r.campaigns.length ? ` (${r.campaigns.join(', ')})` : ''), r.titles.join('; '), r.effort, r.impact]));
}
if (!recs.length) p('No change is needed: nothing crosses the thresholds in funnel.json.');

// --- Conversion rates (the three headline conversions per campaign).
h(2, 'Conversion by campaign');
const ci = (iv) => (iv ? ` (${pct(iv.low)}–${pct(iv.high)})` : '');
table(
  ['Campaign', 'CTR (click / impression)', 'Ad to website (page view / click)', 'Impression to website', 'Page view to tour request', 'Cost per request'],
  all.map((c) => [
    c.label,
    `${pct(c.rates.ctr)}${ci(c.intervals?.ctr)}`,
    pct(c.rates.lpvPerClick, 0),
    pct(c.rates.lpvPerImpression),
    `${pct(c.rates.lpvToLead)}${ci(c.intervals?.lpvToLead)}`,
    money(c.rates.costPerLead),
  ]),
);
p('Ranges in brackets are 95% confidence intervals; with few page views the true request rate could be anywhere in that range.');

// --- Scorecard.
h(2, 'Scorecard');
const rows = [
  ['Status', (c) => c.verdict?.status ?? ''],
  ['Spend', (c) => money(c.funnel.spend)],
  ['Impressions', (c) => int(c.funnel.impressions)],
  ['Reach (approx.)', (c) => int(c.funnel.reach)],
  ['Frequency', (c) => num(c.rates.frequency, 2)],
  ['Link clicks', (c) => int(c.funnel.clicks)],
  ['CTR', (c) => pct(c.rates.ctr)],
  ['Cost per click', (c) => money(c.rates.cpc)],
  ['Landing page views', (c) => int(c.funnel.lpv)],
  ['Cost per landing page view', (c) => money(c.rates.costPerLpv)],
  ['GA4 sessions', (c) => `${int(c.funnel.sessions)}${est(c)}`],
  ['GA4 sessions incl. pending (est.)', (c) => int(c.funnel.sessionsEstimated)],
  ['Engaged sessions', (c) => int(c.funnel.engaged)],
  ['Engagement rate', (c) => pct(c.rates.engagementRate, 0)],
  ['Cost per engaged visit', (c) => money(c.rates.costPerEngaged)],
  ['Tour-button clicks', (c) => int(c.funnel.cta)],
  ['Form starts', (c) => int(c.funnel.formStarts)],
  ['Tour requests (database)', (c) => int(c.funnel.leads)],
  ['Pixel leads (Meta)', (c) => int(c.funnel.metaLeads)],
  ['Budget used', (c) => (c.pacing ? pct(c.pacing.ratio, 0) : '–')],
];
table(['Metric', ...all.map((c) => c.label)], rows.map(([name, f]) => [name, ...all.map(f)]));

// --- Charts.
const stages = funnelCfg.stages;
chart('funnel', funnelChart(C, stages), 'Funnel by campaign');
chart('rates', ratesChart(C, funnelCfg.benchmarks), 'Key rates by campaign');

// --- Day over day: is each ad getting better?
h(2, 'Day over day');
p(
  'Is each ad getting better? Complete days are compared with complete days in the ad account time zone, and today with yesterday up to the same hour. ' +
    'One campaign gets only tens of page views a day, so each change is tested; moves inside the daily noise band are labelled as such.',
);
const anyComparison = [...C, T].some((c) => c.dayOverDay || c.trend || c.sameTime);
if (!anyComparison) p(sentence(`${completeDays(T)} complete day${completeDays(T) === 1 ? '' : 's'} of delivery so far; ${notYet(T)}`));
ul(
  anyComparison
    ? [...C, T].map((c) => {
        const parts = [];
        if (c.dayOverDay) parts.push(`${dayLabel(c.dayOverDay.latestDay)} vs ${dayLabel(c.dayOverDay.previousDay)}: ${changeText(c.dayOverDay)}`);
        if (c.trend) parts.push(`Last ${c.trend.recentDays.length} days vs the ${c.trend.beforeDays.length} before: ${changeText(c.trend)}`);
        if (c.sameTime) parts.push(`Today until ${hourLabel(c.sameTime.untilHour)} vs yesterday until then: ${changeText(c.sameTime)}`);
        if (!parts.length) parts.push(`${completeDays(c)} complete day${completeDays(c) === 1 ? '' : 's'} of delivery so far; ${notYet(c)}`);
        return `**${c.label}**: ${sentence(parts.join('. '))}`;
      })
    : [],
);
const days = datesBetween(m.run.since, m.run.until).filter((d) => C.some((c) => c.meta.days.some((x) => x.key === d)));
if (days.length) {
  chart('trend', trendChart(C, days), 'CTR and cost per landing page view by day');
  chart('daily', dailyChart(C, days), 'Landing page views per day');
}
const prioLabel = (m.priorityMarkets ?? []).join('/') || 'Priority market';
const hasPrio = [...C, T].some((c) => (c.daily ?? []).some((d) => d.priorityShare !== null));
table(
  ['Campaign', 'Day', 'Spend', 'Impressions', 'Clicks', 'CTR', 'Page views', 'Cost / page view', 'CPM', 'Clicks → page', ...(hasPrio ? [`${prioLabel} share of spend`] : []), 'Requests'],
  [...C, T].flatMap((c) =>
    (c.daily ?? []).map((d) => [
      c.label,
      `${dayLabel(d.day)}${d.partial ? ' (today, so far)' : ''}`,
      money(d.spend),
      int(d.impressions),
      int(d.clicks),
      pct(d.ctr),
      int(d.lpv),
      money(d.costPerLpv),
      money(d.cpm),
      pct(d.lpvPerClick, 0),
      ...(hasPrio ? [pct(d.priorityShare, 0)] : []),
      int(d.leads),
    ]),
  ),
);
const same = [...C, T].filter((c) => c.sameTime);
if (same.length) {
  const hr = hourLabel(same[0].sameTime.untilHour);
  h(3, `Today until ${hr} vs yesterday until ${hr}`);
  const vs = (a, b, f) => `${f(a)} vs ${f(b)}`;
  table(
    ['Campaign', 'Spend', 'Impressions', 'Clicks', 'CTR', 'Page views', 'Cost / page view', 'Change in cost / page view'],
    same.map((c) => {
      const s = c.sameTime;
      return [
        c.label,
        vs(s.later.spend, s.earlier.spend, money),
        vs(s.later.impressions, s.earlier.impressions, int),
        vs(s.later.clicks, s.earlier.clicks, int),
        vs(s.laterRates.ctr, s.earlierRates.ctr, pct),
        vs(s.later.lpv, s.earlier.lpv, int),
        vs(s.laterRates.costPerLpv, s.earlierRates.costPerLpv, money),
        s.cost ? `${signedPct(s.cost.change)} (p = ${pText(s.cost)})` : '–',
      ];
    }),
  );
}
if (m.site?.daily?.length) {
  h(3, 'Website by day (Facebook and Instagram in-app visits, all campaigns together)');
  const shareOf = (a, b) => (b ? `${pct(a / b, 0)} (${int(a)})` : '–');
  table(
    ['Day', 'Visits', 'Scrolled past the first screen', 'Reached or opened the form', 'Played the film', 'Sent a request'],
    m.site.daily.map((d) => [`${dayLabel(d.day)}${d.partial ? ' (today, so far)' : ''}`, int(d.visits), shareOf(d.pastHero, d.visits), shareOf(d.formOpened, d.visits), int(d.film), int(d.requestSent)]),
  );
  if (m.site.daily.some((d) => d.requestSent > ((T.daily ?? []).find((x) => x.day === d.day)?.leads ?? 0))) {
    p('"Sent a request" counts every form sent from a Facebook or Instagram in-app visit; the Requests column above counts only stored requests that carry a campaign\'s ad tags, so it can be lower.');
  }
  const sd = m.site.dayOverDay;
  if (sd) p(`Scrolled past the first screen, ${dayLabel(sd.latestDay)} vs ${dayLabel(sd.previousDay)}: ${pct(sd.pastHero.p1, 0)} vs ${pct(sd.pastHero.p2, 0)} (p = ${pText(sd.pastHero)}).`);
  const ss = m.site.sameTime;
  if (ss) {
    p(
      `Today until ${hourLabel(ss.untilHour)} vs yesterday until then: ${int(ss.later.visits)} vs ${int(ss.earlier.visits)} in-app visits; ` +
        `${pct(ss.pastHero?.p1, 0)} vs ${pct(ss.pastHero?.p2, 0)} scrolled past the first screen (p = ${pText(ss.pastHero)}).`,
    );
  }
}
p('GA4 is not compared day by day: it assigns campaign names to sessions 24–48 hours late, so the most recent days would look worse than they are.');
if (C.some((c) => c.meta.hours.length)) {
  const yh = T.meta.hoursYesterday?.length ? Array.from({ length: 24 }, (_, hr) => T.meta.hoursYesterday.find((x) => x.key === hr)?.clicks ?? 0) : null;
  chart('hourly', hourlyChart(C, m.site?.hoursToday ?? null, Math.floor(m.run.metaNowHour), yh), 'Today by hour');
}

// --- What works / what does not.
h(2, 'What works');
const works = m.findings.filter((f) => f.positive).map((f) => `**${f.title}.** ${sentence(f.evidence)}`);
for (const c of C) {
  if (c.rates.ctr >= funnelCfg.benchmarks.linkCtr.good) works.push(`**${c.label}** gets a strong link CTR of ${pct(c.rates.ctr)} (benchmark ${pct(funnelCfg.benchmarks.linkCtr.good)}).`);
  if (c.rates.lpvPerClick >= (funnelCfg.benchmarks.lpvPerClick.good ?? 0.85)) works.push(`**${c.label}**: ${pct(c.rates.lpvPerClick, 0)} of clicks load the page, so the site loads fast in the in-app browser.`);
  if (c.funnel.leads > 0) works.push(`**${c.label}** produced ${int(c.funnel.leads)} tour request${c.funnel.leads === 1 ? '' : 's'}.`);
}
ul(works.length ? works : ['Nothing stands out as clearly working yet at this volume.']);

h(2, 'What does not work, and why');
const issues = m.findings.filter((f) => !f.positive && f.severity !== 'info');
ul(issues.map((f) => `**${f.title}.** ${sentence(f.evidence)} Why: ${sentence(f.why)}`));
if (!issues.length) p('No problems detected above the thresholds in funnel.json.');
const notes = m.findings.filter((f) => !f.positive && f.severity === 'info');
if (notes.length) {
  h(3, 'Context');
  ul(notes.map((f) => `**${f.title}.** ${sentence(f.evidence)} ${sentence(f.why)}`));
}

// --- Since last report.
if (m.deltas) {
  h(2, 'Since the last report');
  p(`Compared with the run at ${zonedLabel(Date.parse(m.deltas.since), m.run.metaTimezone)} (same window start).`);
  const keys = [['spend', 'Spend', (v) => signed(v, money)], ['impressions', 'Impressions'], ['clicks', 'Link clicks'], ['lpv', 'Landing page views'], ['sessions', 'GA4 sessions'], ['engaged', 'Engaged'], ['cta', 'Tour-button clicks'], ['leads', 'Tour requests']];
  table(['Change', ...C.map((c) => c.label), 'Total'], keys.map(([k, name, f]) => [name, ...C.map((c) => (f ?? signed)(m.deltas.campaigns[c.key]?.[k])), (f ?? signed)(m.deltas.total[k])]));
}

// --- Meta's own charts, captured from each campaign's insights page in Ads Manager.
const mi = m.metaInsights;
if (mi && (mi.abTest || mi.campaigns.some((x) => x.charts.length))) {
  const chartTitle = (t) => t.replace(/: Per (.+)$/, (_, x) => `: cost per ${x.toLowerCase()}`);
  const [from, toExcl] = (mi.range ?? '').split('_');
  h(2, 'Meta Ads Manager charts', { newPage: true });
  p(
    `Meta's own charts from each campaign's insights page in Ads Manager${from && toExcl ? `, data ${longDay(from)} to ${longDay(addDays(toExcl, -1))}` : ''}, ` +
      `captured ${zonedLabel(Date.parse(mi.collectedAt), m.run.metaTimezone)}. Meta counts results by its own attribution, so small differences from the tables above are expected.`,
  );
  if (mi.abTest) {
    h(3, 'A/B test');
    img(`meta/insights/${mi.abTest}`, 'Meta A/B test results card', 'A/B test results (Meta Experiments)');
  }
  mi.campaigns
    .filter((y) => y.charts.length)
    .forEach((x, i) => {
      const c = C.find((y) => y.metaCampaign === x.name);
      h(3, c && c.label !== x.name ? `${c.label} (${x.name})` : x.name, { newPage: i > 0 });
      for (const ch of x.charts) img(`meta/insights/${ch.file}`, `${x.name}: ${chartTitle(ch.title)}`, chartTitle(ch.title));
    });
}

// --- Audience.
h(2, 'Audience and placements');
if (C.some((c) => c.meta.countries.length)) chart('country', countryChart(C), 'Spend by country');
table(
  ['Campaign', 'Country', 'Spend', 'Share', 'Impressions', 'Clicks', 'CTR', 'Page views', 'Today: spend'],
  C.flatMap((c) => {
    const total = c.meta.countries.reduce((s, x) => s + x.spend, 0);
    return c.meta.countries.map((x) => [c.label, x.key, money(x.spend), pct(total ? x.spend / total : null, 0), int(x.impressions), int(x.clicks), pct(x.impressions ? x.clicks / x.impressions : null), int(x.lpv), money(c.meta.countriesToday?.find((y) => y.key === x.key)?.spend ?? 0)]);
  }),
);
if (C.some((c) => c.meta.regions?.length)) {
  h(3, 'Top regions');
  table(['Campaign', 'Region', 'Spend', 'Clicks'], C.flatMap((c) => (c.meta.regions ?? []).slice(0, 8).map((x) => [c.label, x.key.replace('|', ' / '), money(x.spend), int(x.clicks)])));
}
if (C.some((c) => c.meta.platforms?.length)) {
  h(3, 'Placements');
  table(['Campaign', 'Platform', 'Spend', 'Clicks', 'CTR', 'Page views'], C.flatMap((c) => (c.meta.platforms ?? []).map((x) => [c.label, x.key, money(x.spend), int(x.clicks), pct(x.impressions ? x.clicks / x.impressions : null), int(x.lpv)])));
}
if (C.some((c) => c.meta.ageGender?.length)) {
  h(3, 'Age and gender (top 6 by spend)');
  table(['Campaign', 'Age / gender', 'Spend', 'Clicks', 'CTR', 'Page views'], C.flatMap((c) => (c.meta.ageGender ?? []).slice(0, 6).map((x) => [c.label, x.key.replace('|', ' / '), money(x.spend), int(x.clicks), pct(x.impressions ? x.clicks / x.impressions : null), int(x.lpv)])));
}

// --- Website behaviour.
if (m.site) {
  h(2, 'What ad visitors did on the website');
  const s = m.site.inApp;
  const top = m.site.depth.find((d) => d.section === 'top')?.visits ?? 0;
  p(
    `Cloudflare saw ${int(s.visits)} visits from the Facebook and Instagram in-app browsers (bots, crawlers and owner/QA traffic removed; a lower bound on ad visits). ` +
      `${int(top)} never loaded an image below the first screen; ${int(s.engagedDepth)} reached the ${funnelCfg.site.engagedDepth} or further, ${int(s.formOpened)} reached or opened the tour form, ` +
      `${int(s.film)} played the film and ${int(s.requestSent)} sent a request. ${int(s.overOneMinute)} stayed active for more than a minute.`,
  );
  table(['Furthest section reached', 'Visits', 'Share'], m.site.depth.filter((d) => d.visits).map((d) => [d.section, int(d.visits), pct(s.visits ? d.visits / s.visits : null, 0)]));
  table(['Country', 'In-app visits'], Object.entries(s.byCountry).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, int(v)]));
  p(`Also seen: ${int(m.site.browser.visits)} visits from regular browsers, ${int(m.site.crawlers.metaPreview)} Meta crawler requests, ${int(m.site.excluded.dev + m.site.excluded.owner)} owner/QA visits excluded.`);
}

// --- Tracking and data quality.
h(2, 'Tracking and data quality');
table(
  ['GA4 session campaign', 'Sessions', 'Engaged', 'Treated as', 'Assigned to'],
  m.ga4.rows.map((r) => [r.campaign, int(r.sessions), int(r.engaged), r.kind, r.weights ? Object.entries(r.weights).map(([k, w]) => `${C.find((c) => c.key === k)?.label ?? k} ${pct(w, 0)}`).join(', ') : '–']),
);
if (m.ga4.channels?.length) {
  h(3, 'GA4 channels');
  table(['Channel', 'Sessions', 'Engagement rate'], m.ga4.channels.map((r) => [r.dimension, int(r.sessions), pct(r.engagementRate, 0)]));
}
p(`Tour requests stored in the window: ${int(m.leads.real)} real, ${int(m.leads.test)} test (test requests are excluded everywhere).`);
p('Individual requests are listed only in the local report (report.html), not in the shared PDF.', { publicOnly: true });
table(
  ['Received', 'Tour type', 'Button', 'Attributed to', 'Visit seen by the website'],
  m.leads.rows.map((r) => [
    zonedLabel(Date.parse(r.created_at), m.run.metaTimezone),
    r.source === 'meta_lead_form' ? 'Meta lead form' : r.tour_type === 'video' ? 'virtual (video)' : 'in person',
    r.cta_origin ?? '–',
    r.attribution ?? '–',
    r.visit
      ? `${r.visit.source === 'browser' ? 'browser' : `${r.visit.source} app`}, ${r.visit.country}, ${r.visit.os}` +
        (r.visit.firstSeenHoursBefore >= 1 ? `; same device first seen ${r.visit.firstSeenHoursBefore} h earlier` : '')
      : 'not matched',
  ]),
  { private: true },
);
h(3, 'Validation checks');
table(['Check', 'Result', 'Detail'], m.validation.map((v) => [v.title, v.status.toUpperCase(), v.detail]));

// --- Changes and experiments.
if (m.changes.length || m.experiments.length) {
  h(2, 'Changes and tests');
  ul(m.changes.map((c) => `${zonedLabel(Date.parse(c.at), m.run.metaTimezone)}: ${c.what}${Date.parse(c.at) > Date.parse(m.run.generatedAt) ? ' (scheduled)' : ''}`));
  ul(m.experiments.map((x) => `A/B test: ${x.status ?? 'status unknown'}; key metric ${x.keyMetric ?? '–'}; ${x.duration ?? ''}; ${x.arms.map((a) => `${a.arm} ${a.name} ${a.value}`).join(', ')}`));
}

h(2, 'Definitions');
ul([
  'CTR = link clicks / impressions. Ad to website = landing page views / link clicks (Meta pixel). Page view to tour request = stored tour requests attributed to the campaign / landing page views.',
  'Engaged session (GA4) = 10+ seconds, 2+ page views or a key event. GA4 sessions are matched to campaigns by utm_campaign; "(est.)" marks a split by landing page views where two ads shared one value.',
  'Tour requests come from the website database (test requests excluded), not from the pixel.',
  'Status has two parts. Traffic: strong (CTR at or above the good benchmark and at least 85% of clicks load the page), typical, weak (CTR below the poor benchmark or under 75% of clicks load) or too early (under 500 impressions). Leads: converting (has requests), not converting (zero requests is statistically unlikely) or too early.',
]);

const cited = citedSources(detailed);
if (cited.length) {
  h(2, 'Sources for the recommendations');
  p(`Platform and usability guidance behind the recommendations, consulted ${bestPractices.consulted}.`);
  ul(cited.map((s) => `${s.title}: [${s.url}](${s.url})`));
}

// --- Render.
const inline = (s) =>
  escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
const dataUri = (path) => `data:image/${path.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(join(args.run, path)).toString('base64')}`;
let md = '';
for (const b of doc.filter((x) => !x.publicOnly)) {
  if (b.t === 'h') md += `${'#'.repeat(b.level)} ${b.text}\n\n`;
  else if (b.t === 'p') md += `${b.text}\n\n`;
  else if (b.t === 'ul') md += `${b.items.map((i) => `- ${i}`).join('\n')}\n\n`;
  else if (b.t === 'table') md += `| ${b.head.map(escapeMd).join(' | ')} |\n| ${b.head.map(() => '---').join(' | ')} |\n${b.rows.map((r) => `| ${r.map(escapeMd).join(' | ')} |`).join('\n')}\n\n`;
  else if (b.t === 'chart') md += `![${b.alt}](charts/${b.name}.svg)\n\n`;
  else if (b.t === 'img') md += `![${b.alt}](${b.path})\n\n`;
}
const renderHtml = (shared) => {
  let html = '';
  for (const b of doc.filter((x) => (shared ? !x.private : !x.publicOnly))) {
    if (b.t === 'h') html += `<h${b.level}${b.newPage ? ' class="np"' : ''}>${inline(b.text)}</h${b.level}>\n`;
    else if (b.t === 'p') html += `<p>${inline(b.text)}</p>\n`;
    else if (b.t === 'ul') html += `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>\n`;
    else if (b.t === 'table') html += `<div class="t"><table><thead><tr>${b.head.map((x) => `<th>${inline(x)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((x) => `<td>${inline(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>\n`;
    else if (b.t === 'chart') html += `<figure>${b.svg}</figure>\n`;
    else if (b.t === 'img') html += `<figure class="shot"><img src="${dataUri(b.path)}" alt="${escapeHtml(b.alt)}"><figcaption>${inline(b.caption ?? b.alt)}</figcaption></figure>\n`;
  }
  return html;
};
const css = `body{font:15px/1.5 "Segoe UI",Helvetica,Arial,sans-serif;color:#1d1d1f;max-width:1000px;margin:24px auto;padding:0 16px}
h1{font-size:24px}h2{font-size:19px;margin-top:32px;border-bottom:1px solid #ddd;padding-bottom:4px}h3{font-size:16px;margin:18px 0 6px}
.t{overflow-x:auto}table{border-collapse:collapse;margin:8px 0 16px;font-size:13px}th,td{border:1px solid #ddd;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#f4f4f6}figure{margin:12px 0}svg{max-width:100%;height:auto}a{color:#0b57d0}
figure.shot img{display:block;max-width:100%;height:auto;border:1px solid #e3e3e8;border-radius:6px}figcaption{font-size:12px;color:#555;margin-top:4px}
@page{size:letter;margin:0.5in 0.5in 0.6in;@bottom-right{content:counter(page) " / " counter(pages);font:9px "Segoe UI",Arial,sans-serif;color:#777}}
@media print{body{max-width:none;margin:0;padding:0;font-size:11px;line-height:1.4}h1{font-size:19px;margin-top:0}h2{font-size:15px;margin-top:20px;break-after:avoid}
h3{font-size:12.5px;break-after:avoid}table{font-size:9px}th,td{padding:2px 4px}.t{overflow:visible}tr,li,figure{break-inside:avoid}
figure.shot img{max-height:8.5in;width:auto;max-width:100%}a{color:#0b57d0;text-decoration:none}.np{break-before:page}}`;
const page = (shared) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(`${title} (${m.run.until})`)}</title><style>${css}</style></head><body>\n${renderHtml(shared)}</body></html>\n`;

mkdirSync(join(args.run, 'charts'), { recursive: true });
for (const [name, svg] of Object.entries(charts)) writeFileSync(join(args.run, 'charts', `${name}.svg`), svg);
writeFileSync(join(args.run, 'report.md'), md);
writeFileSync(join(args.run, 'report.html'), page(false));
writeFileSync(join(args.run, 'report-public.html'), page(true));
console.log(`report: ${join(args.run, 'report.md')}, report.html and report-public.html (${Object.keys(charts).length} charts, ${doc.filter((b) => b.t === 'img').length} Meta charts, ${recs.length} recommendations)`);

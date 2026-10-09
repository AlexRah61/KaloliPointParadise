// Build the per-campaign funnel model from collected inputs. Pure (no I/O) so it can be unit-tested with fixtures.
import { addDays, offsetMs } from '../../../_shared/time.mjs';
import { dayOverDay, dayRates, recentTrend, sameTimeYesterday, siteDaily, siteDayOverDay, siteSameTime } from './daily.mjs';
import { summarizeVisits } from './site.mjs';
import { mergeEventTables } from './ga4.mjs';
import { chanceOfZero, ratio, triesForEvidence, twoProportion, wilson } from './stats.mjs';

const sum = (list, key) => (list ?? []).reduce((s, r) => s + (Number(r?.[key]) || 0), 0);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campaign';
const uniq = (list) => [...new Set(list.filter(Boolean))];

export function utmMatcher(pattern) {
  const re = /^\/(.+)\/([a-z]*)$/.exec(String(pattern));
  if (re) {
    const rx = new RegExp(re[1], re[2]);
    return (v) => rx.test(String(v ?? ''));
  }
  const p = String(pattern).toLowerCase();
  return (v) => String(v ?? '').toLowerCase() === p;
}

function localTime(instant, tz) {
  const local = new Date(instant + offsetMs(instant, tz));
  return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours() + local.getUTCMinutes() / 60 };
}

function rollup(rows, key, metrics = ['impressions', 'reach', 'clicks', 'lpv', 'spend']) {
  const m = new Map();
  for (const r of rows ?? []) {
    const k = typeof key === 'function' ? key(r) : r[key];
    if (!m.has(k)) m.set(k, Object.fromEntries([['key', k], ...metrics.map((x) => [x, 0])]));
    const o = m.get(k);
    for (const x of metrics) o[x] += Number(r[x]) || 0;
  }
  return [...m.values()];
}

// Turn a UTM value template into the GA4 values it produces for this campaign's ad sets and ads.
function dynamicValues(template, campaignName, adsets, ads) {
  if (!template.includes('{{')) return [template];
  let values = [template];
  const expand = (token, names) => {
    if (!values.some((v) => v.includes(token))) return;
    values = values.flatMap((v) => (v.includes(token) ? names.map((n) => v.split(token).join(n)) : [v]));
  };
  expand('{{campaign.name}}', [campaignName]);
  expand('{{adset.name}}', adsets);
  expand('{{ad.name}}', ads);
  return values.filter((v) => !v.includes('{{'));
}

export function rates(m) {
  return {
    ctr: ratio(m.clicks, m.impressions),
    cpc: ratio(m.spend, m.clicks),
    cpm: m.impressions ? (m.spend / m.impressions) * 1000 : null,
    frequency: ratio(m.impressions, m.reach),
    lpvPerClick: ratio(m.lpv, m.clicks),
    lpvPerImpression: ratio(m.lpv, m.impressions),
    costPerLpv: ratio(m.spend, m.lpv),
    sessionCapture: ratio(m.sessionsEstimated ?? m.sessions, m.lpv),
    engagementRate: ratio(m.engaged, m.sessions),
    ctaRate: ratio(m.cta, m.sessions),
    formStartRate: ratio(m.formStarts, m.sessions),
    formCompletion: ratio(m.submitted, m.formStarts),
    lpvToLead: ratio(m.leads, m.lpv),
    sessionToLead: ratio(m.leads, m.sessions),
    clickToLead: ratio(m.leads, m.clicks),
    costPerLead: m.leads > 0 ? m.spend / m.leads : null,
    costPerEngaged: ratio(m.spend, m.engaged),
  };
}

export function buildModel({ run, funnelCfg, campaignsCfg, meta, ga4, leads, site }) {
  const tz = run.metaTimezone;
  const windowStart = Date.parse(run.windowStartUtc);
  const ev = funnelCfg.ga4.events;

  // --- Campaign entities (configured first, then any Meta campaign the config does not know yet).
  const daily = meta?.daily ?? [];
  const entities = (campaignsCfg.campaigns ?? []).map((c) => ({
    key: c.key,
    label: c.label ?? c.metaCampaign,
    metaCampaign: c.metaCampaign,
    patterns: [...(c.utm ?? [])],
    dailyBudget: c.dailyBudget ?? null,
    configured: true,
  }));
  for (const name of uniq(daily.map((r) => r.campaign))) {
    if (!entities.some((e) => e.metaCampaign === name)) {
      entities.push({ key: slug(name), label: name, metaCampaign: name, patterns: [], dailyBudget: null, configured: false });
    }
  }

  // --- Meta delivery per campaign.
  for (const e of entities) {
    const rows = daily.filter((r) => r.campaign === e.metaCampaign);
    const byCountry = (meta?.country ?? []).filter((r) => r.campaign === e.metaCampaign);
    e.adsets = uniq(rows.map((r) => r.adset));
    e.adNames = uniq(rows.map((r) => r.ad));
    e.meta = {
      impressions: sum(rows, 'impressions'),
      clicks: sum(rows, 'clicks'),
      lpv: sum(rows, 'lpv'),
      spend: sum(rows, 'spend'),
      metaLeads: sum(rows, 'metaLeads'),
      reach: byCountry.length ? sum(byCountry, 'reach') : null,
      days: rollup(rows, 'day').sort((a, b) => a.key.localeCompare(b.key)),
      countries: rollup(byCountry, 'country').sort((a, b) => b.spend - a.spend),
      countriesToday: rollup((meta?.countryToday ?? []).filter((r) => r.campaign === e.metaCampaign), 'country').sort((a, b) => b.spend - a.spend),
      hours: rollup((meta?.hourly ?? []).filter((r) => r.campaign === e.metaCampaign), 'hour').sort((a, b) => a.key - b.key),
      regions: meta?.region ? rollup(meta.region.filter((r) => r.campaign === e.metaCampaign), (r) => `${r.country}|${r.region}`).sort((a, b) => b.spend - a.spend) : null,
      ageGender: meta?.ageGender ? rollup(meta.ageGender.filter((r) => r.campaign === e.metaCampaign), (r) => `${r.age}|${r.gender}`).sort((a, b) => b.spend - a.spend) : null,
      platforms: meta?.platform ? rollup(meta.platform.filter((r) => r.campaign === e.metaCampaign), 'platform').sort((a, b) => b.spend - a.spend) : null,
    };
    // Settings read from the Ads Manager tables.
    const ads = (meta?.adsTable ?? []).filter((a) => e.adNames.includes(a.name));
    const adsets = (meta?.adsetsTable ?? []).filter((a) => e.adsets.includes(a.name));
    const campaign = (meta?.campaignsTable ?? []).find((c) => c.name === e.metaCampaign) ?? null;
    e.settings = {
      campaign: campaign && { delivery: campaign.delivery, objective: campaign.objective, budget: campaign.budget, dates: campaign.dates, cells: campaign.cells },
      adsets: adsets.map((a) => ({ name: a.name, delivery: a.delivery, budget: a.budget, bidStrategy: a.bidStrategy, goal: a.goal, dates: a.dates, cells: a.cells })),
      ads: ads.map((a) => ({ name: a.name, delivery: a.delivery, urlTags: a.urlTags, utm: a.utm, website: a.website })),
    };
    e.learning = adsets.some((a) => /learning/i.test(a.delivery ?? ''));
    // UTM values each ad currently sends, so GA4 rows map without manual config.
    e.liveUtm = uniq(ads.flatMap((a) => (a.utm?.utm_campaign ? dynamicValues(a.utm.utm_campaign, e.metaCampaign, e.adsets, e.adNames) : [])));
    e.matchers = [...e.patterns, ...e.liveUtm].map(utmMatcher);
  }

  // LPV a campaign delivered between windowStart and `untilMs` (partial days prorated by hour when no hourly data).
  const lpvBefore = (e, untilMs) => {
    if (!Number.isFinite(untilMs)) return e.meta.lpv;
    const cut = localTime(untilMs, tz);
    let total = 0;
    for (const d of e.meta.days) {
      if (d.key < cut.date) total += d.lpv;
      else if (d.key === cut.date) {
        const hourly = d.key === run.metaToday && e.meta.hours.length ? e.meta.hours : null;
        total += hourly ? hourly.filter((h) => h.key < cut.hour).reduce((s, h) => s + h.lpv, 0) : d.lpv * Math.min(1, cut.hour / 24);
      }
    }
    return total;
  };

  // --- GA4 rows -> campaigns.
  const tables = ga4?.tables ?? {};
  const merged = mergeEventTables(tables);
  const ignore = (campaignsCfg.ignoreUtm ?? []).map(utmMatcher);
  const shared = (campaignsCfg.sharedUtm ?? []).map((s) => ({ ...s, match: utmMatcher(s.utm), untilMs: Date.parse(s.until) }));
  // Does the campaign's ad still send this UTM value? (Live ad settings win; config patterns when they were not read.)
  const carries = (e, name) =>
    e.liveUtm.length ? e.liveUtm.some((u) => u.toLowerCase() === name.toLowerCase()) : e.patterns.some((p) => utmMatcher(p)(name));
  const ga4Rows = [];
  for (const row of merged) {
    const name = row.campaign;
    let kind;
    let weights = null;
    if (name === funnelCfg.ga4.pendingCampaign) kind = 'pending';
    else if ((funnelCfg.ga4.nonAdCampaigns ?? []).includes(name)) kind = 'non-ad';
    else if (ignore.some((m) => m(name))) kind = 'ignored';
    else {
      const direct = entities.filter((e) => e.matchers.some((m) => m(name)));
      const cand = new Map(direct.map((e) => [e.key, { e, until: Infinity }]));
      for (const s of shared.filter((x) => x.match(name) && x.untilMs > windowStart)) {
        for (const k of s.campaigns) {
          const e = entities.find((x) => x.key === k);
          if (e) cand.set(k, { e, until: carries(e, name) ? Infinity : s.untilMs });
        }
      }
      if (!cand.size) kind = 'unmapped';
      else if (cand.size === 1) {
        kind = 'mapped';
        weights = { [[...cand.keys()][0]]: 1 };
      } else {
        kind = 'shared';
        const w = [...cand.values()].map(({ e, until }) => [e.key, lpvBefore(e, until)]);
        const total = w.reduce((s, [, v]) => s + v, 0);
        weights = Object.fromEntries(w.map(([k, v]) => [k, total > 0 ? v / total : 1 / w.length]));
      }
    }
    ga4Rows.push({ ...row, kind, weights });
  }

  const ga4Block = () => ({ sessions: 0, engaged: 0, engagementSeconds: 0, keyEvents: 0, events: Object.fromEntries(Object.keys(ev).map((k) => [k, 0])), rows: [], estimated: false });
  for (const e of entities) e.ga4 = ga4Block();
  const add = (block, row, w) => {
    block.sessions += row.sessions * w;
    block.engaged += row.engaged * w;
    block.engagementSeconds += row.avgEngagementSec * row.sessions * w;
    block.keyEvents += row.keyEvents * w;
    for (const k of Object.keys(block.events)) block.events[k] = row.events[k] === undefined || block.events[k] === null ? null : block.events[k] + row.events[k] * w;
  };
  const buckets = { pending: ga4Block(), 'non-ad': ga4Block(), ignored: ga4Block(), unmapped: ga4Block() };
  for (const row of ga4Rows) {
    if (row.weights) {
      for (const [k, w] of Object.entries(row.weights)) {
        const e = entities.find((x) => x.key === k);
        add(e.ga4, row, w);
        e.ga4.rows.push({ campaign: row.campaign, share: w, sessions: row.sessions * w });
        if (row.kind === 'shared') e.ga4.estimated = true;
      }
    } else {
      add(buckets[row.kind], row, 1);
      buckets[row.kind].rows.push({ campaign: row.campaign, share: 1, sessions: row.sessions });
    }
  }
  for (const b of [...entities.map((e) => e.ga4), ...Object.values(buckets)]) {
    for (const k of Object.keys(b.events)) if (!tables[k]) b.events[k] = null;
    b.avgEngagementSec = b.sessions ? b.engagementSeconds / b.sessions : null;
  }

  // --- Leads from the website's own database (the source of truth for tour requests).
  const leadRows = leads?.rows ?? [];
  const leadInfo = { real: 0, test: 0, unattributed: 0, fromMetaUnknownCampaign: 0, metaUntagged: 0, internal: 0, rows: [] };
  const SOCIAL = /(^|\.)(instagram|facebook|fb|threads)\.(com|me|net)$/i;
  for (const e of entities) e.leads = { count: 0, byTourType: {} };
  for (const l of leadRows) {
    if (l.is_test) {
      leadInfo.test++;
      continue;
    }
    leadInfo.real++;
    const at = Date.parse(l.created_at);
    const name = l.utm_campaign ?? '';
    const visit = (site?.leadVisits ?? []).find((v) => v.created_at === l.created_at) ?? null;
    let owners = name ? entities.filter((e) => e.matchers.some((m) => m(name))) : [];
    const s = shared.find((x) => name && x.match(name) && at < x.untilMs);
    if (s) owners = entities.filter((e) => s.campaigns.includes(e.key));
    const row = {
      created_at: l.created_at,
      tour_type: l.tour_type,
      cta_origin: l.cta_origin,
      utm_campaign: name || null,
      referrer_host: l.referrer_host ?? null,
      visit: visit && { source: visit.source, country: visit.country, os: visit.os, depth: visit.depth, firstSeenHoursBefore: visit.firstSeenHoursBefore ?? null, internal: !!visit.excludedAs },
      campaign: null,
      attribution: null,
    };
    if (visit?.excludedAs) {
      // Sent from an address that also ran QA tools or test submissions: almost certainly internal.
      leadInfo.internal++;
      row.attribution = 'internal (owner or QA address)';
    } else if (owners.length === 1) {
      owners[0].leads.count++;
      owners[0].leads.byTourType[l.tour_type] = (owners[0].leads.byTourType[l.tour_type] ?? 0) + 1;
      row.campaign = owners[0].key;
      row.attribution = owners[0].label;
    } else if (owners.length > 1) {
      row.campaign = 'shared';
      row.attribution = `ad, shared tag (${owners.map((o) => o.label).join(' or ')})`;
      leadInfo.unattributed++;
    } else if (l.has_fbclid || /^(meta|facebook|fb|ig|instagram)$/i.test(l.utm_source ?? '')) {
      leadInfo.fromMetaUnknownCampaign++;
      row.campaign = 'meta-unknown';
      row.attribution = 'Meta ad, campaign unknown';
    } else if (SOCIAL.test(l.referrer_host ?? '') || visit?.source === 'facebook' || visit?.source === 'instagram') {
      leadInfo.metaUntagged++;
      row.attribution = 'Facebook/Instagram without ad tags (organic post, profile link or untagged ad)';
    } else {
      leadInfo.unattributed++;
      row.attribution = l.referrer_host ? `referral from ${l.referrer_host}` : 'direct or unknown';
    }
    leadInfo.rows.push(row);
  }

  // --- Pending GA4 attribution ("(cross-network)" until GA4 finishes processing) allocated by LPV share.
  const totalLpv = entities.reduce((s, e) => s + e.meta.lpv, 0);
  for (const e of entities) {
    const share = totalLpv ? e.meta.lpv / totalLpv : 0;
    e.ga4.pendingAllocated = buckets.pending.sessions * share;
  }

  // --- Funnel metrics and rates.
  const funnelOf = (m, g, leadsCount, pendingAllocated) => ({
    impressions: m.impressions,
    reach: m.reach,
    clicks: m.clicks,
    lpv: m.lpv,
    spend: m.spend,
    metaLeads: m.metaLeads,
    sessions: g.sessions,
    sessionsEstimated: g.sessions + (pendingAllocated ?? 0),
    engaged: g.engaged,
    cta: g.events.cta,
    formStarts: g.events.formStarts,
    submitted: g.events.submitted,
    gallery: g.events.gallery,
    film: g.events.film,
    agentContact: g.events.agentContact,
    leads: leadsCount,
  });
  for (const e of entities) {
    e.funnel = funnelOf(e.meta, e.ga4, e.leads.count, e.ga4.pendingAllocated);
    e.rates = rates(e.funnel);
    e.intervals = {
      ctr: wilson(e.funnel.clicks, e.funnel.impressions),
      lpvPerClick: wilson(Math.min(e.funnel.lpv, e.funnel.clicks), e.funnel.clicks),
      lpvToLead: wilson(e.funnel.leads, e.funnel.lpv),
    };
    const p = funnelCfg.benchmarks.leadPerLpv;
    e.zeroLeadCheck = e.funnel.leads === 0 && e.funnel.lpv > 0 ? { assumedRate: p, chanceOfZero: chanceOfZero(e.funnel.lpv, p), lpvNeeded: triesForEvidence(p) } : null;
    const days = e.meta.days.filter((d) => d.key !== run.metaToday).length + (e.meta.days.some((d) => d.key === run.metaToday) ? (run.metaNowHour ?? 24) / 24 : 0);
    e.pacing = e.dailyBudget && days > 0 ? { budget: e.dailyBudget * days, spend: e.meta.spend, ratio: e.meta.spend / (e.dailyBudget * days), days } : null;
  }

  // --- Day over day: per-day rows, latest complete day vs the one before, recent days vs earlier days, and today
  // vs yesterday until the same hour.
  const minChange = funnelCfg.benchmarks.dayOverDayMinChange ?? 0.1;
  const prio = campaignsCfg.priorityMarkets ?? [];
  const leadDay = (r) => new Date(Date.parse(r.created_at) + offsetMs(Date.parse(r.created_at), tz)).toISOString().slice(0, 10);
  const dailyRows = (days, countryRows, leadRows) =>
    days.map((d) => {
      const cd = countryRows.filter((r) => r.day === d.key);
      const cdSpend = sum(cd, 'spend');
      return {
        day: d.key,
        partial: d.key === run.metaToday,
        impressions: d.impressions,
        reach: d.reach,
        clicks: d.clicks,
        lpv: d.lpv,
        spend: d.spend,
        leads: leadRows.filter((r) => leadDay(r) === d.key).length,
        priorityShare: cd.length && cdSpend > 0 ? sum(cd.filter((r) => prio.includes(r.country)), 'spend') / cdSpend : null,
        ...dayRates(d),
      };
    });
  for (const e of entities) {
    e.daily = dailyRows(e.meta.days, (meta?.countryDaily ?? []).filter((r) => r.campaign === e.metaCampaign), leadInfo.rows.filter((r) => r.campaign === e.key));
    e.meta.hoursYesterday = rollup((meta?.hourlyYesterday ?? []).filter((r) => r.campaign === e.metaCampaign), 'hour').sort((a, b) => a.key - b.key);
    e.dayOverDay = dayOverDay(e.daily, run.metaToday, minChange);
    e.trend = recentTrend(e.daily, run.metaToday, minChange);
    e.sameTime = sameTimeYesterday(e.meta.hours, e.meta.hoursYesterday, run.metaNowHour, minChange);
  }
  const active = entities.filter((e) => e.meta.impressions > 0 || e.ga4.sessions > 0 || e.leads.count > 0);

  // --- Account total (all campaigns + pending + leads that cannot be attributed to one campaign).
  const totalMeta = {
    impressions: sum(active.map((e) => e.meta), 'impressions'),
    clicks: sum(active.map((e) => e.meta), 'clicks'),
    lpv: sum(active.map((e) => e.meta), 'lpv'),
    spend: sum(active.map((e) => e.meta), 'spend'),
    metaLeads: sum(active.map((e) => e.meta), 'metaLeads'),
    reach: active.every((e) => e.meta.reach !== null) ? sum(active.map((e) => e.meta), 'reach') : null,
  };
  const totalGa4 = ga4Block();
  for (const b of [...active.map((e) => e.ga4), buckets.pending, buckets.unmapped]) {
    totalGa4.sessions += b.sessions;
    totalGa4.engaged += b.engaged;
    totalGa4.engagementSeconds += b.engagementSeconds;
    totalGa4.keyEvents += b.keyEvents;
    for (const k of Object.keys(totalGa4.events)) totalGa4.events[k] = b.events[k] === null || totalGa4.events[k] === null ? null : totalGa4.events[k] + b.events[k];
  }
  const totalLeads =
    active.reduce((s, e) => s + e.leads.count, 0) + leadInfo.fromMetaUnknownCampaign + leadInfo.rows.filter((r) => r.campaign === 'shared').length;
  const totalFunnel = funnelOf(totalMeta, totalGa4, totalLeads, 0);
  totalFunnel.sessionsEstimated = totalGa4.sessions;
  const total = {
    key: 'total',
    label: 'All campaigns',
    funnel: totalFunnel,
    rates: rates(totalFunnel),
    meta: totalMeta,
    intervals: { ctr: wilson(totalFunnel.clicks, totalFunnel.impressions), lpvToLead: wilson(totalFunnel.leads, totalFunnel.lpv) },
  };
  const allDays = rollup(active.flatMap((e) => e.meta.days.map((d) => ({ ...d, day: d.key }))), 'day').sort((x, y) => x.key.localeCompare(y.key));
  const hoursOf = (k) => rollup(active.flatMap((e) => e.meta[k]), 'key').sort((x, y) => x.key - y.key);
  total.daily = dailyRows(
    allDays,
    (meta?.countryDaily ?? []).filter((r) => active.some((e) => e.metaCampaign === r.campaign)),
    leadInfo.rows.filter((r) => r.campaign),
  );
  total.meta.hours = hoursOf('hours');
  total.meta.hoursYesterday = hoursOf('hoursYesterday');
  total.dayOverDay = dayOverDay(total.daily, run.metaToday, minChange);
  total.trend = recentTrend(total.daily, run.metaToday, minChange);
  total.sameTime = sameTimeYesterday(total.meta.hours, total.meta.hoursYesterday, run.metaNowHour, minChange);

  // --- Head-to-head between the two biggest campaigns.
  const [a, b] = [...active].sort((x, y) => y.meta.spend - x.meta.spend);
  const comparison = a && b
    ? {
        a: a.key,
        b: b.key,
        ctr: twoProportion(a.funnel.clicks, a.funnel.impressions, b.funnel.clicks, b.funnel.impressions),
        lpvPerClick: twoProportion(Math.min(a.funnel.lpv, a.funnel.clicks), a.funnel.clicks, Math.min(b.funnel.lpv, b.funnel.clicks), b.funnel.clicks),
        engagementRate: twoProportion(a.funnel.engaged, a.funnel.sessions, b.funnel.engaged, b.funnel.sessions),
        ctaRate: a.funnel.cta === null || b.funnel.cta === null ? null : twoProportion(Math.min(a.funnel.cta, a.funnel.sessions), a.funnel.sessions, Math.min(b.funnel.cta, b.funnel.sessions), b.funnel.sessions),
        lpvToLead: twoProportion(a.funnel.leads, a.funnel.lpv, b.funnel.leads, b.funnel.lpv),
      }
    : null;

  // --- Website (Cloudflare) view of the same visitors.
  const order = site?.sections ?? [];
  const visits = site?.visits ?? [];
  const inApp = visits.filter((v) => v.source === 'facebook' || v.source === 'instagram');
  const siteDays = site ? siteDaily(inApp, run.metaToday) : null;
  const siteBlock = site
    ? {
        window: site.window,
        sections: order,
        markers: site.markers,
        markerSections: site.markerSections ?? null,
        inApp: summarizeVisits(inApp, order, funnelCfg.site?.engagedDepth),
        browser: summarizeVisits(visits.filter((v) => v.source === 'browser'), order, funnelCfg.site?.engagedDepth),
        depth: order.map((s) => ({ section: s, visits: inApp.filter((v) => v.depth === s).length })),
        today: summarizeVisits(inApp.filter((v) => v.day === run.metaToday), order, funnelCfg.site?.engagedDepth),
        hoursToday: Array.from({ length: 24 }, (_, h) => inApp.filter((v) => v.day === run.metaToday && v.hour === h).length),
        hoursYesterday: Array.from({ length: 24 }, (_, h) => inApp.filter((v) => v.day === addDays(run.metaToday, -1) && v.hour === h).length),
        daily: siteDays,
        dayOverDay: siteDays && siteDayOverDay(siteDays),
        sameTime: siteSameTime(inApp, run.metaToday, addDays(run.metaToday, -1), run.metaNowHour),
        excluded: site.excluded,
        crawlers: site.crawlers,
        turnstile: site.turnstile,
        errors: site.errors ?? [],
      }
    : null;

  const changes = (campaignsCfg.changes ?? []).filter((c) => Date.parse(c.at) >= windowStart - 86400e3);

  return {
    schema: 1,
    run,
    campaigns: active.map(({ matchers, ...e }) => e),
    unconfigured: active.filter((e) => !e.configured).map((e) => e.metaCampaign),
    priorityMarkets: campaignsCfg.priorityMarkets ?? [],
    total,
    comparison,
    ga4: {
      rows: ga4Rows,
      buckets,
      sourceMedium: ga4?.sourceMedium?.rows ?? null,
      channels: ga4?.channel?.rows ?? null,
      cities: ga4?.city?.rows ?? null,
      countries: ga4?.country?.rows ?? null,
      tables: Object.fromEntries(Object.entries(tables).map(([k, t]) => [k, t ? { totals: t.totals, shown: t.shown, available: t.available, noData: t.noData, rows: t.rows.length } : null])),
    },
    leads: leadInfo,
    site: siteBlock,
    experiments: meta?.experiments ?? [],
    changes,
  };
}

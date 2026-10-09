// Diagnostics for the funnel model: findings (what works, what does not, why, what to change), per-campaign verdicts and
// data validation checks. Every rule states its evidence so the marketing team can check it.
import { addDays, zonedDate, zonedLabel } from '../../../_shared/time.mjs';
import { sumPeriod } from './daily.mjs';
import { int, money, pct } from './format.mjs';
import { parseDateSpan } from './meta.mjs';
import { binomialCdf } from './stats.mjs';

const IMPACT = { high: 3, medium: 2, low: 1 };
const EASE = { easy: 3, medium: 2, hard: 1 };
const share = (part, whole) => (whole > 0 ? part / whole : null);
const uniqueStrings = (list) => [...new Set(list.filter(Boolean))];
export const dayLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const pText = (t) => (t ? (t.pValue < 0.001 ? '<0.001' : t.pValue.toFixed(t.pValue < 0.01 ? 3 : 2)) : '–');
export const signedPct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${pct(Math.abs(v), 0)}`;

// What moved between two periods: tap rate, price per 1,000 impressions and page loads per tap.
export function drivers(cmp) {
  const parts = [];
  if (cmp.ctr) parts.push(`CTR ${pct(cmp.ctr.p2)} → ${pct(cmp.ctr.p1)} (p = ${pText(cmp.ctr)})`);
  if (cmp.cpmChange !== null) parts.push(`CPM ${money(cmp.earlierRates.cpm)} → ${money(cmp.laterRates.cpm)} (${signedPct(cmp.cpmChange)})`);
  if (cmp.lpvPerClick) parts.push(`clicks that load the page ${pct(cmp.lpvPerClick.p2, 0)} → ${pct(cmp.lpvPerClick.p1, 0)}`);
  return parts.join('; ');
}

function explainCostlier(cmp) {
  const down = (t) => t && t.pValue < 0.05 && t.p1 < t.p2;
  if (down(cmp.ctr)) {
    return {
      why: 'Fewer people tap the ad: typical ad fatigue once the same audience has seen it a few times.',
      action: 'Refresh the first 2 seconds or rotate in a new cut; widen the audience if frequency is above 2.',
    };
  }
  if (cmp.cpmChange >= 0.2) {
    return {
      why: 'Each 1,000 impressions cost more: more competition in the auction or a smaller audience.',
      action: 'Check audience size and frequency; widen locations or placements before raising the budget.',
    };
  }
  if (down(cmp.lpvPerClick)) {
    return { why: 'More taps fail to load the page.', action: 'Check placements (Audience Network) and page speed in the in-app browser.' };
  }
  return { why: 'A mix of small moves in tap rate and price, none decisive on its own.', action: 'Watch one more day before changing anything.' };
}

export function priority(f) {
  return (IMPACT[f.impact] ?? 1) * (EASE[f.effort] ?? 1);
}

// Two separate questions: does the ad bring cheap, real visits (traffic), and do visits become requests (leads)?
export function verdictFor(c, b) {
  const f = c.funnel;
  const r = c.rates;
  let traffic;
  if (f.impressions < 500) traffic = 'too early';
  else if ((r.ctr ?? 0) < b.linkCtr.poor || (f.clicks >= 30 && (r.lpvPerClick ?? 1) < b.lpvPerClick.poor)) traffic = 'weak';
  else if ((r.ctr ?? 0) >= b.linkCtr.good && (r.lpvPerClick ?? 0) >= (b.lpvPerClick.good ?? 0.85)) traffic = 'strong';
  else traffic = 'typical';
  let leads;
  if (f.leads > 0) leads = 'converting';
  else if (c.zeroLeadCheck && c.zeroLeadCheck.chanceOfZero < 0.05) leads = 'not converting';
  else leads = 'too early';
  const notes = [];
  if (r.ctr !== null) notes.push(`CTR ${pct(r.ctr)}`);
  if (r.costPerLpv !== null) notes.push(`${money(r.costPerLpv)} per landing page view`);
  if (f.leads > 0) notes.push(`${int(f.leads)} tour request${f.leads === 1 ? '' : 's'} (${money(r.costPerLead)} each)`);
  else if (c.zeroLeadCheck) notes.push(`0 requests from ${int(f.lpv)} page views (${pct(c.zeroLeadCheck.chanceOfZero, 0)} likely by chance)`);
  if (r.engagementRate !== null && f.sessions >= 10) notes.push(`${pct(r.engagementRate, 0)} of GA4 visits engaged`);
  return { traffic, leads, status: `Traffic ${traffic}, leads ${leads}`, notes };
}

export function diagnose(model, funnelCfg, campaignsCfg) {
  const b = funnelCfg.benchmarks;
  const findings = [];
  const add = (f) => findings.push({ severity: 'medium', impact: 'medium', effort: 'easy', campaign: null, ...f });
  const camps = model.campaigns;
  const label = (key) => camps.find((c) => c.key === key)?.label ?? key;
  const priorityMarkets = campaignsCfg.priorityMarkets ?? [];
  const allowed = campaignsCfg.targeting?.countries ?? [];
  const recentChange = (hours) =>
    (model.changes ?? []).filter((c) => {
      const age = Date.parse(model.run.generatedAt) - Date.parse(c.at);
      return age >= 0 && age < hours * 3600e3;
    });
  // Meta's country data is per day, so a targeting change made today cannot be checked until tomorrow's report.
  const changesToday = (model.changes ?? []).filter((c) => zonedDate(Date.parse(c.at), model.run.metaTimezone) === model.run.metaToday);
  const lastChange = changesToday.map((c) => Date.parse(c.at)).sort((x, y) => y - x)[0];
  const todayNote = lastChange
    ? ` (today's figures include the hours before the change logged at ${zonedLabel(lastChange, model.run.metaTimezone)}; confirm in tomorrow's report)`
    : '';

  for (const c of camps) {
    const f = c.funnel;
    const r = c.rates;
    c.verdict = verdictFor(c, b);

    // Geography: spend outside the targeted countries (today when available) and outside priority markets.
    const geo = c.meta.countriesToday?.length ? { rows: c.meta.countriesToday, when: 'today' } : { rows: c.meta.countries, when: 'in this window' };
    const geoSpend = geo.rows.reduce((s, x) => s + x.spend, 0);
    const cpm = (x) => (x.impressions ? `CPM ${money((x.spend / x.impressions) * 1000)}` : '');
    if (geoSpend > 0 && allowed.length) {
      const outside = geo.rows.filter((x) => !allowed.includes(x.key));
      const out = outside.reduce((s, x) => s + x.spend, 0);
      // Countries the change log says were removed today: today's spend there predates the change.
      const removedToday = new Set(changesToday.flatMap((x) => x.removedCountries ?? []));
      const alreadyRemoved = outside.length > 0 && outside.every((x) => removedToday.has(x.key)) && geo.when === 'today';
      if (share(out, geoSpend) > 0.05 && alreadyRemoved) {
        add({
          id: 'geo-removed-today', area: 'Ads', campaign: c.key, severity: 'info', impact: 'low', effort: 'easy',
          title: `${label(c.key)}: ${pct(share(out, geoSpend), 0)} of today's spend went to ${outside.map((x) => x.key).join(', ')} before ${outside.length === 1 ? 'it was' : 'they were'} removed`,
          evidence: outside.map((x) => `${x.key} ${money(x.spend)} (${int(x.clicks)} clicks)`).join(', ') + todayNote,
          why: 'Meta reports countries per day, so spend from before the change is still in today’s numbers.',
          action: 'Confirm in tomorrow’s report that this spend is $0.',
        });
      } else if (share(out, geoSpend) > 0.05) {
        add({
          id: 'geo-outside-target', area: 'Ads', campaign: c.key, severity: 'high', impact: 'high', effort: 'easy',
          title: `${label(c.key)}: ${pct(share(out, geoSpend), 0)} of spend ${geo.when} went to countries you do not target`,
          evidence: outside.map((x) => `${x.key} ${money(x.spend)} (${int(x.clicks)} clicks)`).join(', ') + (geo.when === 'today' ? todayNote : ''),
          why: 'Meta spends where clicks are cheapest. Clicks from markets you do not target rarely become buyers and dilute every downstream rate.',
          action: 'Ad set > Audience > Locations: remove these countries and choose "People living in this location". Re-check tomorrow.',
        });
      }
    }
    if (priorityMarkets.length && c.meta.countries.length) {
      const spend = c.meta.countries.reduce((s, x) => s + x.spend, 0);
      const prio = c.meta.countries.filter((x) => priorityMarkets.includes(x.key));
      const prioSpend = prio.reduce((s, x) => s + x.spend, 0);
      if (spend > 0 && share(prioSpend, spend) < b.priorityMarketSpendShareMin) {
        const others = c.meta.countries.filter((x) => !priorityMarkets.includes(x.key));
        add({
          id: 'geo-priority-share', area: 'Ads', campaign: c.key, severity: 'medium', impact: 'high', effort: 'easy',
          title: `${label(c.key)}: only ${pct(share(prioSpend, spend), 0)} of spend reached ${priorityMarkets.join('/')}`,
          evidence: [...others, ...prio].map((x) => `${x.key} ${pct(share(x.spend, spend), 0)} of spend, ${cpm(x)}, CTR ${pct(share(x.clicks, x.impressions))}`).join('; '),
          why: 'Meta buys the cheapest landing page views, and impressions in the priority market cost more (see CPM), so most of the budget goes elsewhere.',
          action: `Give ${priorityMarkets.join('/')} its own ad set with most of the budget, and the other countries a separate, smaller one (or remove them).`,
        });
      }
    }
    // US regions outside the targeted states ("people living in or recently in").
    const states = campaignsCfg.targeting?.regions?.US;
    if (c.meta.regions && states?.length) {
      const us = c.meta.regions.filter((x) => x.key.startsWith('United States|') || x.key.startsWith('US|'));
      const usSpend = us.reduce((s, x) => s + x.spend, 0);
      const outside = us.filter((x) => !states.includes(x.key.split('|')[1]));
      const out = outside.reduce((s, x) => s + x.spend, 0);
      if (usSpend > 0 && share(out, usSpend) > 0.1 && out >= 1) {
        add({
          id: 'geo-regions', area: 'Ads', campaign: c.key, severity: 'medium', impact: 'medium', effort: 'easy',
          title: `${label(c.key)}: ${pct(share(out, usSpend), 0)} of US spend landed outside ${states.join(', ')}`,
          evidence: outside.slice(0, 6).map((x) => `${x.key.split('|')[1]} ${money(x.spend)}`).join(', '),
          why: 'The location option "people living in or recently in" also reaches travellers and people passing through.',
          action: 'Ad set > Audience > Locations > choose "People living in this location".',
        });
      }
    }
    // Placements.
    if (c.meta.platforms?.length) {
      const spend = c.meta.platforms.reduce((s, x) => s + x.spend, 0);
      const weak = c.meta.platforms.filter((x) => /audience_network|messenger|threads/i.test(x.key));
      const weakSpend = weak.reduce((s, x) => s + x.spend, 0);
      if (share(weakSpend, spend) > 0.1) {
        add({
          id: 'placements', area: 'Ads', campaign: c.key, severity: 'medium', impact: 'medium', effort: 'easy',
          title: `${label(c.key)}: ${pct(share(weakSpend, spend), 0)} of spend on low-intent placements`,
          evidence: weak.map((x) => `${x.key} ${money(x.spend)}, ${int(x.clicks)} clicks, ${int(x.lpv)} page views`).join('; '),
          why: 'Audience Network and Messenger placements produce accidental taps that rarely load the page or convert.',
          action: 'Ad set > Placements > Manual: keep Facebook and Instagram Feed, Stories and Reels; untick Audience Network and Messenger.',
        });
      }
    }
    // Ad -> site.
    if (f.impressions >= 1000 && r.ctr !== null && r.ctr < b.linkCtr.poor) {
      add({
        id: 'ctr-low', area: 'Ads', campaign: c.key, severity: 'high', impact: 'high', effort: 'medium',
        title: `${label(c.key)}: link CTR ${pct(r.ctr)} is below ${pct(b.linkCtr.poor)}`,
        evidence: `${int(f.clicks)} link clicks from ${int(f.impressions)} impressions`,
        why: 'The first seconds of the video are not giving people a reason to tap.',
        action: 'Open with the most striking shot, add on-screen text with price and location in the first 2 seconds, and test a second cut.',
      });
    }
    if (f.clicks >= 30 && r.lpvPerClick !== null && r.lpvPerClick < b.lpvPerClick.poor) {
      add({
        id: 'lpv-low', area: 'Ads', campaign: c.key, severity: 'medium', impact: 'medium', effort: 'easy',
        title: `${label(c.key)}: only ${pct(r.lpvPerClick, 0)} of clicks loaded the page`,
        evidence: `${int(f.lpv)} landing page views from ${int(f.clicks)} link clicks`,
        why: 'Accidental taps or people leaving before the page loads in the in-app browser.',
        action: 'Remove Audience Network placements; keep the landing page light (it is already fast) and the hero image small.',
      });
    }
    if (f.lpv >= 30 && r.sessionCapture !== null && r.sessionCapture < b.sessionCapture.poor) {
      add({
        id: 'ga4-capture', area: 'Tracking', campaign: c.key, severity: 'low', impact: 'low', effort: 'easy',
        title: `${label(c.key)}: GA4 sees ${pct(r.sessionCapture, 0)} as many sessions as Meta counts page views`,
        evidence: `${int(f.sessionsEstimated)} GA4 sessions (incl. pending estimate) vs ${int(f.lpv)} landing page views`,
        why: 'Ad blockers, in-app browser privacy and GA4 processing delay all lose sessions; Meta counts the page load itself.',
        action: 'No change needed unless the gap persists after 48 h; use Meta landing page views for ad→site rates.',
      });
    }
    // Site -> lead (per campaign only with enough GA4 sessions; the account-level website rules follow the loop).
    if (f.sessions >= 50 && r.engagementRate !== null && r.engagementRate < b.engagementRate.poor) {
      add({
        id: 'engagement-low', area: 'Website', campaign: c.key, severity: 'high', impact: 'high', effort: 'medium',
        title: `${label(c.key)}: only ${pct(r.engagementRate, 0)} of ad visits engaged`,
        evidence: `${int(f.engaged)} engaged of ${int(f.sessions)} GA4 sessions (engaged = 10 s+, 2 pages or a key event)`,
        why: 'The first screen does not continue the ad’s story, or the ad promised something the page does not show first.',
        action: 'Match the first screen to the ad (same scene, price, location) and keep the tour button in view; compare with the on-site depth table below.',
      });
    }
    if (c.zeroLeadCheck) {
      const z = c.zeroLeadCheck;
      const significant = z.chanceOfZero < 0.05;
      add({
        id: significant ? 'zero-leads-signal' : 'zero-leads-normal', area: 'Website', campaign: c.key,
        severity: significant ? 'high' : 'info', impact: significant ? 'high' : 'low', effort: significant ? 'medium' : 'easy',
        title: significant
          ? `${label(c.key)}: 0 tour requests from ${int(f.lpv)} page views is unlikely to be bad luck`
          : `${label(c.key)}: 0 tour requests so far is still normal`,
        evidence: `If ${pct(z.assumedRate)} of visitors requested a tour, 0 requests from ${int(f.lpv)} page views has a ${pct(z.chanceOfZero, 0)} chance; about ${int(z.lpvNeeded)} page views are needed before zero becomes meaningful.`,
        why: significant ? 'Visitors arrive but the page does not turn them into requests.' : 'Tour requests for a single listing are rare; at this volume zero is expected.',
        action: significant
          ? 'Add a lower-commitment step (virtual tour or "text me the details") next to the tour button and retarget engaged visitors.'
          : 'Keep running; judge the ads on engaged visits and tour-button clicks until volume builds.',
      });
    }
    if (r.frequency !== null && r.frequency > b.frequencyHigh) {
      add({
        id: 'frequency', area: 'Ads', campaign: c.key, severity: 'medium', impact: 'medium', effort: 'easy',
        title: `${label(c.key)}: people see the ad ${r.frequency.toFixed(1)} times on average`,
        evidence: `${int(f.impressions)} impressions to about ${int(f.reach)} people`,
        why: 'Repeated views lower CTR and raise cost (ad fatigue).',
        action: 'Add a second creative to the ad set or widen the audience.',
      });
    }
    if (c.pacing && c.pacing.ratio < b.pacingLow && c.pacing.days >= 1) {
      add({
        id: 'pacing', area: 'Ads', campaign: c.key, severity: 'medium', impact: 'medium', effort: 'easy',
        title: `${label(c.key)}: spent ${pct(c.pacing.ratio, 0)} of its budget`,
        evidence: `${money(c.pacing.spend)} spent vs ${money(c.pacing.budget)} budget over ${c.pacing.days.toFixed(1)} days`,
        why: 'A narrow audience, a bid cap or ad review limits delivery.',
        action: 'Check Delivery and the ad set’s audience size; remove bid caps or widen locations.',
      });
    }
    if (c.learning && recentChange(b.learningHours).length) {
      add({
        id: 'learning', area: 'Ads', campaign: c.key, severity: 'info', impact: 'medium', effort: 'easy',
        title: `${label(c.key)}: in the learning phase after a recent edit`,
        evidence: recentChange(b.learningHours).map((x) => `${x.at}: ${x.what}`).join('; '),
        why: 'Significant edits restart learning; results are unstable for about 2 days.',
        action: 'Avoid further edits for 48 hours unless something is clearly wrong.',
      });
    }
    // Tracking hygiene for each ad.
    for (const ad of c.settings.ads) {
      if (!ad.urlTags) {
        add({
          id: 'utm-missing', area: 'Tracking', campaign: c.key, severity: 'high', impact: 'high', effort: 'easy',
          title: `${label(c.key)}: ad "${ad.name}" has no URL parameters`,
          evidence: 'Ads Manager shows an empty URL parameters field',
          why: 'Without UTM tags GA4 cannot attribute visits or tour requests to this ad.',
          action: 'Ad > Tracking > URL parameters: utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}',
        });
      }
    }
  }

  // Account-level rules.
  // Day over day: only changes beyond daily noise become findings; the report shows every comparison.
  const changesFrom = (fromDay, toDay) => {
    const list = (model.changes ?? []).filter((x) => {
      const d = zonedDate(Date.parse(x.at), model.run.metaTimezone);
      return d >= fromDay && d <= toDay;
    });
    return list.length ? `; changes logged in that time: ${list.map((x) => `${zonedLabel(Date.parse(x.at), model.run.metaTimezone)} ${x.what}`).join('; ')}` : '';
  };
  for (const c of camps) {
    const scopes = [
      [c.dayOverDay, 'day', (x) => `from ${dayLabel(x.previousDay)} to ${dayLabel(x.latestDay)}`, (x) => [x.previousDay, x.latestDay]],
      [c.trend, 'trend', (x) => `over the last ${x.recentDays.length} days vs the ${x.beforeDays.length} before`, (x) => [x.beforeDays[0], x.recentDays.at(-1)]],
      [c.sameTime, 'today', (x) => `today until ${x.untilHour}:00 vs yesterday until ${x.untilHour}:00`, () => [addDays(model.run.metaToday, -1), model.run.metaToday]],
    ];
    for (const [cmp, scope, when, span] of scopes) {
      if (!cmp?.significant) continue;
      const cheaper = cmp.direction === 'cheaper';
      const ex = cheaper ? null : explainCostlier(cmp);
      add({
        id: `${scope}-${cheaper ? 'cheaper' : 'costlier'}`, area: 'Ads', campaign: c.key, positive: cheaper,
        severity: cheaper || scope === 'today' ? 'info' : 'medium', impact: 'medium', effort: 'easy',
        title: `${label(c.key)}: cost per page view ${cheaper ? 'fell' : 'rose'} ${pct(Math.abs(cmp.cost.change), 0)} ${when(cmp)}`,
        evidence: `${money(cmp.cost.from)} → ${money(cmp.cost.to)} (p = ${pText(cmp.cost)}); ${drivers(cmp)}${changesFrom(...span(cmp))}`,
        why: cheaper ? 'More taps and page loads for the same money.' : ex.why,
        action: cheaper ? 'Keep the current setup; if a change was logged in that time, it is working.' : ex.action,
      });
    }
  }
  const sd = model.site?.dayOverDay;
  if (sd?.pastHero && sd.pastHero.pValue < 0.05) {
    const better = sd.pastHero.p1 > sd.pastHero.p2;
    add({
      id: better ? 'site-day-better' : 'site-day-worse', area: 'Website', positive: better, severity: better ? 'info' : 'medium', impact: 'medium', effort: 'easy',
      title: `${better ? 'More' : 'Fewer'} Facebook/Instagram visitors scrolled past the first screen on ${dayLabel(sd.latestDay)} than on ${dayLabel(sd.previousDay)}`,
      evidence: `${pct(sd.pastHero.p2, 0)} → ${pct(sd.pastHero.p1, 0)} of in-app visits (p = ${pText(sd.pastHero)})${changesFrom(sd.previousDay, sd.latestDay)}`,
      why: better ? 'The first screen now holds more visitors.' : 'Fewer visitors find a reason to scroll after the latest site or ad change.',
      action: better ? 'Keep the change.' : 'Compare with the change log and revert or adjust the latest site or creative change.',
    });
  }
  // Website: where ad visitors stop (Cloudflare, bots and owner traffic removed) and whether form starters finish.
  const s = model.site?.inApp;
  if (s && s.visits >= 30) {
    const top = model.site.depth.find((d) => d.section === 'top')?.visits ?? 0;
    const firstMarked = model.site.markerSections?.[0] ?? funnelCfg.site.engagedDepth;
    if (share(top, s.visits) >= 0.4) {
      add({
        id: 'first-screen-exit', area: 'Website', severity: 'high', impact: 'high', effort: 'medium',
        title: `${pct(share(top, s.visits), 0)} of Facebook/Instagram visitors leave before reaching the ${firstMarked}`,
        evidence: `${int(top)} of ${int(s.visits)} in-app visits never loaded an image below the first screen; ${int(s.visits - top)} scrolled on (${model.site.depth.filter((d) => d.section !== 'top' && d.visits).map((d) => `${d.section} ${int(d.visits)}`).join(', ')})`,
        why: 'In the in-app browser people decide in a second or two; if the first screen does not continue what the video showed (the view, the price, the place), they close it.',
        action: 'Make the first screen continue the ad: same opening scene, price and location in large type, tour button visible; consider showing the photo strip in the first screen.',
      });
    }
  }
  const starts = model.total.funnel.formStarts === null ? null : Math.round(model.total.funnel.formStarts);
  const sent = Math.round(model.total.funnel.leads);
  if (starts !== null && starts >= 3 && sent / starts < 0.3) {
    const chance = binomialCdf(sent, starts, 0.3);
    add({
      id: 'form-friction', area: 'Website', severity: 'high', impact: 'high', effort: 'medium',
      title: `${int(starts)} ad visitors started the tour form, ${int(sent)} sent it`,
      evidence:
        `form starts (GA4): ${camps.map((c) => `${c.label} ${int(c.funnel.formStarts)}`).join(', ')}` +
        `${s ? `; ${int(s.formOpened)} in-app visitors reached or opened the form and ${int(s.requestSent)} sent it${s.requestSent > sent ? ' (without ad tags)' : ''} (website)` : ''}` +
        `; if 30% of starters normally finish, ${int(sent)} of ${int(starts)} has a ${pct(chance, 0)} chance`,
      why: 'Starting but not sending points at the form itself: five required fields (name, phone, email, date, time) and date pickers are a lot on a phone.',
      action: 'Require only a name and one contact method; make date and time optional with "flexible" pre-selected (form and API validation).',
    });
  }
  const staticTags = camps.flatMap((c) => c.settings.ads.filter((a) => a.utm?.utm_campaign && !a.utm.utm_campaign.includes('{{')));
  if (staticTags.length) {
    add({
      id: 'utm-dynamic', area: 'Tracking', severity: 'low', impact: 'medium', effort: 'easy',
      title: 'Use dynamic UTM values so every new ad is tracked automatically',
      evidence: staticTags.map((a) => `${a.name}: utm_campaign=${a.utm.utm_campaign}`).join('; '),
      why: 'Hand-typed values must be re-typed for every new ad, and two ads sharing one value cannot be told apart in GA4.',
      action: 'URL parameters: utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}} (then add the campaign to campaigns.local.json only for a friendly label).',
    });
  }
  const sharedRows = model.ga4.rows.filter((r) => r.kind === 'shared');
  if (sharedRows.length) {
    add({
      id: 'utm-shared', area: 'Data', severity: 'info', impact: 'low', effort: 'easy',
      title: 'Part of the GA4 data is split between campaigns by estimate',
      evidence: sharedRows.map((r) => `${r.campaign}: ${int(r.sessions)} sessions split ${Object.entries(r.weights).map(([k, w]) => `${label(k)} ${pct(w, 0)}`).join(' / ')}`).join('; '),
      why: 'Both ads sent the same utm_campaign for a while, so GA4 cannot tell them apart; the split follows each ad’s landing page views.',
      action: 'Nothing to do; the estimate disappears from reports once the window starts after the retag.',
    });
  }
  const adSessions = model.total.funnel.sessions;
  const pendingBucket = model.ga4.buckets.pending;
  const pending = pendingBucket.sessions;
  if (adSessions > 0 && share(pending, adSessions) > b.pendingShareHigh) {
    add({
      id: 'ga4-pending', area: 'Data', severity: 'info', impact: 'low', effort: 'easy',
      title: `${pct(share(pending, adSessions), 0)} of ad sessions are not yet attributed to a campaign in GA4`,
      evidence: `${int(pending)} sessions show as "${funnelCfg.ga4.pendingCampaign}" with ${pct(share(pendingBucket.engaged, pending), 0)} engaged`,
      why: 'GA4 assigns campaign names to recent sessions within 24–48 hours. Sessions that stay unattributed with no engagement are usually automated (ad review, link previews).',
      action: 'Per-campaign GA4 numbers will change; re-run tomorrow and judge GA4 rates on days that are at least a day old.',
    });
  }
  const unmapped = model.ga4.buckets.unmapped.rows.filter((r) => r.sessions > 0);
  if (unmapped.length) {
    const heavy = model.ga4.buckets.unmapped.sessions > Math.max(2, adSessions * 0.05);
    add({
      id: 'utm-unmapped', area: 'Tracking', severity: heavy ? 'low' : 'info', impact: 'low', effort: 'easy',
      title: 'GA4 campaign values that match no Meta campaign',
      evidence: unmapped.map((r) => `${r.campaign} (${int(r.sessions)} sessions)`).join(', '),
      why: 'An old or mistyped utm_campaign value; these visits are counted in the total but not in any campaign.',
      action: 'Add the value to the right campaign in campaigns.local.json (utm list), or to ignoreUtm if it is test traffic.',
    });
  }
  for (const name of model.unconfigured) {
    add({
      id: 'campaign-unconfigured', area: 'Data', severity: 'low', impact: 'low', effort: 'easy',
      title: `Meta campaign "${name}" is not in campaigns.local.json`,
      evidence: 'It delivered in this window; GA4 rows are matched only through the ad’s live URL parameters.',
      why: 'Without a config entry it has no friendly label, budget or old UTM values.',
      action: 'Add it to campaigns.local.json.',
    });
  }
  // Pixel vs database leads (both counted only for requests that carry ad tags; untagged ones are listed for context).
  const pixel = model.total.funnel.metaLeads;
  const stored = model.total.funnel.leads;
  if (pixel !== stored && (pixel > 0 || stored > 0)) {
    add({
      id: 'pixel-vs-db', area: 'Tracking', severity: 'medium', impact: 'medium', effort: 'easy',
      title: `Meta reports ${int(pixel)} pixel lead${pixel === 1 ? '' : 's'}; the website stored ${int(stored)} request${stored === 1 ? '' : 's'} with ad tags`,
      evidence: `${int(model.leads.metaUntagged ?? 0)} more from Facebook/Instagram without tags; ${int(model.leads.real)} real and ${int(model.leads.test)} test requests in the database`,
      why: pixel > stored
        ? 'Meta also credits leads from people who saw or clicked an ad earlier and came back another way, and test submissions fire the pixel.'
        : 'Browsers that block the pixel (iOS, ad blockers) hide some leads from Meta, so it optimises on fewer conversions.',
      action: pixel > stored
        ? 'Treat Meta lead counts as an upper bound; the database is the source of truth.'
        : 'Consider the Conversions API (server-side Lead event) so Meta sees every request.',
    });
  }
  // A/B test configuration.
  for (const x of model.experiments) {
    if (x.keyMetric && !/landing page|lead|conversion|link click/i.test(x.keyMetric)) {
      add({
        id: 'ab-key-metric', area: 'Ads', severity: 'medium', impact: 'medium', effort: 'easy',
        title: `The A/B test picks its winner on "${x.keyMetric}"`,
        evidence: `${x.status ?? ''} ${x.duration ? `(${x.duration})` : ''}; ${x.arms.map((a) => `${a.arm} ${a.name}: ${a.value}`).join(', ')}`.trim(),
        why: 'Post engagement rewards the video people like or replay, not the one that sends buyers to the site.',
        action: 'Judge the ads in this report (cost per engaged visit, tour-button clicks). For the next test choose "Cost per landing page view" or "Cost per lead" as key metric.',
      });
    }
  }
  // A/B test length and budget parity (Meta: at least 7 days, the same budget for both versions).
  const year = Number(model.run.until.slice(0, 4));
  const dayList = (from, to) => {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  };
  for (const x of model.experiments) {
    const running = /progress|scheduled|running/i.test(x.status ?? '');
    const span = x.duration ? parseDateSpan(x.duration, year) : null;
    if (!running || !span) continue;
    // "Oct 8, 12:00 AM - Oct 14, 12:00 AM" ends at the start of Oct 14; an 11:59 PM end includes that day.
    const lastDay = /11:59\s*PM\s*$/i.test(x.duration) ? span.to : addDays(span.to, -1);
    const days = dayList(span.from, lastDay).length;
    if (days < 7) {
      add({
        id: 'ab-duration', area: 'Ads', severity: 'medium', impact: 'medium', effort: 'easy',
        title: `The A/B test runs ${days} day${days === 1 ? '' : 's'}, under Meta's 7-day minimum`,
        evidence: `Test schedule ${x.duration}; ${x.status}`,
        why: 'Tests shorter than 7 days miss weekday/weekend differences and often end without a confident winner.',
        action: `Treat this test's result as directional and schedule the next test for 7+ days. To extend this one, Experiments > the test > Edit schedule, ending ${dayLabel(addDays(span.from, 7))} or later (Meta notes schedule changes affect the reliability of results so far).`,
      });
    }
    const arms = x.arms.map((a) => camps.find((c) => c.metaCampaign === a.name)).filter(Boolean);
    if (arms.length < 2 || arms.some((c) => !c.campaignSettings)) continue;
    const budgetOn = (c, day) => c.campaignSettings.scheduledBudgets.find((s) => s.from && s.from <= day && day <= s.to)?.dailyBudget ?? c.campaignSettings.dailyBudget;
    const remaining = dayList(model.run.metaToday > span.from ? model.run.metaToday : span.from, lastDay);
    const uneven = remaining.filter((day) => new Set(arms.map((c) => budgetOn(c, day))).size > 1);
    if (uneven.length) {
      const scheduled = arms.flatMap((c) => c.campaignSettings.scheduledBudgets.map((s) => `${c.label} ${money(s.dailyBudget)}/day for ${s.period}`));
      add({
        id: 'ab-budget', area: 'Ads', severity: 'medium', impact: 'high', effort: 'easy',
        title: `The A/B test arms will not have the same budget on ${uneven.length} test day${uneven.length === 1 ? '' : 's'}`,
        evidence: `${uneven.map((day) => `${dayLabel(day)}: ${arms.map((c) => `${c.label} ${money(budgetOn(c, day))}`).join(' vs ')}`).join('; ')}${scheduled.length ? ` (scheduled: ${scheduled.join('; ')})` : ''}`,
        why: 'With a larger budget one arm buys more, and more expensive, impressions, so the comparison is no longer like for like; a 50% budget jump can also restart the learning phase.',
        action: 'Give both campaigns the same daily budget for every test day: add the same budget schedule to the other campaign, or remove the schedule until the test ends (Campaign > Budget > Budget scheduling).',
      });
    }
  }
  // Housing special ad category (required for ads about homes for sale reaching the US or Canada).
  const withSettings = camps.filter((c) => c.campaignSettings);
  for (const c of withSettings.filter((y) => !y.campaignSettings.specialAdCategories.some((s) => /housing/i.test(s)))) {
    add({
      id: 'special-ad-category', area: 'Ads', campaign: c.key, severity: 'high', impact: 'high', effort: 'easy',
      title: `${label(c.key)}: the campaign does not declare the Housing special ad category`,
      evidence: `Special ad categories in Ads Manager: ${c.campaignSettings.specialAdCategories.join(', ') || 'none'}`,
      why: 'Meta requires the Housing category for ads about homes for sale; undeclared housing ads can be rejected and the ad account restricted.',
      action: 'Campaign > Special ad categories: choose Housing and the countries you advertise in (age, gender and ZIP code targeting become unavailable).',
    });
  }
  if (withSettings.length && withSettings.every((c) => c.campaignSettings.specialAdCategories.some((s) => /housing/i.test(s)))) {
    add({
      id: 'special-ad-category-ok', area: 'Ads', severity: 'info', impact: 'low', effort: 'easy', positive: true,
      title: `Compliance: ${withSettings.length === camps.length ? 'every campaign declares' : `${withSettings.map((c) => c.label).join(' and ')} declare${withSettings.length === 1 ? 's' : ''}`} the Housing special ad category`,
      evidence: withSettings.map((c) => `${c.label}: ${c.campaignSettings.specialAdCategories.join(', ')} (${c.campaignSettings.specialAdCountries ?? 'countries not shown'})`).join('; '),
      why: 'Required by Meta for housing ads; it protects the ad account from rejected ads.',
      action: 'Keep it on every new campaign.',
    });
  }
  // Optimisation goal: Traffic campaigns optimise for page loads, not for tour requests.
  const traffic = camps.filter((c) => /traffic/i.test(c.settings.campaign?.objective ?? ''));
  const xTraffic = model.experiments.find((x) => /traffic/i.test(x.objective ?? ''));
  if (traffic.length || xTraffic) {
    const goals = uniqueStrings(camps.flatMap((c) => c.settings.adsets.map((a) => [a.bidStrategy, a.goal].filter(Boolean).join(' '))));
    add({
      id: 'objective-traffic', area: 'Ads', severity: 'info', impact: 'medium', effort: 'medium',
      title: 'Campaigns optimise for landing page views, not tour requests',
      evidence: `${traffic.length ? `Objective Traffic: ${traffic.map((c) => c.label).join(', ')}` : `A/B test objective: ${xTraffic.objective}`}${goals.length ? `; ad sets: ${goals.join(', ')}` : ''}`,
      why: 'Meta finds people who load pages cheaply; it does not learn who requests tours.',
      action: 'Keep Traffic while requests are rare. After the first 10–20 requests, test a Leads campaign optimised for the website Lead event (the pixel already fires it on submit).',
    });
  }
  // Bots in GA4 (Meta ad-review and data-centre traffic).
  if (model.ga4.cities?.length) {
    const dc = new Set(funnelCfg.ga4.dataCenterCities ?? []);
    const users = model.ga4.cities.reduce((s, r) => s + (r.activeUsers ?? 0), 0);
    const bots = model.ga4.cities.filter((r) => dc.has(r.dimension)).reduce((s, r) => s + (r.activeUsers ?? 0), 0);
    if (users > 0 && share(bots, users) > b.dataCenterShareHigh) {
      add({
        id: 'bots', area: 'Data', severity: 'info', impact: 'low', effort: 'easy',
        title: `${pct(share(bots, users), 0)} of GA4 users come from data-centre cities`,
        evidence: model.ga4.cities.filter((r) => dc.has(r.dimension)).map((r) => `${r.dimension} ${int(r.activeUsers)}`).join(', '),
        why: 'Meta’s ad-review crawlers load the page from data centres; they never engage, so they pull GA4 engagement down.',
        action: 'Read engagement from the Cloudflare in-app visits (bots excluded) when the two disagree.',
      });
    }
  }
  // Head-to-head.
  const cmp = model.comparison;
  if (cmp) {
    const A = camps.find((c) => c.key === cmp.a);
    const B = camps.find((c) => c.key === cmp.b);
    for (const [metric, name] of [['ctr', 'link CTR'], ['lpvPerClick', 'clicks that load the page'], ['engagementRate', 'engaged visits'], ['ctaRate', 'tour-button clicks per visit']]) {
      const t = cmp[metric];
      if (!t || t.pValue === undefined || t.pValue >= 0.05) continue;
      const [win, lose] = t.p1 > t.p2 ? [A, B] : [B, A];
      add({
        id: `ab-${metric}`, area: 'Ads', campaign: win.key, severity: 'info', impact: 'medium', effort: 'easy', positive: true,
        title: `${win.label} beats ${lose.label} on ${name}`,
        evidence: `${pct(Math.max(t.p1, t.p2))} vs ${pct(Math.min(t.p1, t.p2))} (two-proportion z-test p = ${t.pValue < 0.001 ? '<0.001' : t.pValue.toFixed(3)})`,
        why: 'The difference is larger than chance at this volume.',
        action: metric === 'ctr' || metric === 'lpvPerClick' ? `Use ${win.label}’s opening and caption style in the next creative.` : `${win.label} brings visitors who look further; give it the larger share of budget if leads stay equal.`,
      });
    }
  }

  findings.sort((x, y) => priority(y) - priority(x) || (IMPACT[y.impact] ?? 0) - (IMPACT[x.impact] ?? 0));
  return findings;
}

export function validate(model, collect) {
  const checks = [];
  const add = (id, status, title, detail) => checks.push({ id, status, title, detail });
  const close = (a, b, abs = 1) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * 0.01);

  for (const [source, info] of Object.entries(collect.sources)) {
    const status = { ok: 'pass', skipped: 'info', partial: 'warn' }[info.status] ?? 'fail';
    add(`source-${source}`, status, `${source} data collected`, info.detail ?? info.status);
  }
  for (const item of collect.metaExports ?? []) {
    if (!item.ok) continue;
    const [from, toExcl] = item.requested.split('_');
    const expected = `${from} … ${addDays(toExcl, -1)}`;
    if (!item.rows) {
      add(`meta-range-${item.name}`, 'info', `Meta export "${item.name}" covers the requested dates`, item.skipped ? `skipped for ${expected}: no delivery on that day` : `no rows for ${expected}`);
      continue;
    }
    // Meta echoes the requested range in every row, except day breakdowns where each row carries its own day.
    const starts = (item.reportingStarts ?? '').split(',').filter(Boolean).sort();
    const ends = (item.reportingEnds ?? '').split(',').filter(Boolean).sort();
    const last = addDays(toExcl, -1);
    const inside = starts.every((s) => s >= from) && ends.every((e) => e <= last);
    const ok = inside && (/daily/.test(item.name) || (starts[0] === from && ends.at(-1) === last));
    add(`meta-range-${item.name}`, ok ? 'pass' : 'warn', `Meta export "${item.name}" covers the requested dates`, `requested ${expected}; file says ${starts[0] ?? '–'} … ${ends.at(-1) ?? '–'}`);
  }
  // The country export is taken a minute after the daily one; while the window includes today, the ads keep delivering in between.
  const live = model.run.until >= model.run.metaToday;
  for (const c of model.campaigns) {
    if (c.meta.countries.length) {
      const sums = ['impressions', 'clicks', 'spend'].map((k) => [k, c.meta[k], c.meta.countries.reduce((s, x) => s + x[k], 0)]);
      const bad = sums.filter(([k, a, b]) => !close(a, b, k === 'spend' ? 0.02 : 1));
      const drift = live && bad.length > 0 && bad.every(([, a, b]) => b >= a && b - a <= a * 0.05);
      const detail = sums.map(([k, a, b]) => `${k} ${k === 'spend' ? money(a) : int(a)} vs ${k === 'spend' ? money(b) : int(b)}`).join('; ');
      add(`meta-sum-${c.key}`, bad.length && !drift ? 'warn' : 'pass', `${c.label}: daily totals match the country breakdown`, drift ? `${detail}; the country export was taken after the daily one while the ads were delivering, so it includes slightly more` : detail);
    }
    const yd = c.daily?.find((d) => d.day === addDays(model.run.metaToday, -1));
    if (yd && c.meta.hoursYesterday?.length) {
      const h = sumPeriod(c.meta.hoursYesterday);
      const sums = ['impressions', 'clicks', 'spend'].map((k) => [k, h[k], yd[k]]);
      const bad = sums.filter(([k, a, b]) => !close(a, b, k === 'spend' ? 0.02 : 1));
      add(`meta-hours-${c.key}`, bad.length ? 'warn' : 'pass', `${c.label}: yesterday's hours add up to yesterday's total`, sums.map(([k, a, b]) => `${k} ${k === 'spend' ? money(a) : int(a)} vs ${k === 'spend' ? money(b) : int(b)}`).join('; '));
    }
    const f = c.funnel;
    const order = [];
    if (f.clicks > f.impressions) order.push('clicks > impressions');
    if (f.lpv > f.clicks * 1.05 + 1) order.push('landing page views > clicks');
    if (f.formStarts !== null && f.submitted !== null && f.submitted > f.formStarts) order.push('submissions > form starts');
    add(`funnel-order-${c.key}`, order.length ? 'warn' : 'pass', `${c.label}: funnel stages are in order`, order.join('; ') || 'impressions ≥ clicks ≥ page views; form starts ≥ submissions');
  }
  const t = model.ga4.tables;
  const totals = Object.entries(t).filter(([, x]) => x?.totals).map(([k, x]) => [k, x.totals.sessions]);
  if (totals.length) {
    const same = totals.every(([, s]) => s === totals[0][1]);
    add('ga4-tables-consistent', same ? 'pass' : 'warn', 'GA4 event tables agree on total sessions', totals.map(([k, s]) => `${k} ${int(s)}`).join(', '));
    const rowsSum = model.ga4.rows.reduce((s, r) => s + r.sessions, 0);
    const total = totals[0][1];
    // GA4 de-duplicates the total; a session can appear under two campaign values, so rows may add up to more.
    add(
      'ga4-rows-sum',
      close(rowsSum, total) ? 'pass' : rowsSum > total ? 'info' : 'warn',
      'GA4 campaign rows add up to the table total',
      rowsSum > total && !close(rowsSum, total)
        ? `${int(rowsSum)} in rows vs ${int(total)} de-duplicated total: GA4 counts some sessions under more than one campaign value`
        : `${int(rowsSum)} vs total ${int(total)}`,
    );
  }
  const paged = Object.entries(t).filter(([, x]) => x && x.shown !== null && x.available !== null && x.shown < x.available);
  add('ga4-all-rows', paged.length ? 'warn' : 'pass', 'All GA4 rows were read', paged.length ? paged.map(([k, x]) => `${k}: ${x.shown} of ${x.available}`).join(', ') : 'no table was cut off');
  const ga4Submitted = Object.values(t).length && t.submitted?.totals ? t.submitted.totals.eventCount : null;
  if (ga4Submitted !== null && ga4Submitted !== undefined) {
    const db = model.leads.real + model.leads.test;
    const status = ga4Submitted <= db && db - ga4Submitted <= Math.max(1, db * 0.3) ? 'pass' : 'warn';
    add('leads-ga4-vs-db', status, 'GA4 submission events agree with stored requests', `GA4 ${int(ga4Submitted)} submission events; database ${int(db)} requests (${int(model.leads.real)} real, ${int(model.leads.test)} test)`);
  }
  if (model.site) {
    const lpv = model.total.funnel.lpv;
    const v = model.site.inApp.visits;
    const r = lpv ? v / lpv : null;
    add('site-vs-meta', r === null ? 'info' : r >= 0.3 && r <= 1.3 ? 'pass' : 'warn', 'Website in-app visits are in line with Meta page views', `${int(v)} Facebook/Instagram in-app visits vs ${int(lpv)} Meta landing page views (${r === null ? '–' : pct(r, 0)}); in-app visits are a lower bound because some ad clicks open in other browsers.`);
  }
  const unmapped = model.ga4.buckets.unmapped.sessions;
  const ad = model.total.funnel.sessions;
  add('mapping', unmapped > Math.max(2, ad * 0.05) || model.unconfigured.length ? 'warn' : 'pass', 'Every ad campaign and UTM value is mapped', `${int(unmapped)} unmapped GA4 sessions; ${model.unconfigured.length} Meta campaigns missing from config`);
  add('time-zones', 'info', 'Day boundaries differ by source', `Meta and the website use ${model.run.metaTimezone}; GA4 uses ${model.run.ga4Timezone}. Daily figures can differ at the edges; window totals are comparable.`);
  return checks;
}

export function deltas(model, previous) {
  if (!previous || previous.run?.since !== model.run.since) return null;
  const keys = ['impressions', 'clicks', 'lpv', 'spend', 'sessions', 'engaged', 'cta', 'formStarts', 'leads'];
  const diff = (a, b) => Object.fromEntries(keys.map((k) => [k, a?.[k] === null || a?.[k] === undefined || b?.[k] === null || b?.[k] === undefined ? null : a[k] - b[k]]));
  return {
    since: previous.run.generatedAt,
    previousRun: previous.run.runId,
    total: diff(model.total.funnel, previous.total?.funnel),
    campaigns: Object.fromEntries(model.campaigns.map((c) => [c.key, diff(c.funnel, previous.campaigns?.find((p) => p.key === c.key)?.funnel)])),
  };
}

// Day-over-day comparisons. Only like is compared with like: complete days with complete days, and today with
// yesterday up to the same hour. Every change carries a test, because one campaign's daily counts are small.
import { normalCdf, twoProportion } from './stats.mjs';

const ratio = (a, b) => (b > 0 && Number.isFinite(a) ? a / b : null);

export function dayRates(d) {
  return {
    ctr: ratio(d.clicks, d.impressions),
    lpvPerImpression: ratio(d.lpv, d.impressions),
    lpvPerClick: ratio(Math.min(d.lpv, d.clicks), d.clicks),
    costPerLpv: d.lpv > 0 ? d.spend / d.lpv : null,
    cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : null,
    cpc: ratio(d.spend, d.clicks),
  };
}

export function sumPeriod(rows) {
  const out = { impressions: 0, clicks: 0, lpv: 0, spend: 0, leads: 0 };
  for (const r of rows) for (const k of Object.keys(out)) out[k] += Number(r[k]) || 0;
  return out;
}

// Cost per landing page view, earlier vs later. With spend given, page views behave like Poisson counts, so the log of
// the cost ratio has standard error sqrt(1/n1 + 1/n2); `noise` is the change that would be needed to be significant.
export function costChange(spend1, lpv1, spend2, lpv2) {
  if (!(lpv1 > 0) || !(lpv2 > 0) || !(spend1 > 0) || !(spend2 > 0)) return null;
  const from = spend1 / lpv1;
  const to = spend2 / lpv2;
  const se = Math.sqrt(1 / lpv1 + 1 / lpv2);
  const z = Math.log(to / from) / se;
  return { from, to, change: to / from - 1, z, pValue: 2 * (1 - normalCdf(Math.abs(z))), noise: Math.exp(1.96 * se) - 1 };
}

export function comparePeriods(earlier, later, minChange = 0.1) {
  const cost = costChange(earlier.spend, earlier.lpv, later.spend, later.lpv);
  const er = dayRates(earlier);
  const lr = dayRates(later);
  let direction = 'not comparable';
  if (cost) direction = Math.abs(cost.change) < minChange ? 'steady' : cost.change < 0 ? 'cheaper' : 'costlier';
  return {
    earlier,
    later,
    earlierRates: er,
    laterRates: lr,
    cost,
    direction,
    significant: !!cost && cost.pValue < 0.05 && direction !== 'steady',
    // two-proportion tests: p1 = later, p2 = earlier
    ctr: twoProportion(later.clicks, later.impressions, earlier.clicks, earlier.impressions),
    lpvPerImpression: twoProportion(later.lpv, later.impressions, earlier.lpv, earlier.impressions),
    lpvPerClick: twoProportion(Math.min(later.lpv, later.clicks), later.clicks, Math.min(earlier.lpv, earlier.clicks), earlier.clicks),
    cpmChange: er.cpm && lr.cpm ? lr.cpm / er.cpm - 1 : null,
  };
}

const completeDays = (days, today) => days.filter((d) => d.day !== today && d.impressions > 0);

// Latest complete day against the complete day before it.
export function dayOverDay(days, today, minChange) {
  const complete = completeDays(days, today);
  if (complete.length < 2) return null;
  const [p, l] = complete.slice(-2);
  return { previousDay: p.day, latestDay: l.day, ...comparePeriods(p, l, minChange) };
}

// The last (up to) three complete days against the same number of days before them; smooths out daily noise.
export function recentTrend(days, today, minChange) {
  const complete = completeDays(days, today);
  if (complete.length < 4) return null;
  const k = Math.min(3, Math.floor(complete.length / 2));
  const recent = complete.slice(-k);
  const before = complete.slice(-2 * k, -k);
  return { recentDays: recent.map((d) => d.day), beforeDays: before.map((d) => d.day), ...comparePeriods(sumPeriod(before), sumPeriod(recent), minChange) };
}

// Today until the last complete hour against yesterday until the same hour (rows keyed by hour of day).
export function sameTimeYesterday(todayHours, yesterdayHours, nowHour, minChange) {
  const h = Math.floor(nowHour ?? 0);
  if (!(h > 0) || !todayHours?.length || !yesterdayHours?.length) return null;
  const today = sumPeriod(todayHours.filter((r) => r.key < h));
  const yesterday = sumPeriod(yesterdayHours.filter((r) => r.key < h));
  if (!(yesterday.impressions > 0) || !(today.impressions > 0)) return null;
  return { untilHour: h, ...comparePeriods(yesterday, today, minChange) };
}

// Website behaviour of Facebook/Instagram in-app visitors per day (all campaigns together).
export function siteDaily(visits, today) {
  const days = [...new Set(visits.map((v) => v.day))].sort();
  return days.map((day) => {
    const list = visits.filter((v) => v.day === day);
    return {
      day,
      partial: day === today,
      visits: list.length,
      pastHero: list.filter((v) => v.depth !== 'top').length,
      formOpened: list.filter((v) => v.formOpened).length,
      film: list.filter((v) => v.film).length,
      requestSent: list.filter((v) => v.requestSent).length,
    };
  });
}

function compareSite(earlier, later) {
  return {
    earlier,
    later,
    pastHero: twoProportion(later.pastHero, later.visits, earlier.pastHero, earlier.visits),
    formOpened: twoProportion(later.formOpened, later.visits, earlier.formOpened, earlier.visits),
  };
}

export function siteDayOverDay(rows) {
  const complete = rows.filter((r) => !r.partial && r.visits > 0);
  if (complete.length < 2) return null;
  const [p, l] = complete.slice(-2);
  return { previousDay: p.day, latestDay: l.day, ...compareSite(p, l) };
}

export function siteSameTime(visits, today, yesterday, nowHour) {
  const h = Math.floor(nowHour ?? 0);
  if (!(h > 0)) return null;
  const pick = (day) => {
    const list = visits.filter((v) => v.day === day && v.hour < h);
    return {
      visits: list.length,
      pastHero: list.filter((v) => v.depth !== 'top').length,
      formOpened: list.filter((v) => v.formOpened).length,
      requestSent: list.filter((v) => v.requestSent).length,
    };
  };
  const y = pick(yesterday);
  const t = pick(today);
  if (!y.visits || !t.visits) return null;
  return { untilHour: h, ...compareSite(y, t) };
}

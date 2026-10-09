// Cloudflare request helpers: agent classification, privacy-preserving visitor ids and visit summaries.

const META_CRAWLER = /facebookexternalhit|meta-externalagent|meta-externalfetcher|Facebot/i;
const DEV = /PowerShell|HeadlessChrome|\bnode\b|undici|Playwright|python|curl\/|wrangler|ad-funnel-analysis/i;
const BOT = /bot\b|bot\/|crawl|spider|preview|Google-|scan|monitor|uptime|lighthouse|pingdom|zgrab|httpx|go-http-client|java\/|okhttp|axios|wget|libwww/i;

export function classifyAgent(ua = '', verifiedBotCategory = '') {
  if (META_CRAWLER.test(ua)) return 'meta-crawler';
  if (DEV.test(ua)) return 'dev';
  if (verifiedBotCategory) return 'verified-bot';
  if (BOT.test(ua)) return 'bot';
  if (/Instagram/.test(ua)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB|FB4A|FBIOS/.test(ua)) return 'facebook';
  return /^Mozilla\//.test(ua) ? 'browser' : 'bot';
}

// IPv4 as is; IPv6 reduced to its /64 network (one household or phone), so the id never identifies a device.
export function ipId(ip) {
  if (!ip || !ip.includes(':')) return ip ?? '';
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = tail !== undefined ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return full.slice(0, 4).map((x) => x.padStart(4, '0')).join(':');
}

const count = (list, key) => list.reduce((m, v) => ((m[v[key]] = (m[v[key]] ?? 0) + 1), m), {});

export function summarizeVisits(visits, order = [], engagedDepth = 'gallery') {
  const deepFrom = order.indexOf(engagedDepth);
  const secs = visits.map((v) => v.seconds).sort((a, b) => a - b);
  return {
    visits: visits.length,
    byCountry: count(visits, 'country'),
    byDay: count(visits, 'day'),
    bySource: count(visits, 'source'),
    pastHero: visits.filter((v) => v.depth !== 'top').length,
    engagedDepth: deepFrom < 0 ? null : visits.filter((v) => order.indexOf(v.depth) >= deepFrom).length,
    formOpened: visits.filter((v) => v.formOpened).length,
    film: visits.filter((v) => v.film).length,
    requestSent: visits.filter((v) => v.requestSent).length,
    overOneMinute: visits.filter((v) => v.seconds > 60).length,
    medianSeconds: secs.length ? secs[Math.floor(secs.length / 2)] : null,
    sampled: visits.filter((v) => v.sampled).length,
  };
}

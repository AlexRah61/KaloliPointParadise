// Self-contained SVG charts (no libraries). Each chart has a <title> and <desc> for screen readers.
import { escapeHtml as esc, int, money, pct } from './format.mjs';

export const PALETTE = ['#1f6f8b', '#d1603d', '#3d405b', '#5b8e7d', '#c89f3c', '#7a5c99'];
const FONT = 'font-family="Segoe UI, Helvetica, Arial, sans-serif"';
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

function frame(id, width, height, title, desc, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="${id}-t ${id}-d" ${FONT} font-size="12">
<title id="${id}-t">${esc(title)}</title>
<desc id="${id}-d">${esc(desc)}</desc>
<rect width="${width}" height="${height}" fill="#ffffff"/>
<text x="16" y="24" font-size="15" font-weight="600" fill="#1d1d1f">${esc(title)}</text>
${body}
</svg>`;
}

function legend(campaigns, x, y) {
  return campaigns
    .map((c, i) => `<rect x="${x + i * 170}" y="${y - 9}" width="10" height="10" fill="${PALETTE[i % PALETTE.length]}"/><text x="${x + 14 + i * 170}" y="${y}" fill="#333">${esc(c.label)}</text>`)
    .join('');
}

// Funnel per campaign on a log scale so small late stages stay visible.
export function funnelChart(campaigns, stages) {
  const W = 760;
  const left = 150;
  const barMax = W - left - 150;
  const rowH = 14 * campaigns.length + 16;
  const H = 60 + stages.length * rowH + 30;
  const max = Math.max(1, ...campaigns.flatMap((c) => stages.map((s) => c.funnel[s.key] ?? 0)));
  const scale = (v) => (v > 0 ? Math.max(2, (Math.log10(v + 1) / Math.log10(max + 1)) * barMax) : 0);
  let body = legend(campaigns, left, 46);
  stages.forEach((s, si) => {
    const y0 = 60 + si * rowH;
    body += `<text x="${left - 8}" y="${y0 + rowH / 2}" text-anchor="end" fill="#333">${esc(s.label)}</text>`;
    campaigns.forEach((c, ci) => {
      const v = c.funnel[s.key];
      // Stages are not strictly nested (the form can be reached without the tour button), so each step rate is
      // taken against the nearest earlier stage that is at least as large.
      const ref = stages.slice(0, si).reverse().find((x) => (c.funnel[x.key] ?? 0) >= (v ?? 0) && (c.funnel[x.key] ?? 0) > 0);
      const y = y0 + 4 + ci * 14;
      const w = v === null || v === undefined ? 0 : scale(v);
      const step = si && ref && v !== null && v !== undefined ? ` (${pct(v / c.funnel[ref.key])} of ${lowerFirst(ref.label)})` : '';
      body += `<rect x="${left}" y="${y}" width="${w.toFixed(1)}" height="11" fill="${PALETTE[ci % PALETTE.length]}"/>`;
      body += `<text x="${left + w + 6}" y="${y + 10}" fill="#333">${v === null || v === undefined ? 'not collected' : int(v)}${esc(step)}</text>`;
    });
  });
  body += `<text x="${left}" y="${H - 10}" fill="#666" font-size="11">Bar length uses a log scale so later stages stay visible; labels show exact counts.</text>`;
  const desc = campaigns.map((c) => `${c.label}: ${stages.map((s) => `${s.label} ${c.funnel[s.key] ?? 'n/a'}`).join(', ')}`).join('. ');
  return frame('funnel', W, H, 'Funnel by campaign: from impression to tour request', desc, body);
}

// Landing page views per day, grouped by campaign.
export function dailyChart(campaigns, days) {
  const W = 760;
  const H = 260;
  const left = 50;
  const plotW = W - left - 20;
  const plotH = 160;
  const top = 50;
  const max = Math.max(1, ...campaigns.flatMap((c) => c.meta.days.map((d) => d.lpv)));
  const groupW = plotW / Math.max(1, days.length);
  const barW = Math.min(28, (groupW - 8) / Math.max(1, campaigns.length));
  let body = legend(campaigns, left, 40);
  body += `<line x1="${left}" y1="${top + plotH}" x2="${W - 20}" y2="${top + plotH}" stroke="#999"/>`;
  for (const t of [0, 0.5, 1]) {
    const y = top + plotH - t * plotH;
    body += `<text x="${left - 6}" y="${y + 4}" text-anchor="end" fill="#666" font-size="11">${int(max * t)}</text><line x1="${left}" y1="${y}" x2="${W - 20}" y2="${y}" stroke="#eee"/>`;
  }
  days.forEach((d, di) => {
    const gx = left + di * groupW + (groupW - barW * campaigns.length) / 2;
    campaigns.forEach((c, ci) => {
      const v = c.meta.days.find((x) => x.key === d)?.lpv ?? 0;
      const h = (v / max) * plotH;
      body += `<rect x="${(gx + ci * barW).toFixed(1)}" y="${(top + plotH - h).toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${PALETTE[ci % PALETTE.length]}"/>`;
      if (v) body += `<text x="${(gx + ci * barW + barW / 2 - 1).toFixed(1)}" y="${(top + plotH - h - 3).toFixed(1)}" text-anchor="middle" fill="#333" font-size="10">${int(v)}</text>`;
    });
    body += `<text x="${(left + di * groupW + groupW / 2).toFixed(1)}" y="${top + plotH + 16}" text-anchor="middle" fill="#333" font-size="11">${esc(d.slice(5))}</text>`;
  });
  const desc = campaigns.map((c) => `${c.label}: ${c.meta.days.map((d) => `${d.key} ${d.lpv}`).join(', ')}`).join('. ');
  return frame('daily', W, H, 'Landing page views per day (ad account time zone)', desc, body);
}

// Share of spend by country, per campaign, for the window and for today.
export function countryChart(campaigns) {
  const W = 760;
  const rows = campaigns.flatMap((c) => [
    { label: `${c.label}`, sub: 'window', list: c.meta.countries },
    ...(c.meta.countriesToday?.length ? [{ label: `${c.label}`, sub: 'today', list: c.meta.countriesToday }] : []),
  ]);
  const H = 70 + rows.length * 30;
  const left = 200;
  const barW = W - left - 30;
  const countries = [...new Set(rows.flatMap((r) => r.list.map((x) => x.key)))];
  const color = (k) => PALETTE[countries.indexOf(k) % PALETTE.length];
  let body = countries.map((k, i) => `<rect x="${left + i * 90}" y="37" width="10" height="10" fill="${color(k)}"/><text x="${left + 14 + i * 90}" y="46" fill="#333">${esc(k)}</text>`).join('');
  rows.forEach((r, ri) => {
    const y = 60 + ri * 30;
    const total = r.list.reduce((s, x) => s + x.spend, 0);
    body += `<text x="${left - 8}" y="${y + 14}" text-anchor="end" fill="#333">${esc(r.label)} (${r.sub})</text>`;
    let x = left;
    for (const item of r.list) {
      const w = total ? (item.spend / total) * barW : 0;
      body += `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="20" fill="${color(item.key)}"/>`;
      if (w > 46) body += `<text x="${(x + w / 2).toFixed(1)}" y="${y + 14}" text-anchor="middle" fill="#fff" font-size="11">${esc(item.key)} ${pct(item.spend / total, 0)}</text>`;
      x += w;
    }
  });
  const desc = rows.map((r) => `${r.label} ${r.sub}: ${r.list.map((x) => `${x.key} ${money(x.spend)}`).join(', ')}`).join('. ');
  return frame('country', W, H, 'Where the budget went: share of spend by country', desc, body);
}

// Today's link clicks by hour per campaign, plus Facebook/Instagram in-app visits seen by the website.
export function hourlyChart(campaigns, siteHours, nowHour) {
  const W = 760;
  const H = 250;
  const left = 40;
  const top = 50;
  const plotW = W - left - 20;
  const plotH = 150;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const max = Math.max(1, ...campaigns.flatMap((c) => c.meta.hours.map((h) => h.clicks)), ...(siteHours ?? []));
  const gw = plotW / 24;
  const bw = Math.max(2, (gw - 4) / Math.max(1, campaigns.length));
  let body = legend(campaigns, left, 40);
  if (siteHours) body += `<line x1="${left + campaigns.length * 170}" y1="36" x2="${left + campaigns.length * 170 + 16}" y2="36" stroke="#111" stroke-dasharray="3 2"/><text x="${left + campaigns.length * 170 + 20}" y="40" fill="#333">in-app visits (website)</text>`;
  body += `<line x1="${left}" y1="${top + plotH}" x2="${W - 20}" y2="${top + plotH}" stroke="#999"/>`;
  hours.forEach((h) => {
    campaigns.forEach((c, ci) => {
      const v = c.meta.hours.find((x) => x.key === h)?.clicks ?? 0;
      const bh = (v / max) * plotH;
      body += `<rect x="${(left + h * gw + 2 + ci * bw).toFixed(1)}" y="${(top + plotH - bh).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${bh.toFixed(1)}" fill="${PALETTE[ci % PALETTE.length]}"/>`;
    });
    if (h % 3 === 0) body += `<text x="${(left + h * gw + gw / 2).toFixed(1)}" y="${top + plotH + 14}" text-anchor="middle" fill="#666" font-size="10">${h}:00</text>`;
  });
  if (siteHours) {
    const pts = siteHours.map((v, h) => `${(left + h * gw + gw / 2).toFixed(1)},${(top + plotH - (v / max) * plotH).toFixed(1)}`).slice(0, nowHour + 1);
    body += `<polyline points="${pts.join(' ')}" fill="none" stroke="#111" stroke-width="1.5" stroke-dasharray="3 2"/>`;
  }
  body += `<text x="${left}" y="${H - 10}" fill="#666" font-size="11">Link clicks per hour today (ad account time zone). Max ${int(max)}.</text>`;
  const desc = campaigns.map((c) => `${c.label}: ${c.meta.hours.map((h) => `${h.key}:00 ${h.clicks}`).join(', ')}`).join('. ');
  return frame('hourly', W, H, 'Today by hour: link clicks and in-app visits', desc, body);
}

// Key rates side by side with benchmark markers.
export function ratesChart(campaigns, benchmarks) {
  const metrics = [
    { key: 'ctr', label: 'Link CTR', bench: benchmarks.linkCtr.good, max: 0.05 },
    { key: 'lpvPerClick', label: 'Clicks that load the page', bench: benchmarks.lpvPerClick.poor, max: 1 },
    { key: 'engagementRate', label: 'Engaged visits (GA4)', bench: benchmarks.engagementRate.poor, max: 1 },
    { key: 'ctaRate', label: 'Tour-button clicks per visit', bench: null, max: null },
  ];
  const W = 760;
  const left = 200;
  const barMax = W - left - 120;
  const rowH = 14 * campaigns.length + 18;
  const H = 60 + metrics.length * rowH + 20;
  let body = legend(campaigns, left, 46);
  metrics.forEach((m, mi) => {
    const y0 = 60 + mi * rowH;
    const values = campaigns.map((c) => c.rates[m.key]);
    const max = m.max ?? Math.max(0.01, ...values.filter((v) => v !== null)) * 1.2;
    body += `<text x="${left - 8}" y="${y0 + rowH / 2}" text-anchor="end" fill="#333">${esc(m.label)}</text>`;
    if (m.bench !== null) {
      const bx = left + Math.min(1, m.bench / max) * barMax;
      body += `<line x1="${bx.toFixed(1)}" y1="${y0}" x2="${bx.toFixed(1)}" y2="${y0 + rowH - 6}" stroke="#111" stroke-dasharray="2 2"/>`;
    }
    campaigns.forEach((c, ci) => {
      const v = c.rates[m.key];
      const w = v === null ? 0 : Math.min(1, v / max) * barMax;
      const y = y0 + 4 + ci * 14;
      body += `<rect x="${left}" y="${y}" width="${w.toFixed(1)}" height="11" fill="${PALETTE[ci % PALETTE.length]}"/><text x="${left + w + 6}" y="${y + 10}" fill="#333" stroke="#fff" stroke-width="3" paint-order="stroke">${pct(v)}</text>`;
    });
  });
  body += `<text x="${left}" y="${H - 8}" fill="#666" font-size="11">Dashed line: benchmark (good CTR; minimum healthy page-load and engagement rates).</text>`;
  const desc = campaigns.map((c) => `${c.label}: ${metrics.map((m) => `${m.label} ${pct(c.rates[m.key])}`).join(', ')}`).join('. ');
  return frame('rates', W, H, 'Key rates by campaign', desc, body);
}

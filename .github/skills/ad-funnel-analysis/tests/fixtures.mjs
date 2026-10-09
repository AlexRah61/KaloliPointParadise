// Synthetic fixtures shaped like the real inputs (GA4 accessible text, Meta CSV exports). No real IDs or personal data.

const GA4_METRICS = (eventName) => [
  'Sessions',
  'Engaged sessions',
  'Engagement rate',
  'Average engagement time per session',
  'Events per session',
  `Event count ${eventName}`,
  'Key events showing_request_submitted',
  'Session key event rate showing_request_submitted',
  'Total revenue',
];

// rows: [{ name, sessions, engaged, seconds, events, keyEvents, checkbox? }]
export function ga4Text(dimension, rows, eventName = 'showing_cta_click') {
  const headers = ['Index', dimension, ...GA4_METRICS(eventName)];
  const total = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
  const sessions = total('sessions');
  const time = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`);
  const lines = [
    '      [text] Rows per page:',
    '        [combo box] Rows per page: 10',
    `      [text] 1-${rows.length} of ${rows.length}`,
    '      [data grid] Report data.',
    `        [row] selection column Checkbox for deselecting all rows ${headers.join(' ')}`,
    '          [column header] selection column Checkbox for deselecting all rows',
    '                [check box] Checkbox for deselecting all rows',
    ...headers.map((h) => `          [column header] ${h}`),
    '        [row] Checkbox for total row Empty Summary Totals cell for Total',
    '          [column header] Checkbox for total row Empty Summary Totals cell for',
    '          [column header] Empty Summary Totals cell for Index column',
    '          [column header] Total',
    `          [column header] ${sessions} 100% of total`,
    `          [column header] ${total('engaged')} 100% of total`,
    `          [column header] ${sessions ? ((total('engaged') / sessions) * 100).toFixed(1) : 0}% Avg 0%`,
    '          [column header] 30s Avg 0%',
    '          [column header] 4.00 Avg 0%',
    `          [column header] ${total('events')} 3.21% of total`,
    `          [column header] ${total('keyEvents').toFixed(2)} 100% of total`,
    '          [column header] 1.00% Avg 0%',
    '          [column header] Empty Summary Totals cell for Total revenue column $0.00',
  ];
  rows.forEach((r, i) => {
    const n = i + 1;
    const share = (v, all) => `${v} (${all ? ((v / all) * 100).toFixed(2) : 0}%)`;
    lines.push(`        [row] ${r.checkbox === false ? '' : `Checkbox for selecting row ${n} `}${n} ${r.name}`);
    if (r.checkbox !== false) {
      lines.push(`          [item] Checkbox for selecting row ${n}`, `                [check box] Checkbox for selecting row ${n}`);
    }
    lines.push(`          [item] ${n}`);
    if (r.name !== '') lines.push(`          [item] ${r.name}${r.warning ? ' Warning. Get more information about this value' : ''}`);
    if (r.warning) lines.push('            [button] Warning. Get more information about this value');
    lines.push(
      `          [item] ${share(r.sessions, sessions)}`,
      `          [item] ${share(r.engaged, total('engaged'))}`,
      `          [item] ${r.sessions ? ((r.engaged / r.sessions) * 100).toFixed(2) : 0}%`,
      `          [item] ${time(r.seconds ?? 0)}`,
      '          [item] 4.00',
      `          [item] ${share(r.events ?? 0, total('events'))}`,
      `          [item] ${(r.keyEvents ?? 0).toFixed(2)} (0%)`,
      '          [item] 0%',
      '          [item] $0.00 (–)',
    );
  });
  return lines;
}

export function metaCsv(header, rows) {
  const q = (v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return `\uFEFF${header.map(q).join(',')}\r\n${rows.map((r) => r.map(q).join(',')).join('\r\n')}\r\n`;
}

export const DAILY_HEADER = ['Campaign name', 'Ad set name', 'Ad name', 'Day', 'Reach', 'Impressions', 'Link clicks', 'Website landing page views', 'Website leads', 'Amount spent (USD)', 'Reporting starts', 'Reporting ends'];
export const COUNTRY_HEADER = ['Campaign name', 'Country', 'Reach', 'Impressions', 'Link clicks', 'Website landing page views', 'Amount spent (USD)', 'Reporting starts', 'Reporting ends'];
export const HOURLY_HEADER = ['Campaign name', 'Time of day (ad account time zone)', 'Impressions', 'Link clicks', 'Website landing page views', 'Amount spent (USD)', 'Reporting starts', 'Reporting ends'];

export const ADS_TABLE = [
  '              [column header] Ad open sorting options dropdown menu',
  '              [column header] URL parameters open sorting options dropdown menu',
  '            [link] Customize columns…',
  '          [switch] On/off',
  '          [text] Video A ad',
  '          [link] Edit column',
  '          [text] Set A',
  '          [link] Set A',
  '          [text] Active',
  '          [text] utm_source=meta&utm_medium=paid_social&utm_campaign=shared_tag&utm_content=a',
  '          [text] https://example.com/',
  '          [switch] On/off',
  '          [text] Video B ad',
  '          [link] Edit column',
  '          [text] Set B',
  '          [link] Set B',
  '          [text] Learning',
  '          [text] utm_source=meta&utm_medium=paid_social&utm_campaign=video_b_tag&utm_content=b',
  '          [text] https://example.com/',
  '          [text] Results from 2 ads',
];

export const EXPERIMENT = [
  '        [heading] Result overview',
  '        [text] Test in progress',
  '        [text] A',
  '        [link] Campaign A',
  '        [text] $0.03',
  '        [text] B',
  '        [link] Campaign B',
  '        [text] $0.02',
  '        [text] Duration:',
  '        [text] ',
  '        [text] Jan 1, 2026, 12:00 AM – Jan 7, 2026, 12:00 AM',
  '        [text] Total amount spent:',
  '        [text] $9.50',
  '        [text] Key metric:',
  '        [text] Cost per post engagement',
  '        [text] Objective',
  '        [text] :',
  '        [text] Traffic',
];

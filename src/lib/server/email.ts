import { property, SITE_URL } from '../../data/property';
import { slotLabel, TOUR_LABEL } from '../showing-shared';
import type { LeadRecord } from './leads';

export interface EmailMessage {
  from: string;
  to: string[];
  cc?: string[];
  reply_to?: string[];
  subject: string;
  html: string;
  text: string;
  tags?: { name: string; value: string }[];
}

export interface SendResult {
  id?: string;
  error?: string;
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Header-safe single line (no CR/LF injection, bounded length).
const headerSafe = (v: string, max = 80): string => v.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);

export async function sendEmail(env: Env, msg: EmailMessage, idempotencyKey: string): Promise<SendResult> {
  const mode = (env.EMAIL_MODE ?? 'send').trim().toLowerCase();
  if (mode === 'log') {
    console.log(`[email:log] ${msg.subject} -> ${msg.to.join(', ')}${msg.cc?.length ? ` cc ${msg.cc.join(', ')}` : ''}`);
    return { id: `log-${crypto.randomUUID()}` };
  }
  if (mode === 'fail') return { error: 'Simulated provider failure (EMAIL_MODE=fail)' };
  if (mode !== 'send') return { error: `Unsupported EMAIL_MODE "${mode}" (use send, log or fail)` };
  if (!env.RESEND_API_KEY) return { error: 'RESEND_API_KEY is not configured' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ ...msg, cc: msg.cc?.length ? msg.cc : undefined }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok || !data.id) return { error: `Resend ${res.status}: ${data.message ?? data.name ?? 'unknown error'}`.slice(0, 300) };
    return { id: data.id };
  } catch (err) {
    return { error: `Resend request failed: ${(err as Error).message}`.slice(0, 300) };
  }
}

const hstStamp = (iso: string): string =>
  `${new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Honolulu',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))} HST`;

const ATTR_KEYS = ['cta_origin', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ttclid', 'referrer', 'landing_page'] as const;

function shell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f0e7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f0e7;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fffdf8;border:1px solid #ddd6c8;">
<tr><td style="padding:22px 28px;background:#151815;color:#c6a77b;font:600 11px/1.4 Helvetica,Arial,sans-serif;letter-spacing:3px;text-transform:uppercase;">${esc(property.address.streetDisplay)} · ${esc(property.address.neighborhood)}</td></tr>
<tr><td style="padding:28px;font:15px/1.6 Helvetica,Arial,sans-serif;color:#242722;">${inner}</td></tr>
</table></td></tr></table></body></html>`;
}

const row = (k: string, v: string): string =>
  `<tr><td style="padding:6px 12px 6px 0;color:#55614f;font:13px/1.5 Helvetica,Arial,sans-serif;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:6px 0;color:#151815;font:14px/1.5 Helvetica,Arial,sans-serif;vertical-align:top;">${v}</td></tr>`;

const heading = (t: string): string =>
  `<p style="margin:26px 0 8px;font:600 11px/1.4 Helvetica,Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;color:#7d5f3a;">${esc(t)}</p>`;

// Facts Meta's lead form adds (stored as JSON in source_details).
interface MetaLeadDetails {
  lead_id?: string;
  created_time?: string;
  campaign_name?: string;
  adset_name?: string;
  ad_name?: string;
  form_name?: string;
  platform?: string;
  is_organic?: string;
  answers?: Record<string, string>;
}

const PLATFORMS: Record<string, string> = { fb: 'Facebook', ig: 'Instagram', an: 'Audience Network', msg: 'Messenger', wa: 'WhatsApp' };

export function metaDetails(lead: LeadRecord): MetaLeadDetails {
  if (lead.source !== 'meta_lead_form' || !lead.source_details) return {};
  try {
    return JSON.parse(lead.source_details) as MetaLeadDetails;
  } catch {
    return {};
  }
}

const stampOrRaw = (v: string): string => (Number.isNaN(Date.parse(v)) ? v : hstStamp(v));

export function agentEmail(env: Env, lead: LeadRecord): EmailMessage {
  const fromMeta = lead.source === 'meta_lead_form';
  const m = metaDetails(lead);
  const platform = PLATFORMS[(m.platform ?? '').toLowerCase()] ?? 'Facebook or Instagram';
  const testPrefix = lead.is_test ? '[TEST] ' : '';
  const preferred = slotLabel(lead.preferred_date, lead.preferred_time);
  const alternate = slotLabel(lead.alternate_date, lead.alternate_time);
  const tour = TOUR_LABEL[lead.tour_type];
  const toAgent = lead.is_test ? [env.LEAD_CC_EMAIL] : [env.LEAD_TO_EMAIL];
  const cc = !lead.is_test && env.LEAD_CC_EMAIL && env.LEAD_CC_EMAIL !== env.LEAD_TO_EMAIL ? [env.LEAD_CC_EMAIL] : [];
  const phone = lead.phone.trim();
  const telHref = `tel:${phone.replace(/[^\d+]/g, '')}`;
  const answers = Object.entries(m.answers ?? {});

  const banner = fromMeta ? 'Meta lead form — not a booked showing' : 'Showing request — not confirmed';
  const intro = fromMeta
    ? `This person filled in the lead form of one of our ${platform} ads${m.campaign_name ? ` (campaign “${m.campaign_name}”)` : ''}. Please contact them to arrange a private or virtual tour. No appointment has been booked.`
    : 'Please contact the prospect directly to arrange a time. No appointment has been booked.';

  const requestRows = fromMeta
    ? [
        row('Platform', esc(platform)),
        row('Campaign', esc(m.campaign_name || '—')),
        row('Ad set', esc(m.adset_name || '—')),
        row('Ad', esc(m.ad_name || '—')),
        row('Form', esc(m.form_name || '—')),
        row('Submitted on Meta', esc(m.created_time ? stampOrRaw(m.created_time) : '—')),
        row('Meta lead ID', esc(m.lead_id || lead.external_id || '—')),
        ...answers.map(([q, a]) => row(q, esc(a))),
      ]
    : [
        row('Showing type', esc(tour)),
        ...(preferred ? [row('Preferred', esc(preferred))] : []),
        ...(alternate ? [row('Alternative', esc(alternate))] : []),
        ...(lead.flexible ? [row('Flexible', 'Yes — any time that suits the agent')] : []),
        row('Message', lead.message ? esc(lead.message).replace(/\n/g, '<br>') : '—'),
      ];

  const html = shell(
    fromMeta ? 'New Meta lead' : 'New showing request',
    `<div style="padding:14px 16px;background:#30473a;color:#fffdf8;font:700 13px/1.5 Helvetica,Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;">${esc(banner)}</div>
<p style="margin:16px 0 0;">${esc(intro)}</p>
${lead.is_test ? '<p style="margin:12px 0 0;padding:10px 12px;background:#fbf1ee;color:#7a2216;font-size:13px;">TEST SUBMISSION — routed to the test recipient only.</p>' : ''}
${heading('Prospect')}
<table role="presentation" cellpadding="0" cellspacing="0">
${row('Name', esc(lead.name))}
${row('Phone', phone ? `<a href="${esc(telHref)}" style="color:#30473a;">${esc(phone)}</a>` : 'Not provided')}
${row('Email', lead.email ? `<a href="mailto:${esc(lead.email)}" style="color:#30473a;">${esc(lead.email)}</a>` : 'Not provided')}
</table>
${heading(fromMeta ? 'Lead form' : 'Requested showing')}
<table role="presentation" cellpadding="0" cellspacing="0">
${requestRows.join('\n')}
</table>
${heading('Lead')}
<table role="presentation" cellpadding="0" cellspacing="0">
${row('Lead ID', esc(lead.id))}
${row(fromMeta ? 'Received' : 'Submitted', esc(hstStamp(lead.created_at)))}
${row('Property', `${esc(property.address.full)} · MLS ${esc(property.mls)}`)}
</table>
${
  fromMeta
    ? ''
    : `${heading('Marketing attribution')}
<table role="presentation" cellpadding="0" cellspacing="0">
${ATTR_KEYS.map((k) => row(k, esc(lead[k] ?? '—') || '—')).join('\n')}
</table>`
}
<p style="margin:26px 0 0;font-size:12px;color:#55614f;">Sent by the property website ${esc(SITE_URL.replace('https://', ''))}.${lead.email ? ' Reply to this email to reach the prospect.' : ''}</p>`,
  );

  const requestText = fromMeta
    ? [
        `Platform: ${platform}`,
        `Campaign: ${m.campaign_name || '—'}`,
        `Ad set: ${m.adset_name || '—'}`,
        `Ad: ${m.ad_name || '—'}`,
        `Form: ${m.form_name || '—'}`,
        `Submitted on Meta: ${m.created_time ? stampOrRaw(m.created_time) : '—'}`,
        `Meta lead ID: ${m.lead_id || lead.external_id || '—'}`,
        ...answers.map(([q, a]) => `${q}: ${a}`),
      ]
    : [
        `Showing type: ${tour}`,
        preferred ? `Preferred: ${preferred}` : '',
        alternate ? `Alternative: ${alternate}` : '',
        lead.flexible ? 'Flexible: Yes' : '',
        `Message: ${lead.message ?? '—'}`,
      ].filter(Boolean);

  const text = [
    banner.toUpperCase(),
    intro,
    lead.is_test ? 'TEST SUBMISSION — routed to the test recipient only.' : '',
    '',
    `Name: ${lead.name}`,
    `Phone: ${phone || 'Not provided'}`,
    `Email: ${lead.email || 'Not provided'}`,
    '',
    ...requestText,
    '',
    `Lead ID: ${lead.id}`,
    `${fromMeta ? 'Received' : 'Submitted'}: ${hstStamp(lead.created_at)}`,
    `Property: ${property.address.full} · MLS ${property.mls}`,
    ...(fromMeta ? [] : ['', 'Marketing attribution', ...ATTR_KEYS.map((k) => `${k}: ${lead[k] ?? '—'}`)]),
  ]
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n');

  return {
    from: env.LEAD_FROM_EMAIL,
    to: toAgent,
    cc,
    reply_to: lead.email ? [lead.email] : undefined,
    subject: `${testPrefix}${fromMeta ? 'New Meta Lead' : 'New Showing Request'} — ${property.address.streetDisplay} — ${headerSafe(lead.name)}`,
    html,
    text,
    tags: [{ name: 'type', value: fromMeta ? 'meta_lead_notification' : 'agent_notification' }],
  };
}

export function visitorEmail(env: Env, lead: LeadRecord): EmailMessage {
  const a = property.agent;
  const first = headerSafe(lead.name.split(/\s+/)[0] ?? '', 40);
  const preferred = slotLabel(lead.preferred_date, lead.preferred_time);
  const alternate = slotLabel(lead.alternate_date, lead.alternate_time);
  const replyTo = lead.is_test ? env.LEAD_CC_EMAIL : env.LEAD_TO_EMAIL;
  const kind = lead.tour_type === 'video' ? 'live video tour' : 'private showing';

  const html = shell(
    'Showing request received',
    `<p style="margin:0 0 14px;font:400 30px/1.15 Georgia,'Times New Roman',serif;color:#151815;">Thank you${first ? `, ${esc(first)}` : ''}.</p>
<p style="margin:0 0 12px;">We received your request for a ${kind} of ${esc(property.address.streetDisplay)} in ${esc(property.address.neighborhood)}.</p>
<p style="margin:0 0 12px;">The listing agent, ${esc(a.name)} of ${esc(a.brokerage)}, will contact you to arrange a time.</p>
<div style="margin:18px 0;padding:14px 16px;background:#151815;color:#fffdf8;font:700 12px/1.5 Helvetica,Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;">Your showing is not confirmed until the listing agent speaks with you.</div>
${heading('Your request')}
<table role="presentation" cellpadding="0" cellspacing="0">
${preferred ? row('Requested', esc(preferred)) : ''}
${alternate ? row('Alternative', esc(alternate)) : ''}
${row('Showing type', esc(TOUR_LABEL[lead.tour_type]))}
${lead.flexible ? row('Flexible', 'Yes') : ''}
${row('Reference', esc(lead.id))}
</table>
${heading('Listing agent')}
<p style="margin:0;">${esc(a.name)} · ${esc(a.title)}, ${esc(a.brokerage)}<br>
<a href="${esc(a.phoneHref)}" style="color:#30473a;">${esc(a.phone)}</a> · <a href="mailto:${esc(a.email)}" style="color:#30473a;">${esc(a.email)}</a></p>
<p style="margin:22px 0 0;"><a href="${esc(SITE_URL)}/" style="color:#30473a;">View the property website</a></p>
<p style="margin:26px 0 0;font-size:12px;color:#55614f;">You received this email because a showing was requested at ${esc(SITE_URL.replace('https://', ''))}. This is an independent property website, not the MLS. If you did not make this request, you can ignore this email.</p>`,
  );

  const text = [
    `Thank you${first ? `, ${first}` : ''}.`,
    '',
    `We received your request for a ${kind} of ${property.address.streetDisplay} in ${property.address.neighborhood}.`,
    `The listing agent, ${a.name} of ${a.brokerage}, will contact you to arrange a time.`,
    '',
    'YOUR SHOWING IS NOT CONFIRMED UNTIL THE LISTING AGENT SPEAKS WITH YOU.',
    '',
    preferred ? `Requested: ${preferred}` : '',
    alternate ? `Alternative: ${alternate}` : '',
    `Showing type: ${TOUR_LABEL[lead.tour_type]}`,
    `Reference: ${lead.id}`,
    '',
    `Listing agent: ${a.name}, ${a.phone}, ${a.email}`,
    `${SITE_URL}/`,
  ]
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n');

  return {
    from: env.LEAD_FROM_EMAIL,
    to: [lead.email],
    reply_to: [replyTo],
    subject: `Showing request received — ${property.address.streetDisplay}`,
    html,
    text,
    tags: [{ name: 'type', value: 'visitor_acknowledgement' }],
  };
}

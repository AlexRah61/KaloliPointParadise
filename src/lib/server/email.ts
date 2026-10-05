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

export function agentEmail(env: Env, lead: LeadRecord): EmailMessage {
  const testPrefix = lead.is_test ? '[TEST] ' : '';
  const preferred = slotLabel(lead.preferred_date, lead.preferred_time);
  const alternate = slotLabel(lead.alternate_date, lead.alternate_time) || '—';
  const tour = TOUR_LABEL[lead.tour_type];
  const toAgent = lead.is_test ? [env.LEAD_CC_EMAIL] : [env.LEAD_TO_EMAIL];
  const cc = !lead.is_test && env.LEAD_CC_EMAIL && env.LEAD_CC_EMAIL !== env.LEAD_TO_EMAIL ? [env.LEAD_CC_EMAIL] : [];
  const telHref = `tel:${lead.phone.replace(/[^\d+]/g, '')}`;

  const html = shell(
    'New showing request',
    `<div style="padding:14px 16px;background:#30473a;color:#fffdf8;font:700 13px/1.5 Helvetica,Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;">Showing request — not confirmed</div>
<p style="margin:16px 0 0;">Please contact the prospect directly by phone to confirm availability. No appointment has been booked.</p>
${lead.is_test ? '<p style="margin:12px 0 0;padding:10px 12px;background:#fbf1ee;color:#7a2216;font-size:13px;">TEST SUBMISSION — routed to the test recipient only.</p>' : ''}
${heading('Prospect')}
<table role="presentation" cellpadding="0" cellspacing="0">
${row('Name', esc(lead.name))}
${row('Phone', `<a href="${esc(telHref)}" style="color:#30473a;">${esc(lead.phone)}</a>`)}
${row('Email', `<a href="mailto:${esc(lead.email)}" style="color:#30473a;">${esc(lead.email)}</a>`)}
</table>
${heading('Requested showing')}
<table role="presentation" cellpadding="0" cellspacing="0">
${row('Preferred', esc(preferred))}
${row('Alternative', esc(alternate))}
${row('Flexible', lead.flexible ? 'Yes — any time that suits the agent' : 'No')}
${row('Showing type', esc(tour))}
${row('Message', lead.message ? esc(lead.message).replace(/\n/g, '<br>') : '—')}
</table>
${heading('Lead')}
<table role="presentation" cellpadding="0" cellspacing="0">
${row('Lead ID', esc(lead.id))}
${row('Submitted', esc(hstStamp(lead.created_at)))}
${row('Property', `${esc(property.address.full)} · MLS ${esc(property.mls)}`)}
</table>
${heading('Marketing attribution')}
<table role="presentation" cellpadding="0" cellspacing="0">
${ATTR_KEYS.map((k) => row(k, esc(lead[k] ?? '—') || '—')).join('\n')}
</table>
<p style="margin:26px 0 0;font-size:12px;color:#55614f;">Sent by the property website ${esc(SITE_URL.replace('https://', ''))}. Reply to this email to reach the prospect.</p>`,
  );

  const text = [
    'SHOWING REQUEST — NOT CONFIRMED',
    'Please contact the prospect directly by phone to confirm availability.',
    lead.is_test ? 'TEST SUBMISSION — routed to the test recipient only.' : '',
    '',
    `Name: ${lead.name}`,
    `Phone: ${lead.phone}`,
    `Email: ${lead.email}`,
    '',
    `Preferred: ${preferred}`,
    `Alternative: ${alternate}`,
    `Flexible: ${lead.flexible ? 'Yes' : 'No'}`,
    `Showing type: ${tour}`,
    `Message: ${lead.message ?? '—'}`,
    '',
    `Lead ID: ${lead.id}`,
    `Submitted: ${hstStamp(lead.created_at)}`,
    `Property: ${property.address.full} · MLS ${property.mls}`,
    '',
    'Marketing attribution',
    ...ATTR_KEYS.map((k) => `${k}: ${lead[k] ?? '—'}`),
  ]
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n');

  return {
    from: env.LEAD_FROM_EMAIL,
    to: toAgent,
    cc,
    reply_to: [lead.email],
    subject: `${testPrefix}New Showing Request — ${property.address.streetDisplay} — ${headerSafe(lead.name)}`,
    html,
    text,
    tags: [{ name: 'type', value: 'agent_notification' }],
  };
}

export function visitorEmail(env: Env, lead: LeadRecord): EmailMessage {
  const a = property.agent;
  const first = headerSafe(lead.name.split(/\s+/)[0] ?? '', 40);
  const preferred = slotLabel(lead.preferred_date, lead.preferred_time);
  const alternate = slotLabel(lead.alternate_date, lead.alternate_time);
  const replyTo = lead.is_test ? env.LEAD_CC_EMAIL : env.LEAD_TO_EMAIL;

  const html = shell(
    'Showing request received',
    `<p style="margin:0 0 14px;font:400 30px/1.15 Georgia,'Times New Roman',serif;color:#151815;">Thank you${first ? `, ${esc(first)}` : ''}.</p>
<p style="margin:0 0 12px;">We received your request for a private showing of ${esc(property.address.streetDisplay)} in ${esc(property.address.neighborhood)}.</p>
<p style="margin:0 0 12px;">The listing agent, ${esc(a.name)} of ${esc(a.brokerage)}, will contact you to confirm availability.</p>
<div style="margin:18px 0;padding:14px 16px;background:#151815;color:#fffdf8;font:700 12px/1.5 Helvetica,Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;">Your showing is not confirmed until the listing agent speaks with you.</div>
${heading('Your request')}
<table role="presentation" cellpadding="0" cellspacing="0">
${row('Requested', esc(preferred))}
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
    `We received your request for a private showing of ${property.address.streetDisplay} in ${property.address.neighborhood}.`,
    `The listing agent, ${a.name} of ${a.brokerage}, will contact you to confirm availability.`,
    '',
    'YOUR SHOWING IS NOT CONFIRMED UNTIL THE LISTING AGENT SPEAKS WITH YOU.',
    '',
    `Requested: ${preferred}`,
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

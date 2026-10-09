// Meta Conversions API: the server sends the same Lead the browser pixel sends, with the same event_id so Meta counts
// it once. It still arrives when the pixel is blocked (ad blockers, in-app browsers, iOS tracking limits).
import type { LeadRecord } from './leads';

const GRAPH = 'https://graph.facebook.com/v25.0';

export interface CapiContext {
  eventId: string;
  pageUrl: string | null;
  ip: string | null;
  userAgent: string | null;
  cookies: string | null;
}

async function sha256(v: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim().slice(0, 500) || undefined;
  }
  return undefined;
}

// Digits with the country code; a ten-digit number is taken as US.
export function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.length === 10 ? `1${d}` : d;
}

const nameKey = (v: string): string => v.toLowerCase().replace(/[^\p{L}]/gu, '');

export async function sendCapiLead(env: Env, lead: LeadRecord, ctx: CapiContext): Promise<void> {
  const pixelId: string = import.meta.env.PUBLIC_META_PIXEL_ID ?? '';
  const token = env.META_CAPI_TOKEN;
  if (!pixelId || !token) return;
  // Test leads are sent only with the Test events code, so they show in Events Manager's Test events tab. Meta still
  // counts them (as it counts the pixel's copy); the shared event ID keeps that to one Lead.
  const testCode = lead.is_test ? env.META_TEST_EVENT_CODE : undefined;
  if (lead.is_test && !testCode) return;

  const parts = lead.name.trim().split(/\s+/).map(nameKey).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]! : '';
  const phone = lead.phone ? normalizePhone(lead.phone) : '';
  const fbp = readCookie(ctx.cookies, '_fbp');
  const fbc = readCookie(ctx.cookies, '_fbc') ?? (lead.fbclid ? `fb.1.${Date.now()}.${lead.fbclid}` : undefined);

  const userData: Record<string, unknown> = { em: [await sha256(lead.email.trim().toLowerCase())] };
  if (phone.length >= 10) userData.ph = [await sha256(phone)];
  if (first) userData.fn = [await sha256(first)];
  if (last) userData.ln = [await sha256(last)];
  if (ctx.ip) userData.client_ip_address = ctx.ip;
  if (ctx.userAgent) userData.client_user_agent = ctx.userAgent;
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  const customData: Record<string, string> = { content_name: 'Request Private Showing', tour_type: lead.tour_type };
  if (lead.cta_origin) customData.cta_location = lead.cta_origin;
  if (lead.utm_campaign) customData.utm_campaign = lead.utm_campaign;

  const body = {
    data: [
      {
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        event_id: ctx.eventId,
        action_source: 'website',
        event_source_url: ctx.pageUrl ?? `${env.SITE_URL}/`,
        user_data: userData,
        custom_data: customData,
      },
    ],
    ...(testCode ? { test_event_code: testCode } : {}),
  };

  try {
    // Meta documents the token as the access_token query parameter; this URL is never logged.
    const res = await fetch(`${GRAPH}/${pixelId}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const out = (await res.json().catch(() => ({}))) as { events_received?: number; error?: { message?: string } };
    if (res.ok) console.log(`[lead ${lead.id}] capi Lead sent${testCode ? ' as test event' : ''}: events_received=${out.events_received ?? '?'}`);
    else console.warn(`[lead ${lead.id}] capi Lead rejected ${res.status}: ${(out.error?.message ?? '').slice(0, 200)}`);
  } catch (err) {
    console.warn(`[lead ${lead.id}] capi Lead failed: ${(err as Error).message}`);
  }
}

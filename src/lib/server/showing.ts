import { property } from '../../data/property';
import { isLikelyBot, slotLabel, TURNSTILE_ACTION } from '../showing-shared';
import { fieldErrors, ShowingRequestSchema } from './schema';
import { hashIp, insertLead, isTestEmail, newLeadId, notifyLead, recentCounts } from './leads';

const MAX_BODY_BYTES = 16 * 1024;

interface SiteverifyResult {
  success: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
  metadata?: { result_with_testing_key?: boolean };
}

const json = (status: number, body: unknown, extra: HeadersInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });

const callUs = `Please call ${property.agent.name} at ${property.agent.phone}.`;

function allowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  const self = new URL(request.url).origin;
  const site = new URL(env.SITE_URL).origin;
  return origin === self || origin === site;
}

// Canonical siteverify: success, our action and one of our hostnames, otherwise nothing is stored or sent.
async function verifyTurnstile(env: Env, token: string, ip: string | null): Promise<{ ok: boolean; reason: string }> {
  const hostnames = new Set(
    (env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!env.TURNSTILE_SECRET_KEY || hostnames.size === 0) return { ok: false, reason: 'not-configured' };

  let out: SiteverifyResult;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, ...(ip ? { remoteip: ip } : {}) }),
    });
    if (!res.ok) return { ok: false, reason: `siteverify-http-${res.status}` };
    out = (await res.json()) as SiteverifyResult;
  } catch (err) {
    return { ok: false, reason: `siteverify-unreachable: ${(err as Error).message}` };
  }

  if (!out.success) return { ok: false, reason: (out['error-codes'] ?? []).join(',') || 'failed' };
  // Cloudflare testing keys return no action and always hostname example.com, which production never allows.
  const actionOk = out.action === TURNSTILE_ACTION || (out.action === undefined && out.metadata?.result_with_testing_key === true);
  if (!actionOk) return { ok: false, reason: `action-mismatch: ${out.action ?? 'none'}` };
  if (!hostnames.has((out.hostname ?? '').toLowerCase())) return { ok: false, reason: `hostname-mismatch: ${out.hostname ?? 'none'}` };
  return { ok: true, reason: 'ok' };
}

export async function handleShowingRequest(request: Request, env: Env): Promise<Response> {
  if (!allowedOrigin(request, env)) return json(403, { ok: false, error: 'This request was blocked.' });
  if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) {
    return json(415, { ok: false, error: 'Unsupported request format.' });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { ok: false, error: 'Request too large.' });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: 'Malformed request.' });
  }

  // 1. Turnstile, before anything the visitor typed is processed.
  const token = (body as { turnstileToken?: unknown } | null)?.turnstileToken;
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return json(400, { ok: false, error: 'Verification missing. Please try again.' });
  }
  const ip = request.headers.get('CF-Connecting-IP');
  const ts = await verifyTurnstile(env, token, ip);
  if (!ts.ok) {
    console.warn(`turnstile rejected: ${ts.reason}`);
    return json(403, { ok: false, error: `We could not verify this request. Please try again, or call ${property.agent.name} at ${property.agent.phone}.` });
  }

  // 2. Server-side form validation.
  const parsed = ShowingRequestSchema.safeParse(body);
  if (!parsed.success) return json(422, { ok: false, errors: fieldErrors(parsed.error) });
  const req = parsed.data;
  const echo = {
    preferred: slotLabel(req.preferredDate, req.preferredTime),
    alternate: slotLabel(req.alternateDate, req.alternateTime),
    flexible: req.flexible,
    tourType: req.tourType,
  };

  // Decoy success so bots learn nothing; nothing is stored or sent.
  if (isLikelyBot(req.company, req.elapsedMs)) {
    return json(200, { ok: true, leadId: newLeadId(), notified: true, ...echo });
  }

  const ipHash = ip && env.IP_HASH_SALT ? await hashIp(ip, env.IP_HASH_SALT) : null;
  try {
    const counts = await recentCounts(env, ipHash, req.email);
    if ((ipHash && counts.ip >= 4) || counts.email >= 3) {
      return json(429, { ok: false, error: `We already have recent requests from you. ${callUs}` }, { 'Retry-After': '900' });
    }
  } catch (err) {
    console.error('rate-limit query failed', (err as Error).message);
  }

  // 3. Save the lead; nothing is emailed unless it is stored.
  let lead;
  try {
    lead = await insertLead(env, req, { id: newLeadId(), ipHash, isTest: isTestEmail(env, req.email) });
  } catch (err) {
    console.error('lead insert failed', (err as Error).message);
    return json(500, { ok: false, error: `Your request could not be saved. ${callUs}` });
  }

  // 4. Notify. A delivery failure never touches the stored lead; the cron keeps retrying it.
  let notified = false;
  try {
    notified = await notifyLead(env, lead);
  } catch (err) {
    console.error(`[lead ${lead.id}] notify threw`, (err as Error).message);
  }
  // 5. Truthful status: saved, and whether the listing agent was actually notified.
  return json(200, { ok: true, leadId: lead.id, notified, ...echo });
}

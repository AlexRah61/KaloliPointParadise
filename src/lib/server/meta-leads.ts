// Leads from Meta lead forms, forwarded from the owner's Google Sheet by an Apps Script (tools/meta-lead-sync/Code.gs).
// Requests are signed with SHEET_SYNC_SECRET (HMAC-SHA256 of "timestamp.body"). Each Meta lead is stored once and the
// listing agent is emailed just like for a website request (Meta's dummy test leads go to the test recipient only).
import { z } from 'zod';
import { isTestEmail, leadRecord, newLeadId, notifyLead, storeLead } from './leads';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_SKEW_SECONDS = 300;

const RowSchema = z.object({
  key: z.string().trim().min(1).max(100),
  row: z.number().int().min(1).optional(),
  values: z.record(z.string().max(100), z.string().max(2000)).refine((v) => Object.keys(v).length <= 60, 'Too many columns.'),
});
const BodySchema = z.object({
  source: z.literal('meta_lead_form'),
  sheet: z.string().max(200).optional(),
  rows: z.array(RowSchema).max(25),
});

// Columns Meta's lead export writes; anything else is an answer to a custom form question.
const META_COLUMNS = new Set([
  'id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name', 'form_id', 'form_name',
  'is_organic', 'platform', 'email', 'full_name', 'first_name', 'last_name', 'phone', 'phone_number', 'lead_status', 'inbox_url',
]);
const SOURCES: Record<string, string> = { fb: 'facebook', ig: 'instagram' };

export type MetaLeadStatus = 'inserted' | 'duplicate' | 'skipped' | 'error';
type RowResult = { key: string; status: MetaLeadStatus; leadId?: string; notified?: boolean };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });

function hexBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function verifySignature(secret: string, timestamp: string, body: string, signature: string, now = Date.now()): Promise<boolean> {
  const ts = Number(timestamp);
  if (!/^\d{9,11}$/.test(timestamp) || Math.abs(now / 1000 - ts) > MAX_SKEW_SECONDS) return false;
  const sig = hexBytes(signature);
  if (!sig) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, sig, enc.encode(`${timestamp}.${body}`));
}

// Meta prefixes exported IDs and phone numbers ("l:123", "p:+1808...") so spreadsheets keep them as text.
const unprefix = (v: string | undefined): string => (v ?? '').trim().replace(/^(?:l|ag|as|c|f|p):/, '');

async function storeRow(env: Env, row: z.infer<typeof RowSchema>): Promise<RowResult> {
  const v = row.values;
  const metaId = unprefix(v.id);
  const rawEmail = (v.email ?? '').trim().toLowerCase();
  const email = z.email().safeParse(rawEmail).success ? rawEmail : '';
  const phone = unprefix(v.phone ?? v.phone_number).slice(0, 30);
  const name = ((v.full_name ?? '').trim() || [v.first_name, v.last_name].filter(Boolean).join(' ').trim()).slice(0, 100);
  if (!metaId && !email && !phone && !name) return { key: row.key, status: 'skipped' };

  const externalId = metaId || row.key;
  const existing = await env.DB.prepare("SELECT id FROM showing_requests WHERE source = 'meta_lead_form' AND external_id = ?1")
    .bind(externalId)
    .first<{ id: string }>();
  if (existing) return { key: row.key, status: 'duplicate', leadId: existing.id };

  const answers: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (!META_COLUMNS.has(k) && val.trim()) answers[k.replace(/_/g, ' ')] = val.trim();
  if (rawEmail && !email) answers['Email as entered'] = rawEmail;
  const isTest =
    Object.values(v).some((val) => /<test lead:/i.test(val)) || rawEmail === 'test@meta.com' || (!!email && isTestEmail(env, email));

  const lead = leadRecord({
    id: newLeadId(),
    name: name || 'Name not given',
    email,
    phone,
    utm_source: SOURCES[(v.platform ?? '').trim().toLowerCase()] ?? 'meta',
    utm_medium: 'lead_form',
    utm_campaign: v.campaign_name?.trim() || null,
    utm_content: v.ad_name?.trim() || null,
    cta_origin: 'meta_lead_form',
    is_test: isTest ? 1 : 0,
    source: 'meta_lead_form',
    external_id: externalId,
    source_details: JSON.stringify({
      lead_id: metaId || undefined,
      created_time: v.created_time || undefined,
      campaign_id: unprefix(v.campaign_id) || undefined,
      campaign_name: v.campaign_name || undefined,
      adset_id: unprefix(v.adset_id) || undefined,
      adset_name: v.adset_name || undefined,
      ad_id: unprefix(v.ad_id) || undefined,
      ad_name: v.ad_name || undefined,
      form_id: unprefix(v.form_id) || undefined,
      form_name: v.form_name || undefined,
      platform: v.platform || undefined,
      is_organic: v.is_organic || undefined,
      lead_status: v.lead_status || undefined,
      answers: Object.keys(answers).length ? answers : undefined,
    }),
  });

  try {
    await storeLead(env, lead);
  } catch (err) {
    // Two deliveries of the same lead at once: the unique index keeps one.
    if (/UNIQUE/i.test((err as Error).message)) return { key: row.key, status: 'duplicate' };
    throw err;
  }
  let notified = false;
  try {
    notified = await notifyLead(env, lead);
  } catch (err) {
    console.error(`[lead ${lead.id}] notify threw`, (err as Error).message);
  }
  return { key: row.key, status: 'inserted', leadId: lead.id, notified };
}

export async function handleMetaLeads(request: Request, env: Env): Promise<Response> {
  if (!env.SHEET_SYNC_SECRET) return json(503, { ok: false, error: 'Lead sync is not configured.' });
  if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) return json(415, { ok: false, error: 'Unsupported request format.' });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { ok: false, error: 'Request too large.' });
  const ok = await verifySignature(
    env.SHEET_SYNC_SECRET,
    request.headers.get('X-KP-Timestamp') ?? '',
    raw,
    request.headers.get('X-KP-Signature') ?? '',
  );
  if (!ok) return json(401, { ok: false, error: 'Invalid signature.' });

  let parsed;
  try {
    parsed = BodySchema.safeParse(JSON.parse(raw));
  } catch {
    return json(400, { ok: false, error: 'Malformed request.' });
  }
  if (!parsed.success) return json(422, { ok: false, error: 'Unexpected lead format.' });

  const results: RowResult[] = [];
  for (const row of parsed.data.rows) {
    try {
      results.push(await storeRow(env, row));
    } catch (err) {
      console.error(`meta lead row ${row.row ?? '?'} failed: ${(err as Error).message}`);
      results.push({ key: row.key, status: 'error' });
    }
  }
  const count = (s: MetaLeadStatus) => results.filter((r) => r.status === s).length;
  console.log(`meta leads: ${count('inserted')} inserted, ${count('duplicate')} duplicate, ${count('skipped')} skipped, ${count('error')} error`);
  return json(200, { ok: true, results });
}

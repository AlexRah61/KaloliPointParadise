import type { ShowingRequest } from './schema';
import { agentEmail, sendEmail, visitorEmail } from './email';

// Only states this website can observe. Offline outcomes (contacted, confirmed, attended, cancelled) are never set here.
export type LeadStatus = 'new' | 'notified' | 'notification_failed';
export type LeadSource = 'website' | 'meta_lead_form';

export interface LeadRecord {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  phone: string;
  email: string;
  preferred_date: string;
  preferred_time: string;
  alternate_date: string | null;
  alternate_time: string | null;
  flexible: number;
  tour_type: 'in_person' | 'video';
  message: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  gclid: string | null;
  fbclid: string | null;
  ttclid: string | null;
  referrer: string | null;
  landing_page: string | null;
  cta_origin: string | null;
  status: LeadStatus;
  is_test: number;
  ip_hash: string | null;
  notification_attempts: number;
  notified_at: string | null;
  agent_email_id: string | null;
  last_notification_error: string | null;
  visitor_email_status: 'sent' | 'failed' | null;
  visitor_email_id: string | null;
  source: LeadSource;
  external_id: string | null;
  source_details: string | null;
}

// Phone and requested times are optional ('' when absent: the columns predate that and are NOT NULL).
export function leadRecord(fields: Pick<LeadRecord, 'id' | 'name' | 'email'> & Partial<LeadRecord>): LeadRecord {
  const now = new Date().toISOString();
  return {
    created_at: now,
    updated_at: now,
    phone: '',
    preferred_date: '',
    preferred_time: '',
    alternate_date: null,
    alternate_time: null,
    flexible: 0,
    tour_type: 'in_person',
    message: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    gclid: null,
    fbclid: null,
    ttclid: null,
    referrer: null,
    landing_page: null,
    cta_origin: null,
    status: 'new',
    is_test: 0,
    ip_hash: null,
    notification_attempts: 0,
    notified_at: null,
    agent_email_id: null,
    last_notification_error: null,
    visitor_email_status: null,
    visitor_email_id: null,
    source: 'website',
    external_id: null,
    source_details: null,
    ...fields,
  };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newLeadId(now = new Date()): string {
  const hst = new Date(now.getTime() - 10 * 3600 * 1000).toISOString();
  const ymd = hst.slice(2, 4) + hst.slice(5, 7) + hst.slice(8, 10);
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const tail = Array.from(bytes, (b) => CROCKFORD[b % 32]).join('');
  return `KP-${ymd}-${tail}`;
}

export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isTestEmail(env: Env, email: string): boolean {
  return (env.TEST_LEAD_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export async function recentCounts(env: Env, ipHash: string | null, email: string): Promise<{ ip: number; email: number }> {
  const since15 = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const since60 = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [ip, em] = await env.DB.batch<{ n: number }>([
    env.DB.prepare('SELECT COUNT(*) AS n FROM showing_requests WHERE ip_hash = ?1 AND created_at >= ?2').bind(ipHash ?? '', since15),
    env.DB.prepare('SELECT COUNT(*) AS n FROM showing_requests WHERE email = ?1 AND created_at >= ?2').bind(email, since60),
  ]);
  return { ip: ip?.results?.[0]?.n ?? 0, email: em?.results?.[0]?.n ?? 0 };
}

export async function insertLead(env: Env, req: ShowingRequest, meta: { id: string; ipHash: string | null; isTest: boolean }): Promise<LeadRecord> {
  const a = req.attribution ?? {};
  const lead = leadRecord({
    id: meta.id,
    name: req.name,
    phone: req.phone ?? '',
    email: req.email,
    preferred_date: req.preferredDate ?? '',
    preferred_time: req.preferredTime ?? '',
    alternate_date: req.alternateDate ?? null,
    alternate_time: req.alternateTime ?? null,
    flexible: req.flexible ? 1 : 0,
    tour_type: req.tourType,
    message: req.message || null,
    utm_source: a.utm_source || null,
    utm_medium: a.utm_medium || null,
    utm_campaign: a.utm_campaign || null,
    utm_content: a.utm_content || null,
    utm_term: a.utm_term || null,
    gclid: a.gclid || null,
    fbclid: a.fbclid || null,
    ttclid: a.ttclid || null,
    referrer: a.referrer || null,
    landing_page: a.landing_page || null,
    cta_origin: req.ctaOrigin ?? null,
    is_test: meta.isTest ? 1 : 0,
    ip_hash: meta.ipHash,
  });
  await storeLead(env, lead);
  return lead;
}

export async function storeLead(env: Env, lead: LeadRecord): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO showing_requests (
      id, created_at, updated_at, name, phone, email, preferred_date, preferred_time, alternate_date, alternate_time,
      flexible, tour_type, message, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, ttclid,
      referrer, landing_page, status, is_test, ip_hash, cta_origin, source, external_id, source_details
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27,
      ?28, ?29, ?30)`,
  )
    .bind(
      lead.id, lead.created_at, lead.updated_at, lead.name, lead.phone, lead.email, lead.preferred_date, lead.preferred_time,
      lead.alternate_date, lead.alternate_time, lead.flexible, lead.tour_type, lead.message, lead.utm_source, lead.utm_medium,
      lead.utm_campaign, lead.utm_content, lead.utm_term, lead.gclid, lead.fbclid, lead.ttclid, lead.referrer, lead.landing_page,
      lead.status, lead.is_test, lead.ip_hash, lead.cta_origin, lead.source, lead.external_id, lead.source_details,
    )
    .run();
}

// Attempts the listing-agent notification and records only the observable outcome. Leads are never deleted here.
export async function notifyLead(env: Env, lead: LeadRecord): Promise<boolean> {
  const attempt = lead.notification_attempts + 1;
  const result = await sendEmail(env, agentEmail(env, lead), `${lead.id}-agent-${attempt}`);
  const now = new Date().toISOString();
  if (result.id) {
    lead.status = 'notified';
    lead.notified_at = now;
    lead.agent_email_id = result.id;
    lead.last_notification_error = null;
  } else {
    lead.status = 'notification_failed';
    lead.last_notification_error = result.error ?? 'unknown error';
    console.error(`[lead ${lead.id}] notification failed: ${lead.last_notification_error}`);
  }
  lead.notification_attempts = attempt;
  lead.updated_at = now;
  // If this update fails the row stays 'new'; the cron retry reuses the same Idempotency-Key, so Resend won't send twice.
  try {
    await env.DB.prepare(
      `UPDATE showing_requests SET status = ?2, notification_attempts = ?3, notified_at = ?4, agent_email_id = ?5,
         last_notification_error = ?6, updated_at = ?7 WHERE id = ?1`,
    )
      .bind(lead.id, lead.status, lead.notification_attempts, lead.notified_at, lead.agent_email_id, lead.last_notification_error, now)
      .run();
  } catch (err) {
    console.error(`[lead ${lead.id}] status update failed: ${(err as Error).message}`);
  }

  // The visitor is told the request was received only after the agent notification succeeded.
  // People who used a Meta lead form already saw Meta's own confirmation, so they get no website email.
  if (lead.status === 'notified' && !lead.visitor_email_status && (lead.source ?? 'website') === 'website') {
    const v = await sendEmail(env, visitorEmail(env, lead), `${lead.id}-visitor`);
    lead.visitor_email_status = v.id ? 'sent' : 'failed';
    lead.visitor_email_id = v.id ?? null;
    if (v.error) console.error(`[lead ${lead.id}] visitor email failed: ${v.error}`);
    try {
      await env.DB.prepare('UPDATE showing_requests SET visitor_email_status = ?2, visitor_email_id = ?3, updated_at = ?4 WHERE id = ?1')
        .bind(lead.id, lead.visitor_email_status, lead.visitor_email_id, new Date().toISOString())
        .run();
    } catch (err) {
      console.error(`[lead ${lead.id}] visitor status update failed: ${(err as Error).message}`);
    }
  }
  return lead.status === 'notified';
}

// Cron: retry failed (or interrupted) notifications for up to 3 days, 6 attempts max.
export async function retryFailedNotifications(env: Env): Promise<{ retried: number; notified: number }> {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const stuckBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT * FROM showing_requests
     WHERE notification_attempts < 6 AND created_at >= ?1
       AND (status = 'notification_failed' OR (status = 'new' AND created_at < ?2))
     ORDER BY created_at ASC LIMIT 10`,
  )
    .bind(since, stuckBefore)
    .all<LeadRecord>();
  let notified = 0;
  for (const lead of results ?? []) {
    try {
      if (await notifyLead(env, lead)) notified++;
    } catch (err) {
      console.error(`[lead ${lead.id}] retry threw: ${(err as Error).message}`);
    }
  }
  return { retried: results?.length ?? 0, notified };
}

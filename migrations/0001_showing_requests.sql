-- Lightweight lead ledger for showing requests (not a CRM).
-- Status records only what this website observes directly:
--   new                 -> request validated and persisted
--   notified            -> listing-agent notification accepted by the email provider
--   notification_failed -> lead stored, but the notification attempt failed (retried by cron)
-- Offline outcomes (contacted, confirmed, attended, cancelled) are never inferred here.
CREATE TABLE IF NOT EXISTS showing_requests (
  id                      TEXT PRIMARY KEY,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  name                    TEXT NOT NULL,
  phone                   TEXT NOT NULL,
  email                   TEXT NOT NULL,
  preferred_date          TEXT NOT NULL,
  preferred_time          TEXT NOT NULL,
  alternate_date          TEXT,
  alternate_time          TEXT,
  flexible                INTEGER NOT NULL DEFAULT 0,
  tour_type               TEXT NOT NULL DEFAULT 'in_person' CHECK (tour_type IN ('in_person', 'video')),
  message                 TEXT,
  utm_source              TEXT,
  utm_medium              TEXT,
  utm_campaign            TEXT,
  utm_content             TEXT,
  utm_term                TEXT,
  gclid                   TEXT,
  fbclid                  TEXT,
  ttclid                  TEXT,
  referrer                TEXT,
  landing_page            TEXT,
  status                  TEXT NOT NULL DEFAULT 'new'
                          CHECK (status IN ('new', 'notified', 'notification_failed')),
  is_test                 INTEGER NOT NULL DEFAULT 0,
  ip_hash                 TEXT,
  notification_attempts   INTEGER NOT NULL DEFAULT 0,
  notified_at             TEXT,
  agent_email_id          TEXT,
  last_notification_error TEXT,
  visitor_email_status    TEXT CHECK (visitor_email_status IN ('sent', 'failed')),
  visitor_email_id        TEXT
);

CREATE INDEX IF NOT EXISTS idx_showing_requests_created ON showing_requests (created_at);
CREATE INDEX IF NOT EXISTS idx_showing_requests_status ON showing_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_showing_requests_ip ON showing_requests (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_showing_requests_email ON showing_requests (email, created_at);

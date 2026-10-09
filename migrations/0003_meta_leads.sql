-- Leads from Meta lead forms (forwarded from the owner's Google Sheet) are stored next to website requests.
-- source: 'website' or 'meta_lead_form'; external_id: Meta's lead ID, so a forwarded lead is stored only once;
-- source_details: JSON with the campaign, ad, form and any extra answers.
ALTER TABLE showing_requests ADD COLUMN source TEXT NOT NULL DEFAULT 'website';
ALTER TABLE showing_requests ADD COLUMN external_id TEXT;
ALTER TABLE showing_requests ADD COLUMN source_details TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_showing_requests_external ON showing_requests (source, external_id) WHERE external_id IS NOT NULL;

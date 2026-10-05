-- Which "Request Private Showing" entry point produced the request (hero, desktop_header, mobile_sticky, ...).
ALTER TABLE showing_requests ADD COLUMN cta_origin TEXT;

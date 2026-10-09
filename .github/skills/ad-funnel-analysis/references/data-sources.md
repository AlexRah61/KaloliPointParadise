# Data sources: how each is read and what to watch for

| Source | Collector | How | Time zone |
|---|---|---|---|
| Meta Ads | `scripts/collect-meta.ps1` | Temporary window of the signed-in Edge profile: Ads Reporting URL with `time_range`, `metrics`, `breakdowns` → Export → CSV; manage tables (ads, ad sets, campaigns) and A/B test pages read as accessible text | Ad account (`meta.timezone`) |
| GA4 | `scripts/collect-ga4.ps1` | Temporary Edge window: Traffic acquisition explorer per funnel event (session campaign, source / medium, channel group) and demographics (city, country) read as accessible text | Property (`ga4.timezone`) |
| Website | `scripts/collect-site.mjs` | Cloudflare GraphQL `httpRequestsAdaptiveGroups` (page loads, lazy images, film, form API) and `turnstileAdaptiveGroups` (form opened), with the Wrangler login | Converted to the ad account zone |
| Tour requests | `scripts/collect-leads.mjs` | `wrangler d1 execute --remote --json` with a column list that excludes personal data | UTC timestamps, windowed in the ad account zone |

## Meta

- Reporting URLs: `adsmanager.facebook.com/adsmanager/reporting/view?act=…&business_id=…&time_range=START_ENDEXCLUSIVE&metrics=…&breakdowns=…`.
  `date=` is ignored by Reporting; `time_range` end is exclusive.
- Exports: `daily` (campaign, ad set, ad, day), `country`, `country-today`, `hourly-today`, `hourly-yesterday`; full runs
  add `country-daily`, `region`, `age-gender` and `platform`. The hourly breakdown cannot be combined with country, age
  or reach. Exports for a day without delivery in the daily export are skipped (nothing to export; saves a minute each).
- `hourly-yesterday` is checked against yesterday's row in the daily export (hours must add up to the day).
- `Reporting starts/ends` in each CSV is checked against the requested range (daily rows carry their own day).
- Manage tables (`/adsmanager/manage/{ads|adsets|campaigns}?columns=…`) give delivery status, budget, bid strategy and
  each ad's URL parameters; the live `utm_campaign` values map GA4 rows to campaigns without manual config.
- Meta's numbers for today keep changing for a few hours; yesterday is stable by the next morning.

## GA4

- Explorer URL parameters: `_u.date00/_u.date01` (YYYYMMDD), `_r.explorerCard..seldim=["sessionCampaignName"]`,
  `columnFilters` for the event-count and key-event columns. Unsupported dimensions silently fall back to the default
  (channel group); that is why the channel table is read with no dimension.
- Campaign names appear 24–48 h after the session; until then rows show `(cross-network)` (reported as "pending").
- Tables show 10 rows per page; the collector switches to a larger page size when a table has more rows and the
  validation flags any table still cut off.
- Meta's ad-review crawlers and other data-centre traffic appear as cities such as Altoona, Prineville, Forest City or
  Dublin with 0% engagement (`funnel.json` → `ga4.dataCenterCities`).

## Website (Cloudflare)

- The Free plan cannot see query strings, so visits cannot be split by campaign; Facebook/Instagram in-app browser
  visits (user agents with `FBAN/FBAV/FB_IAB` or `Instagram`) are a lower bound on ad visits.
- Scroll depth: lazy images that appear in exactly one page section (`funnel.json` → `site.sections`) mark how far a
  visit scrolled. Turnstile events mark that the tour form opened; `/media/film/` requests mark film plays.
- Excluded: verified bots, crawlers, tool user agents (and every visit from an address that used one), and addresses
  that sent stored test requests. Stored: no IPs or user agents.
- GraphQL limits: about 300 queries per 5 minutes per user, less for large scans. A run uses about 15 one-day queries;
  on "budget depleted" the collector waits (at most 2.5 minutes per run) and then reports the missing days.
  Several runs within a few minutes can exhaust the budget; space runs at least 10 minutes apart.

## Tour requests (D1)

- Columns read: id, created time, test flag, status, tour type, button, UTM fields, whether a click id exists, and the
  referrer host / landing path (query strings dropped). Never name, phone, email, message or IP hash.
- The website stores the last paid touch for 30 days (`src/scripts/attribution.ts`), so a request carries the UTM of
  the ad click even if the visitor returns later. Requests with no tags but a Facebook/Instagram referrer or in-app
  visit are reported as "without ad tags" (organic post, profile link or an untagged ad).
- `is_test = 1` rows (QA and owner tests) are excluded everywhere; a real-looking request sent from an address that
  ran QA tools is reported as internal.

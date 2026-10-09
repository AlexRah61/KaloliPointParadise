---
name: ad-funnel-analysis
description: 'End-to-end ad funnel report for the property website: Meta Ads (impressions, reach, link clicks, CTR, landing page views, spend, country/region/placement, A/B test) -> GA4 (sessions, engagement, tour-button clicks, form starts per campaign) -> website behaviour (Cloudflare in-app visits, scroll depth, form opens) -> stored tour requests (D1 leads). Produces per-campaign CTR, ad-to-website and page-view-to-lead conversion, cost per lead, charts, what works / what does not and why, prioritised high-value fixes, deltas since the last run and validation checks. Use when asked how the ads are doing, for an ad or campaign performance report, funnel or conversion analysis, which ad works, Meta vs GA4 numbers, cost per lead, or to run the ad report daily or several times a day.'
---

# Ad funnel analysis

One command collects every source, joins them per campaign and writes a report the marketing team can act on.

```
Meta ad ─► link click ─► landing page view ─► GA4 session ─► engaged ─► tour button ─► form start ─► tour request
(Ads Manager exports)        (Meta pixel)       (GA4 tables by utm_campaign)                         (D1 database)
                     website behaviour of Facebook/Instagram in-app visitors: Cloudflare (no UTMs on the Free plan)
```

## Before the first run

- Windows with PowerShell 7 and Node 22+ (the repo's engine); Microsoft Edge signed in to Meta Ads Manager and Google
  Analytics in the profile named in `../_shared/site.local.json` (`edge.profileDirectory`). Edge must download
  without asking where to save.
- Wrangler logged in once (`npx wrangler login`); the scripts reuse that login for Cloudflare and D1.
- `../_shared/site.local.json` (IDs, copy of `site.example.json`) and `campaigns.local.json` (copy of
  `campaigns.example.json`) exist. Both are git-ignored: never commit them, the repository is public.

## Run

From the repo root (each Meta/GA4 step opens a temporary Edge window that closes itself; tell the user first):

| Need | Command |
|---|---|
| Daily report, last 7 days (default) | `pwsh -File .github/skills/ad-funnel-analysis/scripts/run.ps1` |
| Quick intra-day refresh (fewer tables, about 6 min) | `... run.ps1 -Quick` |
| Campaign-lifetime window | `... run.ps1 -Since 2026-10-07` (dates in the ad account time zone) |
| Re-analyse an existing run (no collection) | `... run.ps1 -RunDir reports/ad-funnel-analysis/<run-id>` |
| Skip a source | `-SkipMeta`, `-SkipGa4`, `-SkipSite`, `-SkipLeads` |

A full run takes about 8–12 minutes. Run it in its own terminal and wait for `Report:`; do not start other browser
automation or Playwright jobs meanwhile.

Outputs in `reports/ad-funnel-analysis/<yyyy-MM-ddTHHmm>/` (git-ignored): `report.md`, `report.html` (self-contained,
inline charts), `charts/*.svg`, `funnel.json` (full model), and the raw inputs (`meta/`, `ga4/`, `site.json`,
`leads.json`) so any number can be traced back.

## Present the result

Read `report.md` and answer in this order, keeping the report's numbers exactly:

1. **Bottom line**: spend, clicks, landing page views, tour requests; each campaign's status.
2. **Conversion by campaign**: CTR, ad → website (landing page views / clicks), page view → tour request, cost per
   request, with the 95% ranges when volumes are small.
3. **What works / what does not and why** (from the findings, with their evidence).
4. **Top 3 changes** from the recommended-changes table (each: where to click, why, effort, impact).
5. **Since the last report** when present, and any validation check that is WARN or FAIL.

Link `report.html` and the chart files. State estimates as estimates (shared UTM splits, GA4 "pending" sessions).

## Validate before reporting

- Every source `ok` (or deliberately skipped). If one failed, re-collect only that source into the same run folder,
  then re-analyse: `pwsh -File scripts/collect-meta.ps1 -Since <d> -Until <d> -OutDir <run>` (or `collect-ga4.ps1`;
  `node scripts/collect-site.mjs --since <d> --until <d> --out <run>/site.json --leads <run>/leads.json`), then
  `run.ps1 -RunDir <run>`.
- Validation table: Meta daily totals = country totals; export dates = requested window; GA4 tables agree; GA4
  submission events ≈ stored requests; Cloudflare in-app visits in line with Meta landing page views.
- GA4 needs 24–48 h to assign campaign names; until then sessions show as `(cross-network)` ("pending"). Judge
  per-campaign GA4 rates on yesterday or older; judge today on Meta and the website.
- Meta and the website count days in the ad account time zone, GA4 in the property time zone; compare window totals.

## Cadence

- **Daily** (morning, after Meta finalises yesterday): full run, default window. Compare with yesterday's report.
- **Several times a day**: `-Quick`; the report adds "Since the last report" for runs with the same window start.
- After any ad change, add a line to `changes` in `campaigns.local.json` (time, what changed, and
  `removedCountries` when a country is dropped) so reports show it and today's leftover spend is not flagged as a new
  problem. New campaigns map automatically through their live URL parameters; add them to `campaigns.local.json` for
  a label, budget and old UTM values.

## Configuration

- `funnel.json`: funnel stages, GA4 event names, bot cities, benchmarks and thresholds (committed).
- `campaigns.local.json`: Meta campaign → label, UTM values (exact or `/regex/i`), daily budget, priority markets and
  targeted countries/regions, UTM values shared by several ads (with the time sharing ended), ignored test UTMs,
  A/B test URLs, change log.

## Safety

Read-only everywhere: the Edge windows only load pages, export CSVs and read text; nothing in Meta or GA4 is edited or
saved. The D1 query selects attribution and status columns only (no names, phone numbers, emails or messages), and
website visits are stored without IP addresses or user agents. Recommend changes; never make them in Ads Manager.

## When something fails

| Symptom | Fix |
|---|---|
| Meta step "no CSV arrived" | Edge setting "Ask me what to do with each download" must be off; check the Downloads folder |
| Meta/GA4 "NOT READY" | Sign in to Ads Manager / GA4 in that Edge profile, then rerun |
| D1 error 7403 | Cloudflare login expired: `npx wrangler login` |
| Cloudflare "budget depleted" | Runs too close together; the collector waits up to 2.5 min, then reports missing days. Rerun 10 min later |
| A campaign is missing | It had no delivery in the window, or its UTM is not mapped: see the Tracking section |

## References

- [references/metrics.md](references/metrics.md): every metric, formula, benchmark and statistical test.
- [references/playbook.md](references/playbook.md): what each finding means and how to fix it in Meta or on the site.
- [references/data-sources.md](references/data-sources.md): how each source is read, its limits and known traps.

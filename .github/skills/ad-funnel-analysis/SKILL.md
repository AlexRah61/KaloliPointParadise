---
name: ad-funnel-analysis
description: 'End-to-end ad funnel report for the property website: Meta Ads (impressions, reach, link clicks, CTR, landing page views, spend, country/region/placement, A/B test, Meta''s own insight charts and campaign settings) -> GA4 (sessions, engagement, tour-button clicks, form starts per campaign) -> website behaviour (Cloudflare in-app visits, scroll depth, form opens) -> stored tour requests (D1 leads). Produces an executive summary, per-campaign CTR, ad-to-website and page-view-to-lead conversion, cost per lead, day-over-day comparison (is each ad getting better?), charts, what works / what does not and why, prioritised recommendations backed by the data and cited platform best practices, deltas since the last run, validation checks, and a PDF filed in "daily ad report/" named by campaign, report date and extraction time. Use when asked how the ads are doing, for an ad or campaign performance report, funnel or conversion analysis, which ad works, whether the ads improve day by day, Meta vs GA4 numbers, cost per lead, a PDF ad report, or to run the ad report daily or several times a day.'
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
| Daily report, last 7 days, PDF committed and pushed (the owner's standing request) | `pwsh -File .github/skills/ad-funnel-analysis/scripts/run.ps1 -Publish` |
| Same, PDF saved in `daily ad report/` but not committed | `... run.ps1` |
| Quick intra-day refresh (fewer Meta and GA4 tables, about 8 min) | `... run.ps1 -Quick -Publish` |
| Campaign-lifetime window | `... run.ps1 -Since 2026-10-07` (dates in the ad account time zone) |
| Re-analyse an existing run (no collection; rewrites that run's PDF) | `... run.ps1 -RunDir reports/ad-funnel-analysis/<run-id>` |
| Skip a source or step | `-SkipMeta`, `-SkipMetaCharts`, `-SkipGa4`, `-SkipSite`, `-SkipLeads`, `-NoPdf` |

A full run takes about 10–13 minutes (Meta exports 4.5 min, Meta charts and settings 2.2 min, GA4 2.3 min, Cloudflare
1–2 min). Run it in its own terminal and wait for `PDF:`; do not start other browser automation or Playwright jobs
meanwhile.

Outputs in `reports/ad-funnel-analysis/<yyyy-MM-ddTHHmm>/` (git-ignored): `report.md`, `report.html` (self-contained,
inline charts), `report-public.html` and `report.pdf` (the shared version), `charts/*.svg`, `meta/insights/*.png` (Meta's
charts), `funnel.json` (full model) and the raw inputs (`meta/`, `ga4/`, `site.json`, `leads.json`) so any number can be
traced back.

The PDF is also filed in the repository folder `daily ad report/` as
`<Meta campaign names joined by " + ">_report <report date>_extracted <yyyy-MM-dd HHmm> <TZ>.pdf`, for example
`Hawaii House Sale + Test - Hawaii House Sale_report 2026-10-08_extracted 2026-10-08 1930 PDT.pdf`. The report date is
the last day of data (the window end, ad account time zone); the extraction time keeps several runs on one day apart
and in order. `-Publish` commits only that PDF (other staged work stays staged) and pushes it when it is the only
unpushed commit; otherwise it leaves the commit for the owner to push. The repository is public: the PDF leaves out
individual tour requests, and `export-pdf.mjs` refuses to file it if the shared HTML contains an account or campaign ID,
an email address, a phone number, an IP address or a local path.

## Present the result

Read `report.md` and answer in this order, keeping the report's numbers exactly:

1. **Executive summary**: the one-line verdict; spend, clicks, landing page views, tour requests; each campaign's
   status; which ad is ahead (only differences beyond chance); the day-over-day verdict; the biggest issue.
2. **Recommendations** (top 3–5 from the report): what to do and where, the evidence in this run, the best practice it
   follows with its source link, and what the next report should show. Do not add advice the data does not support.
3. **Conversion by campaign**: CTR, ad → website (landing page views / clicks), page view → tour request, cost per
   request, with the 95% ranges when volumes are small.
4. **Day over day**: is each ad getting better? Latest complete day vs the day before (and the last 3 days vs the 3
   before once there are 4+ days), today vs yesterday up to the same hour, with what drove the change (CTR, CPM, page
   loads) and whether it is beyond daily noise. Say plainly when a move is within noise.
5. **What works / what does not and why** (from the findings, with their evidence), and what Meta's own charts show.
6. **Since the last report** when present, and any validation check that is WARN or FAIL.

Link the PDF in `daily ad report/` (and `report.html` for the full local version). State estimates as estimates
(shared UTM splits, GA4 "pending" sessions).

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

- **Daily** (morning, after Meta finalises yesterday): full run with `-Publish`, default window. Compare with
  yesterday's PDF.
- **Several times a day**: `-Quick -Publish`; the report adds "Since the last report" for runs with the same window
  start, and each run gets its own PDF (extraction time in the name).
- After any ad change, add a line to `changes` in `campaigns.local.json` (time, what changed, and
  `removedCountries` when a country is dropped) so reports show it and today's leftover spend is not flagged as a new
  problem. New campaigns map automatically through their live URL parameters; add them to `campaigns.local.json` for
  a label, budget and old UTM values.

## Configuration

- `funnel.json`: funnel stages, GA4 event names, bot cities, benchmarks and thresholds (committed).
- `best-practices.json`: for every finding, the published guidance behind the recommendation (Meta Business Help
  Center, Google Analytics / Google Ads Help, web.dev, Nielsen Norman Group) with its link, the expected effect and what
  the next report should show (committed; re-check the links when the platforms change their guidance). A test fails
  when a finding has no cited practice.
- `campaigns.local.json`: Meta campaign → label, UTM values (exact or `/regex/i`), daily budget, priority markets and
  targeted countries/regions, UTM values shared by several ads (with the time sharing ended), ignored test UTMs,
  A/B test URLs, change log.

## Safety

Read-only everywhere: the Edge windows only load pages, export CSVs, read text and take screenshots; nothing in Meta or
GA4 is edited or saved. On the Ads Manager insights page the only clicks are a campaign's View button, the chart's
metric cards and the Demographics / Platform tabs, and on the campaign settings panel only the Review tab (never Edit,
the on/off switch or Publish); the date range is set in the URL, so the owner's own date preset is unchanged. The
screenshots are cropped to the chart cards (no account name, URL or profile picture). The D1 query selects attribution
and status columns only (no names, phone numbers, emails or messages), and website visits are stored without IP
addresses or user agents. Recommend changes; never make them in Ads Manager.

## When something fails

| Symptom | Fix |
|---|---|
| Meta step "did not finish loading" for every page, blank Edge windows | The Windows session was locked or asleep: the browser steps need an unlocked, awake desktop (the run now stops at the start when the PC is locked) |
| Meta step "no CSV arrived" | Edge setting "Ask me what to do with each download" must be off; check the Downloads folder |
| Meta/GA4 "NOT READY" | Sign in to Ads Manager / GA4 in that Edge profile, then rerun |
| D1 error 7403 | Cloudflare login expired: `npx wrangler login` |
| Cloudflare "budget depleted" | Runs too close together; the collector waits up to 2.5 min, then reports missing days. Rerun 10 min later |
| A campaign is missing | It had no delivery in the window, or its UTM is not mapped: see the Tracking section |
| "meta charts ... (the insights page did not load)" | Sign in to Ads Manager in that Edge profile; rerun, or `-SkipMetaCharts` to report without Meta's charts |
| "The PDF was not filed" (exit 3) | The shared HTML contains an ID or personal data (listed in the message); fix the label or config that put it there |
| "The PDF was not filed" (exit 4) | Microsoft Edge not found: set `EDGE_PATH` to msedge.exe |

## References

- [references/metrics.md](references/metrics.md): every metric, formula, benchmark and statistical test.
- [references/playbook.md](references/playbook.md): what each finding means and how to fix it in Meta or on the site.
- [references/data-sources.md](references/data-sources.md): how each source is read, its limits and known traps.

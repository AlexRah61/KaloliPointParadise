# Metrics, formulas and benchmarks

All rates are computed per campaign and for all campaigns together. Counts come from the source named in brackets.

## Funnel stages

| Stage | Definition | Source |
|---|---|---|
| Impressions | Times the ad was shown | Meta |
| Reach | People who saw the ad (sum of the country rows: approximate, people in two countries count twice) | Meta |
| Link clicks | Clicks on the ad's link (`inline_link_clicks`) | Meta |
| Landing page views (LPV) | Link clicks after which the page loaded and the pixel fired | Meta pixel |
| GA4 sessions | Sessions whose `utm_campaign` maps to the campaign | GA4 |
| Engaged sessions | 10+ seconds, 2+ page views or a key event | GA4 |
| Tour-button clicks | `showing_cta_click` events | GA4 |
| Form starts | `showing_form_start` events | GA4 |
| Tour requests | Rows in `showing_requests` (`is_test = 0`) attributed to the campaign | D1 (website database) |
| Pixel leads | Meta's `Lead` count; includes view-through credit, so it can differ from stored requests | Meta |

## Rates

| Rate | Formula | Read it as |
|---|---|---|
| CTR | link clicks / impressions | Does the creative make people tap? |
| Ad → website | LPV / link clicks | Do taps turn into page loads (accidental taps, slow load)? |
| Impression → website | LPV / impressions | End-to-end ad efficiency |
| Session capture | (GA4 sessions + allocated pending) / LPV | Tracking coverage between Meta and GA4 |
| Engagement rate | engaged sessions / sessions | Does the first screen hold attention? |
| Tour-button rate | tour-button clicks / sessions | Purchase intent on the page |
| Form completion | tour requests / form starts | Form friction |
| Page view → tour request | tour requests / LPV | The headline conversion |
| Cost per LPV, per engaged visit, per request | spend / count | Value for money at each stage |
| Frequency | impressions / reach | Ad fatigue above 3 in a week |
| Budget used | spend / (daily budget × days running, today pro-rated) | Delivery problems below 60% |

## Benchmarks (funnel.json)

| Benchmark | Value | Why |
|---|---|---|
| Link CTR good / poor | 1.5% / 0.5% | Rule of thumb for Meta video traffic ads (roughly 0.5–1.5%) |
| LPV per click good / poor | 85% / < 75% | Healthy in-app loads are 85–95%; below 75% accidental taps or slow loads dominate |
| Session capture poor | < 60% | Blockers and in-app privacy usually lose 10–30% |
| Engagement rate poor | < 25% | Paid social traffic usually engages 30–60% in GA4 |
| Assumed lead rate | 0.5% of LPV | Planning value for a single high-value listing; used only for the zero-lead test |
| Frequency high | > 3 | Fatigue threshold for a one-week window |
| Pending share high | > 30% | Too much of GA4 not yet attributed to judge per-campaign GA4 rates |
| Priority-market spend share minimum | 50% | Most of the budget should reach the priority markets |
| Learning period | 48 h | Results after a significant edit are unstable |

Change thresholds in `funnel.json`, not in code.

## Statistics

- **95% range (Wilson score interval)** for CTR and page view → request: with 0 requests from n page views the range
  is 0 to 3.84 / (n + 3.84), so 0 requests from 92 page views still allows a true rate up to about 4%.
- **Zero-lead test**: chance of seeing 0 requests from n page views if the true rate were p is (1 − p)^n. Below 5%,
  zero is a real signal; above, it is too early. Page views needed: ln(0.05) / ln(1 − p) (598 at p = 0.5%).
- **Head-to-head**: two-sided two-proportion z-test between the two biggest campaigns for CTR, page loads per click,
  engagement and tour-button rate. A finding appears only when p < 0.05.
- **Shared UTM split**: when several ads sent the same `utm_campaign`, GA4 rows are split by each campaign's landing
  page views during the period it carried that value (today's split uses hourly data; earlier days are pro-rated).
- **Pending allocation**: `(cross-network)` sessions are allocated by landing page view share only for session
  capture; all other GA4 rates use attributed sessions.

## Day over day

The question is "is each ad getting better?", answered with the outcome that matters before requests exist:
**cost per landing page view** (page views per dollar).

- **Latest complete day vs the day before**, per campaign and in total. Today is never compared with a full day.
- **Last 3 complete days vs the 3 before** once there are at least 4 complete days (k = min(3, days / 2)).
- **Today vs yesterday up to the same hour** (last complete hour), from Meta's hourly breakdowns of both days.
- **Test**: with spend given, page views behave like Poisson counts, so log(cost ratio) has standard error
  sqrt(1/n1 + 1/n2); |z| > 1.96 is beyond daily noise. The report prints the noise band (about ±30% at 80 page views a
  day on each side). Moves under 10% (`benchmarks.dayOverDayMinChange`) are "steady".
- **Drivers**: cost per page view = CPM / (1,000 × page views per impression), so each change is split into the tap
  rate (CTR, two-proportion z-test), the price (CPM) and page loads per tap.
- **Website by day**: share of Facebook/Instagram in-app visits that scrolled past the first screen or reached the form
  (all campaigns together; two-proportion z-test day over day).
- GA4 is not compared by day: campaign attribution arrives 24–48 hours late, so recent days would look worse.

## Status labels

Each campaign gets two labels, because a cheap click and a buyer are different questions.

| Traffic | Rule |
|---|---|
| strong | CTR at or above the good benchmark and at least 85% of clicks load the page |
| typical | Between strong and weak |
| weak | CTR below the poor benchmark, or (30+ clicks) under 75% of clicks load the page |
| too early | Fewer than 500 impressions |

| Leads | Rule |
|---|---|
| converting | At least one stored tour request with the campaign's tags |
| not converting | Zero requests and the zero-lead test is below 5% |
| too early | Zero requests, but zero is still likely by chance |

# Playbook: findings → fixes

Each report finding has an id. This page explains it and how to act on it. Effort "easy" means a settings change of a
few minutes in Ads Manager or a one-line site change; "medium" means new creative or a small site feature.

Meta rule for this listing: ads that promote a home for sale to US audiences must use the **Housing special ad
category**, which locks age (18–65+), gender and ZIP-code targeting. Improve audience quality with locations,
placements and creative, not demographic targeting.

## Ads (Meta)

| Finding | What it means | Fix (where) |
|---|---|---|
| `geo-outside-target` | Spend in countries you no longer target (often "people recently in" or a change not yet applied) | Ad set → Audience → Locations: remove the country, choose "People living in this location" |
| `geo-removed-today` | Today's spend in a country the change log says was removed today | Nothing yet; confirm $0 in tomorrow's report |
| `geo-priority-share` | Cheaper markets take most of the budget (compare CPM by country) | Give the priority market its own ad set with most of the budget; a smaller separate ad set (or none) for the rest |
| `geo-regions` | US spend outside the targeted states | Locations → "People living in this location" |
| `placements` | Audience Network / Messenger taps rarely load the page | Ad set → Placements → Manual: Facebook & Instagram Feeds, Stories, Reels only |
| `ctr-low` | The first seconds do not earn a tap | New opening shot; price, location and "virtual tours available" as on-screen text in the first 2 s; captioned |
| `lpv-low` | Taps that never load the page | Placements as above; keep the landing page light |
| `frequency` | The same people see the ad 3+ times | Add a second creative or widen locations |
| `pacing` | Budget not spent | Check Delivery column, audience size, bid caps, ad review status |
| `learning` | Ad set restarted learning after an edit | Do not edit for 48 h unless something is broken |
| `ab-key-metric` | The A/B test judges on a metric unrelated to buyers | Judge with this report; next test: key metric "Cost per landing page view" or "Cost per lead" |
| `ab-duration` | The A/B test is shorter than Meta's 7-day minimum | Read its result as directional; schedule the next test for 7+ days (Experiments > Edit schedule changes the reliability of results so far) |
| `ab-budget` | The test's arms get different budgets on some test days (often a budget schedule on one campaign) | Same daily budget for both campaigns on every test day (Campaign > Budget > Budget scheduling) |
| `special-ad-category` | A campaign does not declare the Housing special ad category | Campaign > Special ad categories: Housing, with the countries advertised in |
| `objective-traffic` | Optimising for page loads, not requests | Keep while requests are rare; after 10–20 requests test a Leads campaign on the pixel `Lead` event |
| `ab-*` (positive) | One ad beats the other beyond chance | Reuse the winner's opening and caption; shift budget once both have 100+ page views |
| `day-costlier`, `trend-costlier` | Cost per page view rose beyond daily noise | CTR fell: creative fatigue, refresh the opening or rotate a new cut. CPM rose: auction or audience; widen locations or placements. Page loads fell: placements |
| `day-cheaper`, `trend-cheaper` (positive) | Cost per page view fell beyond daily noise | Keep the setup; if a change was logged in that time, it worked |
| `today-*` | Today so far differs from yesterday at the same hour | Context only; wait for the full day |

Budget rules of thumb: compare campaigns on **cost per engaged visit** and **tour-button clicks** until requests exist;
move budget 70/30 to the leader only when the head-to-head finding is significant; never judge a campaign on less than
two days or 30 landing page views.

## Website

| Finding | What it means | Fix |
|---|---|---|
| `engagement-low` | Visitors leave from the first screen | Make the hero continue the ad (same scene, price, location); keep the tour button visible; check the depth table |
| `form-friction` | Form started but not sent | The form asks only for name + email since 9 Oct 2026; check verification (Turnstile) failures, error answers and the phone layout, and compare with the Meta lead-form campaign |
| `zero-leads-signal` | Zero requests is no longer bad luck | Offer a lighter step next to the tour button (virtual tour, "text me details", floor plan by email); retarget engaged visitors |
| `zero-leads-normal` | Too few page views to expect a request | Keep running; watch engaged visits and tour-button clicks |
| `site-day-better` / `site-day-worse` | More / fewer in-app visitors scrolled past the first screen than the day before | Tie it to the change log: keep a change that helped, revert one that hurt |

Ideas that usually pay off for a single listing (try one at a time, note it in `changes`):

1. **Retarget** people who watched 50%+ of the video or visited the site with a "Book a virtual tour" ad.
2. **Remote buyers**: lead with the virtual-tour option in the ad copy as well as on the page.
3. **Creative variety**: one drone/exterior opening, one interior walk-through, one lifestyle (lanai, evenings) cut.

## Tracking and data

| Finding | What it means | Fix |
|---|---|---|
| `utm-missing` | An ad sends no UTM tags | Ad → Tracking → URL parameters (see `utm-dynamic`) |
| `utm-dynamic` | Hand-typed UTM values | `utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}` |
| `utm-shared` | Two ads shared one `utm_campaign`; GA4 split is estimated | Nothing; disappears once the window starts after the retag |
| `utm-unmapped` | A GA4 campaign value matches no Meta campaign | Add it to `campaigns.local.json` (`utm` or `ignoreUtm`) |
| `campaign-unconfigured` | A Meta campaign has no config entry | Add it to `campaigns.local.json` |
| `ga4-pending` | GA4 has not attributed recent sessions yet | Re-run tomorrow; use Meta and website numbers for today |
| `ga4-capture` | GA4 sees far fewer sessions than Meta page loads | Normal up to ~30% loss; investigate consent or tag loading if it persists after 48 h |
| `pixel-vs-db` | Meta's lead count differs from stored requests | Meta also credits view-through leads; the database is the source of truth |
| `bots` | Data-centre cities (Meta's ad review) in GA4 | Read engagement from the website in-app visits when GA4 disagrees |

// Aggregate, non-identifying funnel events. Event names and parameters pass allowlists, so visitor details
// (name, email, phone, message, requested dates, lead IDs, tokens) can never reach an analytics vendor.
export type AnalyticsEvent =
  | 'property_view'
  | 'gallery_open'
  | 'property_film_start'
  | 'showing_cta_click'
  | 'showing_form_start'
  | 'showing_request_submitted'
  | 'agent_contact_click';

type Params = Partial<Record<'cta_location' | 'contact_method' | 'gallery_name' | 'tour_type', string>>;

const EVENTS = new Set<string>([
  'property_view',
  'gallery_open',
  'property_film_start',
  'showing_cta_click',
  'showing_form_start',
  'showing_request_submitted',
  'agent_contact_click',
]);
const PARAMS = new Set(['cta_location', 'contact_method', 'gallery_name', 'tour_type']);
// Short machine values such as "desktop_header"; free text never passes.
const SAFE_VALUE = /^[a-z0-9_]{1,40}$/;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; callMethod?: (...args: unknown[]) => void; push?: unknown };
    _fbq?: unknown;
    __kpEvents?: { event: string; params: Record<string, string> }[];
  }
}

export function track(event: AnalyticsEvent, params: Params = {}): void {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (PARAMS.has(k) && typeof v === 'string' && SAFE_VALUE.test(v)) clean[k] = v;
  (window.__kpEvents ??= []).push({ event, params: clean });
  // Observational only: a vendor error must never interrupt the visitor.
  try {
    window.gtag?.('event', event, clean);
    // Meta gets only the ad conversions; the Pixel base code in the page head already sent the PageView.
    if (event === 'showing_request_submitted') window.fbq?.('track', 'Lead', { content_name: 'Request Private Showing', ...clean });
    else if (event === 'agent_contact_click' && clean.contact_method === 'phone') window.fbq?.('track', 'Contact', { content_name: 'Call agent', ...clean });
  } catch {
    // analytics is optional
  }
  document.dispatchEvent(new CustomEvent('kp:track', { detail: { event, params: clean } }));
}

function loadScript(src: string): void {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

// The stub (no network) queues events from the very first interaction; gtag.js loads only after the page is idle.
function setupVendors(): string[] {
  const { ga4 } = document.body.dataset;
  const scripts: string[] = [];
  if (ga4 && /^G-[A-Z0-9]{4,20}$/.test(ga4)) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      // gtag.js expects the arguments object itself.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', ga4);
    scripts.push(`https://www.googletagmanager.com/gtag/js?id=${ga4}`);
  }
  return scripts;
}

export function initAnalytics(): void {
  const scripts = setupVendors();
  if (document.querySelector('[data-hero]')) track('property_view');
  if (scripts.length) {
    const load = () => scripts.forEach(loadScript);
    const whenIdle = () => ('requestIdleCallback' in window ? requestIdleCallback(load, { timeout: 3000 }) : setTimeout(load, 1));
    if (document.readyState === 'complete') whenIdle();
    else window.addEventListener('load', whenIdle, { once: true });
  }

  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const cta = target?.closest<HTMLElement>('[data-showing-cta]');
    if (cta) track('showing_cta_click', { cta_location: cta.dataset.showingCta });
    const el = target?.closest<HTMLElement>('[data-track]');
    const name = el?.dataset.track;
    if (!el || !name || !EVENTS.has(name)) return;
    const href = el.getAttribute('href') ?? '';
    track(name as AnalyticsEvent, {
      cta_location: el.dataset.trackLocation,
      contact_method: href.startsWith('tel:') ? 'phone' : href.startsWith('mailto:') ? 'email' : /^https?:/.test(href) ? 'website' : undefined,
    });
  });
}

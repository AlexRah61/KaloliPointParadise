// Marketing attribution (last paid touch, 30 days). Stored locally; sent only with a showing request.
const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ttclid'] as const;
const STORE = 'kp_attribution_v1';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type Attribution = Partial<Record<(typeof KEYS)[number] | 'referrer' | 'landing_page', string>>;

interface Stored {
  at: number;
  data: Attribution;
}

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    return Date.now() - parsed.at < TTL_MS ? parsed : null;
  } catch {
    return null;
  }
}

function write(data: Attribution): void {
  try {
    localStorage.setItem(STORE, JSON.stringify({ at: Date.now(), data } satisfies Stored));
  } catch {
    /* storage unavailable (private mode): attribution falls back to this page view */
  }
}

function externalReferrer(): string {
  const ref = document.referrer;
  if (!ref) return '';
  try {
    return new URL(ref).origin === location.origin ? '' : ref.slice(0, 500);
  } catch {
    return '';
  }
}

export function captureAttribution(): void {
  const params = new URL(location.href).searchParams;
  const fromUrl: Attribution = {};
  for (const k of KEYS) {
    const v = params.get(k);
    if (v) fromUrl[k] = v.slice(0, 200);
  }
  const referrer = externalReferrer();
  const existing = read();
  const landing = (location.pathname + location.search).slice(0, 500);

  if (Object.keys(fromUrl).length > 0) {
    write({ ...fromUrl, referrer: referrer || undefined, landing_page: landing });
  } else if (!existing) {
    write({ referrer: referrer || undefined, landing_page: landing });
  } else if (referrer && !existing.data.referrer && !hasPaid(existing.data)) {
    write({ ...existing.data, referrer });
  }
}

function hasPaid(a: Attribution): boolean {
  return KEYS.some((k) => !!a[k]);
}

export function getAttribution(): Attribution {
  return read()?.data ?? { referrer: externalReferrer() || undefined, landing_page: (location.pathname + location.search).slice(0, 500) };
}

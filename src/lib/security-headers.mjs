// Security headers shared by tools/gen-headers.mjs (static files via _headers) and the Worker (HTML pages).
// HTML gets a per-response CSP nonce so Cloudflare can mark the scripts it injects (Bot Fight Mode's
// JavaScript Detections) instead of the policy needing 'unsafe-inline'.

/**
 * @param {{ ga?: boolean, meta?: boolean, noindex?: boolean, nonce?: string }} [options]
 * @returns {[string, string][]}
 */
export function securityHeaders({ ga = false, meta = false, noindex = false, nonce } = {}) {
  /** @param {(string | false | undefined)[]} xs */
  const src = (...xs) => xs.filter(Boolean).join(' ');
  const csp = [
    "default-src 'self'",
    `script-src ${src(
      "'self'",
      nonce && `'nonce-${nonce}'`,
      'https://challenges.cloudflare.com',
      // Cloudflare Web Analytics beacon, auto-injected at the edge; it reports to this site's /cdn-cgi/rum ('self').
      'https://static.cloudflareinsights.com',
      ga && 'https://www.googletagmanager.com',
      meta && 'https://connect.facebook.net',
    )}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${src("'self'", 'data:', 'blob:', ga && 'https://*.google-analytics.com https://*.googletagmanager.com', meta && 'https://www.facebook.com')}`,
    "font-src 'self'",
    "media-src 'self' blob:",
    `connect-src ${src("'self'", 'https://challenges.cloudflare.com', ga && 'https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com', meta && 'https://www.facebook.com https://connect.facebook.net')}`,
    // Turnstile, and the keyless Google Maps embed in the location section.
    'frame-src https://challenges.cloudflare.com https://www.google.com',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  /** @type {[string, string][]} */
  const headers = [
    ['Content-Security-Policy', csp],
    ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
  ];
  if (noindex) headers.push(['X-Robots-Tag', 'noindex, nofollow']);
  return headers;
}

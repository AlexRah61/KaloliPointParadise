// Small-sample statistics for funnel rates (no dependencies).

// Standard normal CDF (Abramowitz & Stegun 26.2.17, |error| < 7.5e-8).
export function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

// Two-sided two-proportion z-test. Returns null when either group is empty.
export function twoProportion(x1, n1, x2, n2) {
  if (!(n1 > 0) || !(n2 > 0)) return null;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (!se) return { p1, p2, z: 0, pValue: 1 };
  const z = (p1 - p2) / se;
  return { p1, p2, z, pValue: 2 * (1 - normalCdf(Math.abs(z))) };
}

// Wilson score interval for x successes out of n.
export function wilson(x, n, z = 1.96) {
  if (!(n > 0)) return null;
  const p = x / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

// Chance of seeing zero conversions in n tries when the true rate is p.
export const chanceOfZero = (n, p) => Math.pow(1 - p, n);

// P(X <= k) for X ~ Binomial(n, p).
export function binomialCdf(k, n, p) {
  let term = Math.pow(1 - p, n);
  let total = term;
  for (let i = 1; i <= k; i++) {
    term *= ((n - i + 1) / i) * (p / (1 - p));
    total += term;
  }
  return Math.min(1, total);
}

// Tries needed before zero conversions becomes unlikely (1 - confidence) at rate p.
export const triesForEvidence = (p, confidence = 0.95) => Math.ceil(Math.log(1 - confidence) / Math.log(1 - p));

export const ratio = (a, b) => (b > 0 && Number.isFinite(a) ? a / b : null);

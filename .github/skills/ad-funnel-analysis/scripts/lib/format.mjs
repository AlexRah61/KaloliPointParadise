// Number formatting for reports. Missing values render as an en dash, never "NaN" or "undefined".
const DASH = '–';
const ok = (v) => typeof v === 'number' && Number.isFinite(v);

export const int = (v) => (ok(v) ? Math.round(v).toLocaleString('en-US') : DASH);
export const num = (v, digits = 1) => (ok(v) ? v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : DASH);
export const money = (v) => (ok(v) ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : DASH);
export function pct(v, digits = 1) {
  if (!ok(v)) return DASH;
  const p = v * 100;
  const d = p !== 0 && Math.abs(p) < 1 && digits < 2 ? 2 : digits;
  return `${p.toFixed(d)}%`;
}
export function signed(v, f = int) {
  if (!ok(v)) return DASH;
  const s = f(Math.abs(v));
  if (s === f(0)) return `±${s}`;
  return `${v > 0 ? '+' : '−'}${s}`;
}
export function seconds(v) {
  if (!ok(v)) return DASH;
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}
export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const escapeMd = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

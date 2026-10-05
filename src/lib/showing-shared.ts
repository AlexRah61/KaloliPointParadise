// Pure helpers shared by the showing form (browser) and the API (Worker).
export const TIME_ZONE_LABEL = 'HST';
export const MAX_DAYS_AHEAD = 120;
export const SLOT_START_MIN = 9 * 60;
export const SLOT_END_MIN = 17 * 60 + 30;
// Turnstile action rendered by the form and required by siteverify on the server.
export const TURNSTILE_ACTION = 'showing_request';

// Honeypot filled or an impossible fill time: the API answers with a decoy success and stores nothing.
export const isLikelyBot = (company: string | undefined, elapsedMs: number | undefined): boolean =>
  (company ?? '').trim() !== '' || (elapsedMs !== undefined && elapsedMs > 0 && elapsedMs < 800);

export function slotValues(): string[] {
  const out: string[] = [];
  for (let m = SLOT_START_MIN; m <= SLOT_END_MIN; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

// Hawaiʻi does not observe daylight saving: HST is always UTC−10.
export function hstToday(now = Date.now()): string {
  return new Date(now - 10 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function dateLabel(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

export function timeLabel(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function slotLabel(isoDate?: string | null, hhmm?: string | null): string {
  if (!isoDate || !hhmm) return '';
  return `${dateLabel(isoDate)} · ${timeLabel(hhmm)} ${TIME_ZONE_LABEL}`;
}

export function phoneDigits(v: string): string {
  return v.replace(/\D/g, '');
}

export const TOUR_LABEL: Record<'in_person' | 'video', string> = {
  in_person: 'In person',
  video: 'Live video tour',
};

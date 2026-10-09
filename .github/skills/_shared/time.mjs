// Time-zone helpers shared by skills (IANA zones via Intl; no dependencies).

// UTC instant of local midnight at the start of `date` (yyyy-MM-dd) in `timeZone`.
export function zonedMidnightUtc(date, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 2; i++) guess = Date.UTC(y, m - 1, d) - offsetMs(guess, timeZone);
  return new Date(guess);
}

export function offsetMs(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(instant / 1000) * 1000;
}

export function zonedDate(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
}

export function zonedHour(instant, timeZone) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit' }).format(new Date(instant)));
}

export function zonedLabel(instant, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(instant));
}

export function addDays(date, n) {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function datesBetween(since, until) {
  const out = [];
  for (let d = since; d <= until; d = addDays(d, 1)) out.push(d);
  return out;
}

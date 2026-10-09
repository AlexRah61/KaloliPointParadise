// File names and safety checks for the report PDFs kept in the (public) repository.
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]+/g;

// "<campaign names>_report <yyyy-MM-dd>_extracted <yyyy-MM-dd> <HHmm> <TZ>.pdf": grouped by campaign, then by report date,
// then by extraction time, so several runs on one day sort in order and never overwrite each other.
export function pdfName({ campaigns, reportDate, extractedAt, timeZone }) {
  const names = campaigns.map((n) => String(n).replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const base = (names.join(' + ') || 'Ad report').slice(0, 120).trim();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' })
      .formatToParts(new Date(extractedAt))
      .map((p) => [p.type, p.value]),
  );
  const tz = (parts.timeZoneName ?? '').replace(/[^A-Za-z0-9+-]/g, '');
  return `${base}_report ${reportDate}_extracted ${parts.year}-${parts.month}-${parts.day} ${parts.hour}${parts.minute}${tz ? ` ${tz}` : ''}.pdf`;
}

// Values from the local config that identify accounts (long digit runs, hex keys, Turnstile keys).
export function configIds(value, out = []) {
  if (value && typeof value === 'object') for (const v of Object.values(value)) configIds(v, out);
  else if ((typeof value === 'string' || typeof value === 'number') && /\d{5,}|^[0-9a-f]{20,}$|^0x[\w-]{10,}$/i.test(String(value))) out.push(String(value));
  return out;
}

const mask = (s) => (s.length <= 6 ? '***' : `${s.slice(0, 3)}...${s.slice(-2)}`);

// Anything that must not reach a public file: account IDs, email addresses, phone numbers, IP addresses, local paths.
export function sensitiveMatches(html, ids = []) {
  const text = String(html).replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, '');
  const found = [];
  for (const id of new Set(ids)) if (id.length >= 6 && text.includes(id)) found.push(`account or campaign ID ${mask(id)}`);
  const patterns = [
    ['email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g],
    ['phone number', /(?<![\d,.$])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\d,])/g],
    ['IP address', /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g],
    ['local file path', /\b[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s<"']+/gi],
  ];
  for (const [what, re] of patterns) for (const m of text.match(re) ?? []) found.push(`${what} ${mask(m)}`);
  return found;
}

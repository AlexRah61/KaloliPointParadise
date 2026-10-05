import { z } from 'zod';
import { addDays, hstToday, isIsoDate, MAX_DAYS_AHEAD, phoneDigits, slotValues } from '../showing-shared';

const SLOTS = slotValues() as [string, ...string[]];
const RANGE_MSG = `Choose a date between today and ${MAX_DAYS_AHEAD} days from now.`;
// Evaluated per request so "today" is always the current Hawaiʻi date.
const inRange = (d: string) => {
  const today = hstToday();
  return d >= today && d <= addDays(today, MAX_DAYS_AHEAD);
};
const isoDate = z.string().trim().refine(isIsoDate, 'Choose a valid date.').refine(inRange, RANGE_MSG);
const short = (max: number) => z.string().trim().max(max).optional();

export const AttributionSchema = z
  .object({
    utm_source: short(200),
    utm_medium: short(200),
    utm_campaign: short(200),
    utm_content: short(200),
    utm_term: short(200),
    gclid: short(200),
    fbclid: short(200),
    ttclid: short(200),
    referrer: short(500),
    landing_page: short(500),
  })
  .partial();

export const CTA_ORIGINS = [
  'hero',
  'desktop_header',
  'mobile_sticky',
  'menu',
  'property_details',
  'lanais',
  'grounds',
  'gallery',
  'film',
  'final_cta',
  'footer',
  'not_found',
  'inline_form',
] as const;

export const ShowingRequestSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name.').max(100, 'Please shorten your name.'),
    phone: z
      .string()
      .trim()
      .max(30)
      .refine((v) => {
        const n = phoneDigits(v).length;
        return n >= 10 && n <= 15;
      }, 'Enter a phone number the agent can call, including area code.'),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address.')),
    preferredDate: isoDate,
    preferredTime: z.enum(SLOTS, 'Choose a preferred time.'),
    alternateDate: isoDate.optional(),
    alternateTime: z.enum(SLOTS, 'Choose a valid alternative time.').optional(),
    flexible: z.boolean().default(false),
    tourType: z.enum(['in_person', 'video']).default('in_person'),
    message: z.string().trim().max(1000, 'Please keep the message under 1,000 characters.').optional(),
    company: z.string().max(200).optional(),
    elapsedMs: z.number().int().min(0).max(7 * 86_400_000).optional(),
    turnstileToken: z.string().min(1).max(2048),
    // Analytics only: an unexpected value is dropped rather than rejecting the request.
    ctaOrigin: z.enum(CTA_ORIGINS).optional().catch(undefined),
    attribution: AttributionSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.alternateDate && !v.alternateTime) {
      ctx.addIssue({ code: 'custom', path: ['alternateTime'], message: 'Choose a time for your alternative date.' });
    }
    if (v.alternateTime && !v.alternateDate) {
      ctx.addIssue({ code: 'custom', path: ['alternateDate'], message: 'Choose a date for your alternative time.' });
    }
  });

export type ShowingRequest = z.infer<typeof ShowingRequestSchema>;

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

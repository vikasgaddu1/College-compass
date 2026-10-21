/** Pure validation/normalization of the profile form (mirrors the DB checks so saves don't bounce). */
import { sanitizeEmail, sanitizePhone, sanitizeWebsite } from "@/data/counselors";
import { BIO_MAX } from "./constants";
import type { Draft } from "./api";

export type FieldErrors = Partial<Record<keyof Draft | "contact", string>>;

const nn = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

/** Trim everything; normalize the website to https://…; lower-case the email. */
export function normalizeDraft(d: Draft): Draft {
  const website = nn(d.website);
  return {
    name: nn(d.name),
    title: nn(d.title),
    photo_url: nn(d.photo_url),
    bio: nn(d.bio),
    website: website ? sanitizeWebsite(website) ?? website : null,
    phone: nn(d.phone),
    email: nn(d.email)?.toLowerCase() ?? null,
    city: nn(d.city),
    states: Array.from(new Set(d.states.map((s) => s.trim().toUpperCase()).filter(Boolean))),
    specialties: Array.from(new Set(d.specialties)),
    modes: Array.from(new Set(d.modes)),
    credentials: nn(d.credentials),
  };
}

/** Errors that block saving (format problems). Completeness is checked separately for submission. */
export function validateDraft(d: Draft): FieldErrors {
  const e: FieldErrors = {};
  if (d.name && d.name.length > 120) e.name = "Keep your name under 120 characters.";
  if (d.title && d.title.length > 120) e.title = "Keep the title under 120 characters.";
  if (d.bio && d.bio.length > BIO_MAX) e.bio = `The bio can be at most ${BIO_MAX} characters.`;
  if (d.credentials && d.credentials.length > 300) e.credentials = "Keep credentials under 300 characters.";
  if (d.city && d.city.length > 80) e.city = "Keep the city under 80 characters.";
  if (d.website && !sanitizeWebsite(d.website)) e.website = "Enter a full web address, like https://yourpractice.com.";
  if (d.phone && !sanitizePhone(d.phone)) e.phone = "Enter a phone number with digits only, like (919) 555-0100.";
  if (d.email && !sanitizeEmail(d.email)) e.email = "That doesn't look like an email address.";
  return e;
}

/** What's still missing before the profile can be submitted (same rule as the backend). */
export function missingForSubmit(d: Draft): string[] {
  const out: string[] = [];
  if (!d.name) out.push("your name");
  if (!d.bio) out.push("a bio");
  if (!d.states.length) out.push("at least one state (or nationwide)");
  if (!d.specialties.length) out.push("at least one specialty");
  if (!d.modes.length) out.push("how you meet families (virtual / in person)");
  if (!d.website && !d.phone && !d.email) out.push("a way to contact you (website, phone or email)");
  return out;
}

/** True when the draft differs from the published snapshot (what `has_changes` will be). */
export function draftDiffers(draft: Draft, published: Draft | null): boolean {
  if (!published) return false;
  const norm = (x: Draft) => JSON.stringify({ ...x, states: [...x.states].sort(), specialties: [...x.specialties].sort(), modes: [...x.modes].sort() });
  return norm(normalizeDraft(draft)) !== norm(normalizeDraft({ ...EMPTY_LIKE, ...published }));
}
const EMPTY_LIKE: Draft = { name: null, title: null, photo_url: null, bio: null, website: null, phone: null, email: null, city: null, states: [], specialties: [], modes: [], credentials: null };

/** Field-by-field differences for the admin's draft-vs-published view. */
export function diffFields(draft: Draft, published: Draft | null): (keyof Draft)[] {
  if (!published) return [];
  const keys = Object.keys(EMPTY_LIKE) as (keyof Draft)[];
  const a = normalizeDraft(draft);
  const b = normalizeDraft({ ...EMPTY_LIKE, ...published });
  return keys.filter((k) => {
    const x = a[k];
    const y = b[k];
    if (Array.isArray(x) && Array.isArray(y)) return [...x].sort().join("|") !== [...y].sort().join("|");
    return (x ?? null) !== (y ?? null);
  });
}

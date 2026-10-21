/**
 * Paid counselor directory — the app's read-only view (docs/COUNSELORS_CONTRACT.md).
 *
 * Anonymous PostgREST calls with the project's publishable key, plain `fetch` (no supabase-js in the
 * app bundle). The app sends no student data here: only the chosen state and specialty filters.
 * Everything that comes back is sanitized before it reaches the UI — listings are written by paying
 * counselors, so a website must be http(s), a phone must look like a phone, and so on.
 */
import type { MajorArea } from "../types";
import { sharedConfig } from "./shared";

export const SPECIALTIES = [
  { id: "stem", label: "STEM" },
  { id: "engineering", label: "Engineering" },
  { id: "arts", label: "Arts & performing" },
  { id: "athletics", label: "Athletics" },
  { id: "international", label: "International" },
  { id: "financial_aid", label: "Financial aid" },
  { id: "essays", label: "Essays" },
  { id: "test_prep", label: "Test prep" },
  { id: "transfer", label: "Transfer" },
  { id: "learning_differences", label: "Learning differences" },
  { id: "first_gen", label: "First-gen" },
  { id: "general", label: "General" },
] as const;
export type Specialty = (typeof SPECIALTIES)[number]["id"];
export const SPECIALTY_IDS: readonly string[] = SPECIALTIES.map((s) => s.id);

export function specialtyLabel(id: string): string {
  return SPECIALTIES.find((s) => s.id === id)?.label ?? id.replace(/_/g, " ");
}

export const MODES = [
  { id: "virtual", label: "Virtual" },
  { id: "in_person", label: "In person" },
] as const;
export type Mode = (typeof MODES)[number]["id"];

/** 'US' in `states` means the counselor serves students nationwide (virtually). */
export const NATIONWIDE = "US";

export const REPORT_REASONS = [
  { id: "inappropriate", label: "Inappropriate content or behavior" },
  { id: "misleading", label: "Misleading claims or credentials" },
  { id: "unresponsive", label: "Never responded" },
  { id: "other", label: "Something else" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

/** One published listing as the directory shows it (already sanitized). */
export interface Counselor {
  id: string;
  name: string;
  title: string | null;
  photo_url: string | null;
  bio: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  states: string[];
  specialties: string[];
  modes: string[];
  credentials: string | null;
}

/** Specialty chips to preselect from the student's majors (empty = "All"). */
export function specialtiesForMajors(majors: readonly MajorArea[]): Specialty[] {
  const out = new Set<Specialty>();
  for (const m of majors) {
    if (m === "engineering" || m === "robotics_mechatronics" || m === "aerospace") {
      out.add("engineering");
      out.add("stem");
    } else if (m === "computer_science" || m === "math_stats" || m === "data_science" || m === "physical_sciences") out.add("stem");
    else if (m === "arts_design" || m === "performing_arts" || m === "film_media") out.add("arts");
  }
  return Array.from(out);
}

/** "Jane Q. Public" → "JP"; a single word gives its first two letters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const str = (v: unknown, max = 400): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

/** http(s) only; anything else (javascript:, data:, file:, bare text) is dropped. */
export function sanitizeWebsite(v: unknown): string | null {
  const s = str(v, 2000);
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname || !u.hostname.includes(".")) return null;
    u.username = "";
    u.password = "";
    return u.href;
  } catch {
    return null;
  }
}

/** Digits, +, spaces, parentheses, dashes and dots only; at least 7 digits. */
export function sanitizePhone(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  if (!/^[+(\d][\d\s().-]*$/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return s;
}

/** `tel:` target for a sanitized phone: keep a leading + and the digits. */
export function telHref(phone: string): string {
  const plus = phone.trim().startsWith("+") ? "+" : "";
  return `tel:${plus}${phone.replace(/\D/g, "")}`;
}

export function sanitizeEmail(v: unknown): string | null {
  const s = str(v, 254);
  if (!s) return null;
  // Strict enough that the value can only ever be an address (no "mailto:", "?subject=" or spaces).
  return /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(s) ? s : null;
}

/** https photo URLs only (the storage bucket is https); anything else falls back to initials. */
export function sanitizePhotoUrl(v: unknown): string | null {
  const s = str(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

const strArray = (v: unknown, allowed?: readonly string[], max = 12): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = x.trim();
    if (!s || (allowed && !allowed.includes(s)) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
};

/** Hostname of a sanitized website, without "www." (for a quiet hint under the button). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Turn a raw API row into a `Counselor`; null when it lacks an id or a name. */
export function toCounselor(row: unknown): Counselor | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = str(r.id, 64);
  const name = str(r.name, 80);
  if (!id || !name) return null;
  return {
    id,
    name,
    title: str(r.title, 120),
    photo_url: sanitizePhotoUrl(r.photo_url),
    bio: str(r.bio, 1200),
    website: sanitizeWebsite(r.website),
    phone: sanitizePhone(r.phone),
    email: sanitizeEmail(r.email),
    city: str(r.city, 80),
    states: strArray(r.states).filter((s) => /^[A-Z]{2}$/.test(s)),
    specialties: strArray(r.specialties, SPECIALTY_IDS),
    modes: strArray(r.modes, ["virtual", "in_person"]),
    credentials: str(r.credentials, 300),
  };
}

export type DirectoryError = "offline" | "unavailable" | "rate_limited" | "gone";

export interface DirectoryApi {
  /** Listed counselors for a state (null = everywhere) and specialties (empty = all). Throws a DirectoryError string. */
  list(state: string | null, specialties: string[], signal?: AbortSignal): Promise<Counselor[]>;
  report(counselorId: string, reason: ReportReason, detail: string | null): Promise<void>;
}

type Fetch = typeof fetch;

/** Null when shared data is off (unit tests, the mocked e2e build): the screen shows "unavailable". */
export function createDirectoryApi(cfg = sharedConfig(), doFetch: Fetch = (...a) => globalThis.fetch(...a), timeoutMs = 8000): DirectoryApi | null {
  if (!cfg) return null;
  const headers = { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json", Accept: "application/json" };
  const post = async (fn: string, body: unknown, signal?: AbortSignal): Promise<unknown> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const onAbort = () => ctl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      let res: Response;
      try {
        res = await doFetch(`${cfg.url}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body), signal: ctl.signal });
      } catch {
        throw "offline" satisfies DirectoryError;
      }
      if (!res.ok) throw "unavailable" satisfies DirectoryError;
      try {
        return await res.json();
      } catch {
        return null;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  };
  return {
    async list(state, specialties, signal) {
      const rows = await post("counselor_directory", { p_state: state, p_specialties: specialties.length ? specialties : null }, signal);
      if (!Array.isArray(rows)) return [];
      return rows.map(toCounselor).filter((c): c is Counselor => c !== null);
    },
    async report(counselorId, reason, detail) {
      const res = (await post("report_counselor", { p_counselor: counselorId, p_reason: reason, p_detail: detail?.trim() ? detail.trim().slice(0, 1000) : null })) as { ok?: boolean; reason?: string } | null;
      // The RPC answers 200 with { ok: false, reason } when it didn't store the report.
      if (!res || res.ok !== true) {
        if (res?.reason === "rate_limited") throw "rate_limited" satisfies DirectoryError;
        if (res?.reason === "unknown_counselor") throw "gone" satisfies DirectoryError;
        throw "unavailable" satisfies DirectoryError;
      }
    },
  };
}

/**
 * Fit score: five 0..1 components, combined 0..100 by the student's priorities (0–5 each).
 * Unknown data → neutral (≈0.5) so missing research never silently sinks or boosts a college.
 */
import type { College, FitBreakdown, MajorArea, OddsResult, StudentProfile } from "../types";
import { clamp01, interp, mean, rate, usd } from "./math";
import { programFor } from "./odds";
import { distanceFromHome } from "./geo";

export type ShareKey = keyof College["program_share"];

/**
 * Every MajorArea → closest program_share keys. The first key is the exact match;
 * later keys are proxies (credited at PROXY_SHARE_WEIGHT) when the exact share is missing.
 */
export const MAJOR_TO_SHARE_KEYS: Readonly<Record<Exclude<MajorArea, "undecided">, readonly ShareKey[]>> = {
  computer_science: ["computer_science", "data_science"],
  engineering: ["engineering", "aerospace"],
  robotics_mechatronics: ["engineering", "computer_science"],
  math_stats: ["math_stats", "data_science"],
  physical_sciences: ["physical_sciences", "environmental_science"],
  biology: ["biology", "health"],
  health: ["health", "nursing", "public_health", "biology"],
  business: ["business", "economics_social"],
  economics_social: ["economics_social", "political_science_law", "business"],
  psychology: ["psychology", "economics_social"],
  communication: ["communication", "film_media"],
  english_humanities: ["english_humanities", "history_philosophy", "languages_international"],
  arts_design: ["arts_design", "architecture", "film_media"],
  education: ["education"],
  data_science: ["data_science", "math_stats", "computer_science"],
  nursing: ["nursing", "health"],
  public_health: ["public_health", "health"],
  political_science_law: ["political_science_law", "economics_social", "history_philosophy"],
  environmental_science: ["environmental_science", "biology", "physical_sciences", "agriculture_food"],
  architecture: ["architecture", "arts_design", "engineering"],
  performing_arts: ["performing_arts", "arts_design"],
  film_media: ["film_media", "communication", "arts_design"],
  history_philosophy: ["history_philosophy", "english_humanities"],
  languages_international: ["languages_international", "english_humanities", "political_science_law"],
  agriculture_food: ["agriculture_food", "biology", "environmental_science"],
  kinesiology_sports: ["kinesiology_sports", "health"],
  aerospace: ["aerospace", "engineering"],
};

/** Share of degrees in the area → academics score. */
export const SHARE_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.45], [0.02, 0.55], [0.05, 0.65], [0.1, 0.78], [0.2, 0.9], [0.3, 0.95],
];
export const PROXY_SHARE_WEIGHT = 0.6;
export const PROGRAM_OFFERED_SCORE = 0.85;
export const PROGRAM_DEGREE_BONUS = 0.1;
export const PROGRAM_NOT_OFFERED_SCORE = 0.1;
/** Share data exists for other areas but not this one. */
export const SHARE_MISSING_SCORE = 0.4;
export const UNDECIDED_BASE = 0.6;
export const UNDECIDED_BREADTH_PER_AREA = 0.04;
export const UNDECIDED_BREADTH_MAX = 0.25;
/** Weights for primary / secondary majors. */
export const MAJOR_WEIGHTS: Readonly<Record<1 | 2 | 3, readonly number[]>> = {
  1: [1], 2: [0.6, 0.4], 3: [0.6, 0.2, 0.2],
};

/** Net price ÷ budget → affordability. */
export const BUDGET_RATIO_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0.8, 1.0], [1.0, 0.85], [1.25, 0.5], [1.5, 0.25], [2.0, 0.05],
];
/** No budget given: score by price level (USD/yr). */
export const PRICE_LEVEL_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [15000, 0.95], [25000, 0.8], [35000, 0.6], [50000, 0.4], [70000, 0.2], [90000, 0.1],
];
export const GRAD_RATE_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0.4, 0.2], [0.6, 0.5], [0.8, 0.8], [0.95, 1.0],
];
/** Freshman retention as a stand-in when the grad rate is missing. */
export const RETENTION_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0.6, 0.2], [0.75, 0.5], [0.88, 0.8], [0.97, 1.0],
];
export const EARNINGS_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [35000, 0.2], [50000, 0.5], [70000, 0.75], [90000, 0.9], [110000, 1.0],
];
/** p (admission estimate) → odds component; rises steeply then saturates. */
export const ODDS_FIT_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0.01, 0.05], [0.15, 0.35], [0.35, 0.6], [0.65, 0.85], [0.85, 1.0],
];
/** Location: neutral value when the student has no location preferences or data is missing. */
export const LOCATION_NEUTRAL = 0.75;
export const UNKNOWN_COMPONENT = 0.6;

// ───────────────────────────── Academics ─────────────────────────────

function shares(c: College): Partial<Record<ShareKey, number>> {
  const s = c.program_share;
  return s && typeof s === "object" ? s : {};
}

function hasAnyShare(c: College): boolean {
  return Object.values(shares(c)).some((v) => (rate(v) ?? 0) > 0);
}

/** Share for a major (exact key, else best proxy × PROXY_SHARE_WEIGHT). null when unknown. */
export function shareFor(c: College, major: MajorArea): { share: number; exact: boolean } | null {
  if (major === "undecided") return null;
  const keys = MAJOR_TO_SHARE_KEYS[major];
  if (!keys) return null;
  const s = shares(c);
  const exact = rate(s[keys[0]!]);
  if (exact != null && exact > 0) return { share: exact, exact: true };
  let best = 0;
  for (const k of keys.slice(1)) best = Math.max(best, rate(s[k]) ?? 0);
  return best > 0 ? { share: best * PROXY_SHARE_WEIGHT, exact: false } : null;
}

export function majorScore(c: College, major: MajorArea): number {
  if (major === "undecided") return undecidedScore(c);
  const note = programFor(c, major);
  if (note && note.offered === true) {
    let s = PROGRAM_OFFERED_SCORE + (note.degree ? PROGRAM_DEGREE_BONUS : 0);
    const sh = shareFor(c, major);
    if (sh && sh.share >= 0.1) s += 0.05;
    return clamp01(s);
  }
  if (note && note.offered === false) return PROGRAM_NOT_OFFERED_SCORE;
  const sh = shareFor(c, major);
  if (sh) return interp(sh.share, SHARE_KNOTS);
  return hasAnyShare(c) ? SHARE_MISSING_SCORE : 0.5;
}

function undecidedScore(c: College): number {
  const s = shares(c);
  let n = Object.values(s).filter((v) => (rate(v) ?? 0) >= 0.03).length;
  if (Array.isArray(c.programs)) n += c.programs.filter((p) => p && p.offered).length;
  return clamp01(UNDECIDED_BASE + Math.min(UNDECIDED_BREADTH_MAX, n * UNDECIDED_BREADTH_PER_AREA));
}

export function cleanMajors(profile: StudentProfile): MajorArea[] {
  const raw = Array.isArray(profile.majors) ? profile.majors : [];
  const out: MajorArea[] = [];
  for (const m of raw) if (m && !out.includes(m)) out.push(m);
  return out.length ? out.slice(0, 3) : ["undecided"];
}

export function academicsScore(c: College, profile: StudentProfile): number {
  const majors = cleanMajors(profile);
  const w = MAJOR_WEIGHTS[majors.length as 1 | 2 | 3];
  let s = 0;
  majors.forEach((m, i) => { s += (w[i] ?? 0) * majorScore(c, m); });
  return clamp01(s);
}

// ───────────────────────────── Affordability / outcomes ─────────────────────────────

export function affordabilityScore(netPrice: number | null, budget: number | null): number {
  if (netPrice == null || !Number.isFinite(netPrice)) return 0.5;
  const b = usd(budget);
  if (b != null && b > 0) return interp(netPrice / b, BUDGET_RATIO_KNOTS);
  if (b === 0) return netPrice <= 0 ? 1 : interp(netPrice, PRICE_LEVEL_KNOTS) * 0.5;
  return interp(netPrice, PRICE_LEVEL_KNOTS);
}

export function outcomesScore(c: College): number {
  const grad = rate(c.grad_rate_6yr);
  const ret = rate(c.retention_rate);
  const gradScore = grad != null ? interp(grad, GRAD_RATE_KNOTS) : ret != null ? interp(ret, RETENTION_KNOTS) : null;
  const earn = usd(c.median_earnings_10yr);
  const earnScore = earn != null && earn > 0 ? interp(earn, EARNINGS_KNOTS) : null;
  if (gradScore != null && earnScore != null) return 0.6 * gradScore + 0.4 * earnScore;
  return gradScore ?? earnScore ?? 0.5;
}

// ───────────────────────────── Location ─────────────────────────────

export type SizeBucket = "small" | "medium" | "large";
export function sizeBucket(n: number | null | undefined): SizeBucket | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n < 5000 ? "small" : n <= 15000 ? "medium" : "large";
}

export interface LocationChecks {
  /** true = matches, false = mismatch, null = no preference or unknown */
  region: boolean | null;
  size: boolean | null;
  setting: boolean | null;
  ownership: boolean | null;
  distance: { miles: number; within: boolean } | null;
}

export function locationChecks(c: College, profile: StudentProfile): LocationChecks {
  const regions = Array.isArray(profile.regions) ? profile.regions : [];
  const bucket = sizeBucket(c.undergrad_size);
  const maxD = usd(profile.max_distance_miles);
  const miles = maxD != null && maxD > 0 ? distanceFromHome(profile.home_state, c) : null;
  return {
    region: regions.length && c.region ? regions.includes(c.region) : null,
    size: profile.size && profile.size !== "any" && bucket ? bucket === profile.size : null,
    setting: profile.setting && profile.setting !== "any" && c.locale ? c.locale === profile.setting : null,
    ownership: profile.ownership && profile.ownership !== "any" && c.ownership ? c.ownership === profile.ownership : null,
    distance: miles != null && maxD != null ? { miles, within: miles <= maxD } : null,
  };
}

const SIZE_ORDER: readonly SizeBucket[] = ["small", "medium", "large"];
const SETTING_ORDER = ["city", "suburb", "town", "rural"] as const;

export function locationScore(c: College, profile: StudentProfile): number {
  const parts: number[] = [];
  const regions = Array.isArray(profile.regions) ? profile.regions : [];
  if (regions.length) parts.push(c.region ? (regions.includes(c.region) ? 1 : 0.2) : UNKNOWN_COMPONENT);

  if (profile.size && profile.size !== "any") {
    const b = sizeBucket(c.undergrad_size);
    if (!b) parts.push(UNKNOWN_COMPONENT);
    else {
      const gap = Math.abs(SIZE_ORDER.indexOf(b) - SIZE_ORDER.indexOf(profile.size));
      parts.push(gap === 0 ? 1 : gap === 1 ? 0.5 : 0.15);
    }
  }
  if (profile.setting && profile.setting !== "any") {
    if (!c.locale) parts.push(UNKNOWN_COMPONENT);
    else {
      const gap = Math.abs(SETTING_ORDER.indexOf(c.locale) - SETTING_ORDER.indexOf(profile.setting));
      parts.push(gap === 0 ? 1 : gap === 1 ? 0.6 : 0.25);
    }
  }
  if (profile.ownership && profile.ownership !== "any") {
    parts.push(c.ownership ? (c.ownership === profile.ownership ? 1 : 0.3) : UNKNOWN_COMPONENT);
  }
  const maxD = usd(profile.max_distance_miles);
  if (maxD != null && maxD > 0) {
    const d = distanceFromHome(profile.home_state, c);
    parts.push(d == null ? UNKNOWN_COMPONENT : d <= maxD ? 1 : d <= 1.5 * maxD ? 0.5 : 0.1);
  }
  return parts.length ? clamp01(mean(parts) ?? LOCATION_NEUTRAL) : LOCATION_NEUTRAL;
}

// ───────────────────────────── Total ─────────────────────────────

export function oddsFitScore(odds: Pick<OddsResult, "p">): number {
  const p = Number.isFinite(odds.p) ? odds.p : 0.3;
  return interp(p, ODDS_FIT_KNOTS);
}

function weight(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(5, x)) : 0;
}

export function scoreFit(
  college: College,
  profile: StudentProfile,
  odds: OddsResult,
  netPrice: number | null,
): FitBreakdown {
  const academics = academicsScore(college, profile);
  const affordability = affordabilityScore(netPrice, profile.budget_per_year);
  const outcomes = outcomesScore(college);
  const location = locationScore(college, profile);
  const oddsC = oddsFitScore(odds);

  const pr = profile.priorities ?? ({} as StudentProfile["priorities"]);
  let w = [weight(pr.academics_fit), weight(pr.affordability), weight(pr.outcomes), weight(pr.location), weight(pr.odds)];
  if (w.every((x) => x === 0)) w = [1, 1, 1, 1, 1];
  const comps = [academics, affordability, outcomes, location, oddsC];
  const sumW = w.reduce((a, b) => a + b, 0);
  const total = comps.reduce((acc, c, i) => acc + c * w[i]!, 0) / sumW;

  const r = (x: number) => Math.round(clamp01(Number.isFinite(x) ? x : 0.5) * 1000) / 1000;
  return {
    academics: r(academics),
    affordability: r(affordability),
    outcomes: r(outcomes),
    location: r(location),
    odds: r(oddsC),
    total: Math.round(clamp01(Number.isFinite(total) ? total : 0.5) * 1000) / 10,
  };
}

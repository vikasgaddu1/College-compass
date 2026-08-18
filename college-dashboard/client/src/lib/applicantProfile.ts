// Applicant profile + odds thresholds — localStorage-backed for signed-out use.
// When Supabase is configured and the user is signed in, the SyncPanel handles
// pull/push to `applicant_profile` (workspace-scoped). This module keeps the
// client-side heuristic model stable across both modes.

import { useEffect, useState, useCallback } from "react";

export interface ApplicantProfile {
  gpa_uw: number | null;
  gpa_w: number | null;
  sat: number | null;
  act: number | null;
  test_plan: "submitting" | "optional_hold" | "not_submitting";
  rigor_note: string;
  home_state: string;      // NC by default

  /**
   * Structured rigor self-report -- the alternative to uploading a transcript.
   * The applicant counts what they have taken; the app compares that to what
   * each school says about rigor in CDS C7. Stays on this device.
   */
  ap_ib_de_completed: number | null;   // finished and graded
  ap_ib_de_planned: number | null;     // scheduled for senior year
  highest_math: HighestMath | null;
  /** What the high school actually offers, so rigor is judged in context. */
  school_offers_advanced: "many" | "some" | "few" | "unknown";
  has_honors_core: boolean;            // honors/advanced across all core subjects
}

export type HighestMath =
  | "below_precalc" | "precalc" | "calc_ab" | "calc_bc" | "beyond_calc";

export const HIGHEST_MATH_LABEL: Record<HighestMath, string> = {
  below_precalc: "Algebra 2 or below",
  precalc: "Precalculus",
  calc_ab: "Calculus AB",
  calc_bc: "Calculus BC",
  beyond_calc: "Beyond calculus (multivariable, linear algebra)",
};

const MATH_POINTS: Record<HighestMath, number> = {
  below_precalc: 0, precalc: 1, calc_ab: 2, calc_bc: 3, beyond_calc: 4,
};

export interface RigorResult {
  index: number | null;                // 1-5, comparable to the other axes
  band: "limited" | "solid" | "strong" | "very strong";
  drivers: string[];
  context_limited: boolean;
}

/**
 * Compose a rigor index from the self-report. Deliberately simple and legible:
 * it is a conversation aid, not a prediction. Course count is capped because
 * beyond a point it stops differentiating, and math level is weighted heavily
 * because engineering admissions care about the calculus sequence specifically.
 */
export function computeRigor(p: ApplicantProfile): RigorResult {
  const done = p.ap_ib_de_completed;
  const planned = p.ap_ib_de_planned;
  const math = p.highest_math;
  if (done == null && planned == null && math == null) {
    return { index: null, band: "limited", drivers: [], context_limited: false };
  }

  const total = (done ?? 0) + (planned ?? 0);
  const drivers: string[] = [];

  const capped = Math.min(total, 8);
  let score = (capped / 8) * 2.2;
  if (total) drivers.push(`${total} advanced course${total === 1 ? "" : "s"} taken or scheduled`);

  if (math) {
    score += (MATH_POINTS[math] / 4) * 2.0;
    drivers.push(`math through ${HIGHEST_MATH_LABEL[math]}`);
  }

  if (p.has_honors_core) {
    score += 0.5;
    drivers.push("honors or advanced across all core subjects");
  }

  // A thin course catalogue is not the applicant's doing, and colleges state they
  // read rigor against what was available. Partial credit, not a penalty.
  const context_limited = p.school_offers_advanced === "few";
  if (context_limited && total <= 4) {
    score += 0.6;
    drivers.push("limited advanced offerings at your school, judged in context");
  }

  const index = Math.max(1, Math.min(5, Math.round(score * 10) / 10));
  const band =
    index >= 4.5 ? "very strong" :
    index >= 3.5 ? "strong" :
    index >= 2.5 ? "solid" : "limited";
  return { index, band, drivers, context_limited };
}

export interface OddsThresholds {
  likely_admit_min: number;      // 0.35
  target_admit_min: number;      // 0.20
  high_reach_admit_max: number;  // 0.10
  sat_75_bonus: number;          // pts above mid-50 high => likely bump
  gated_downgrade: boolean;      // downgrade one tier when major_admit_context flags gated CS
  /** How far above/below the school average a GPA must sit to move a tier. */
  gpa_delta: number;             // 0.15
  use_gpa: boolean;              // let GPA move the tier at all
  /**
   * Which door the applicant intends at schools that admit by college or major.
   * At UW the same application is ~2% via Direct-to-Major CS and ~37% via
   * Direct-to-College Engineering for a non-resident, so this is not a cosmetic
   * preference -- it changes the odds by an order of magnitude.
   */
  pathway: "engineering" | "computing";
  use_unit_rates: boolean;       // use per-college rates instead of the university average
}

const DEFAULT_PROFILE: ApplicantProfile = {
  gpa_uw: null, gpa_w: null, sat: null, act: null,
  test_plan: "optional_hold", rigor_note: "",
  home_state: "NC",
  ap_ib_de_completed: null, ap_ib_de_planned: null,
  highest_math: null, school_offers_advanced: "unknown",
  has_honors_core: false,
};

const DEFAULT_THRESHOLDS: OddsThresholds = {
  likely_admit_min: 0.35,
  target_admit_min: 0.20,
  high_reach_admit_max: 0.10,
  sat_75_bonus: 0,
  gated_downgrade: true,
  gpa_delta: 0.15,
  use_gpa: true,
  pathway: "engineering",
  use_unit_rates: true,
};

const PROFILE_KEY = "college-compass-applicant-profile";
const THRESHOLDS_KEY = "college-compass-odds-thresholds";

export function useApplicantProfile(): [ApplicantProfile, (u: Partial<ApplicantProfile>) => void] {
  const [profile, setProfile] = useState<ApplicantProfile>(() => {
    try {
      const raw = window.localStorage.getItem(PROFILE_KEY);
      if (raw) return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_PROFILE;
  });
  useEffect(() => {
    try { window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {}
  }, [profile]);
  const update = useCallback((u: Partial<ApplicantProfile>) => setProfile(p => ({ ...p, ...u })), []);
  return [profile, update];
}

export function useOddsThresholds(): [OddsThresholds, (u: Partial<OddsThresholds>) => void, () => void] {
  const [t, setT] = useState<OddsThresholds>(() => {
    try {
      const raw = window.localStorage.getItem(THRESHOLDS_KEY);
      if (raw) return { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_THRESHOLDS;
  });
  useEffect(() => {
    try { window.localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(t)); } catch {}
  }, [t]);
  const update = useCallback((u: Partial<OddsThresholds>) => setT(p => ({ ...p, ...u })), []);
  const reset = useCallback(() => setT(DEFAULT_THRESHOLDS), []);
  return [t, update, reset];
}

// -------------- Odds classifier (pure function) --------------

export type OddsTier = "LIKELY" | "TARGET" | "REACH" | "HIGH_REACH" | "NEEDS_DATA";

export interface OddsResult {
  tier: OddsTier;
  /** The college/program whose rate was used, when the school admits by unit. */
  unit_used?: UnitRate | null;
  /** Populated whenever the school publishes a GPA figure. */
  gpa?: GpaComparison;
  gpa_moved_tier?: boolean;
  reason: string;             // one-sentence explanation
  effective_admit_rate: number | null;   // residency-adjusted for publics
  admit_rate_context: string; // "in-state (NC resident)" | "out-of-state (from NC)" | "overall"
  used_test_score: boolean;
  gated_downgrade_applied: boolean;
  cs_gate: string | null;     // none | mild | strong | unknown
}

/** Defensive coercion: data may arrive as a decimal (0.11), a percentage (11.07),
 *  or a CDS-count object. Never let a value above 1 reach the UI as a rate. */
export function coerceRate(v: any): number | null {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (typeof v === "object") {
    const applied = Number((v as any).applied);
    const admitted = Number((v as any).admitted);
    if (Number.isFinite(applied) && Number.isFinite(admitted) && applied > 0) {
      return admitted / applied;
    }
    const pct = (v as any).value_pct ?? (v as any).pct ?? (v as any).value;
    return coerceRate(pct);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  const r = n > 1 ? n / 100 : n;
  return r > 1 ? null : r;   // still nonsense after scaling -> reject
}

export type GpaBasis = "weighted" | "unweighted" | "unspecified" | "not_published";

export interface GpaComparison {
  /** null when the school publishes nothing usable, or the applicant has no matching figure. */
  delta: number | null;
  school_avg: number | null;
  school_basis: GpaBasis | null;
  applicant_used: number | null;
  /** Which of the applicant's two GPAs was compared. */
  applicant_basis: "weighted" | "unweighted" | null;
  /** Set when a like-for-like comparison was not possible, with the reason. */
  caveat: string | null;
}

/**
 * Compare the applicant's GPA to the school's published average -- LIKE FOR LIKE.
 *
 * This is the part that matters. Comparing an unweighted 3.9 against Georgia
 * Tech's WEIGHTED 4.17 average would understate the applicant badly, so a
 * comparison is only returned when the bases line up. Twelve of the eighteen
 * schools that publish a GPA never state their weighting; for those, a figure at
 * or below 4.0 is compared against the unweighted GPA and explicitly flagged.
 */
export function compareGpa(admissions: any, profile: ApplicantProfile): GpaComparison {
  const raw = admissions?.avg_gpa;
  const empty: GpaComparison = {
    delta: null, school_avg: null, school_basis: null,
    applicant_used: null, applicant_basis: null, caveat: null,
  };
  if (!raw || typeof raw !== "object") {
    return { ...empty, caveat: "This school does not publish an average GPA." };
  }
  const basis: GpaBasis = raw.basis ?? "unspecified";
  const avg: number | null = typeof raw.value === "number" ? raw.value : null;
  if (basis === "not_published" || avg == null) {
    return { ...empty, school_basis: basis,
      caveat: "This school leaves the CDS GPA fields blank, so there is nothing to compare against." };
  }

  if (basis === "weighted") {
    if (profile.gpa_w == null) {
      return { ...empty, school_avg: avg, school_basis: basis,
        caveat: `This school reports a WEIGHTED average (${avg.toFixed(2)}). Enter your weighted GPA to compare.` };
    }
    return { delta: Math.round((profile.gpa_w - avg) * 100) / 100, school_avg: avg,
      school_basis: basis, applicant_used: profile.gpa_w, applicant_basis: "weighted", caveat: null };
  }

  if (basis === "unweighted") {
    if (profile.gpa_uw == null) {
      return { ...empty, school_avg: avg, school_basis: basis,
        caveat: `This school reports an UNWEIGHTED average (${avg.toFixed(2)}). Enter your unweighted GPA to compare.` };
    }
    return { delta: Math.round((profile.gpa_uw - avg) * 100) / 100, school_avg: avg,
      school_basis: basis, applicant_used: profile.gpa_uw, applicant_basis: "unweighted", caveat: null };
  }

  // basis unspecified
  if (avg > 4.0) {
    // Cannot be an unweighted 4.0-scale figure; treat as weighted if we can.
    if (profile.gpa_w == null) {
      return { ...empty, school_avg: avg, school_basis: basis,
        caveat: `Average ${avg.toFixed(2)} exceeds 4.0, so it must be weighted, but the school does not say so. Enter your weighted GPA to compare.` };
    }
    return { delta: Math.round((profile.gpa_w - avg) * 100) / 100, school_avg: avg,
      school_basis: basis, applicant_used: profile.gpa_w, applicant_basis: "weighted",
      caveat: "The school does not state its weighting; treated as weighted because the average exceeds 4.0." };
  }
  if (profile.gpa_uw == null) {
    return { ...empty, school_avg: avg, school_basis: basis,
      caveat: `This school does not state whether its ${avg.toFixed(2)} average is weighted. Enter your unweighted GPA for the closest comparison.` };
  }
  return { delta: Math.round((profile.gpa_uw - avg) * 100) / 100, school_avg: avg,
    school_basis: basis, applicant_used: profile.gpa_uw, applicant_basis: "unweighted",
    caveat: "The school does not state its weighting; compared against your unweighted GPA." };
}

export interface UnitRate {
  unit: string;
  rate: number;
  residency: "all" | "in_state" | "oos";
  basis?: string;
  robotics_relevant?: boolean;
  preferred_for_robotics?: boolean;
  note?: string;
}

/**
 * Pick the college/program rate that actually applies to this applicant.
 *
 * A university-wide rate describes nobody at a school that admits by college.
 * Residency is matched first, then the requested pathway: "engineering" takes the
 * unit flagged preferred_for_robotics (the engineering door), "computing" takes
 * the other robotics-relevant unit (the CS/SCS door).
 */
export function pickUnitRate(
  admissions: any,
  profile: ApplicantProfile,
  pathway: "engineering" | "computing",
): UnitRate | null {
  const units: UnitRate[] = Array.isArray(admissions?.unit_admit_rates)
    ? admissions.unit_admit_rates : [];
  if (!units.length) return null;

  const inHome = profile.home_state === "NC" && Boolean(admissions?.is_home_state_nc);
  const wantRes = inHome ? "in_state" : "oos";
  const relevant = units.filter(u => u.robotics_relevant);
  if (!relevant.length) return null;

  // Residency: exact match, else the "all" rows, else give up rather than
  // silently comparing an in-state rate to an out-of-state applicant.
  let pool = relevant.filter(u => u.residency === wantRes);
  if (!pool.length) pool = relevant.filter(u => u.residency === "all");
  if (!pool.length) return null;

  // Never substitute one door's rate for the other. Georgia Tech publishes a
  // computing figure and no engineering figure; falling back to "highest rate
  // available" quietly reported the computing rate as the engineering door's
  // odds. If the requested door has no published rate, return null and let the
  // caller fall back to the university-wide figure.
  if (pathway === "engineering") {
    return pool.find(u => u.preferred_for_robotics === true) ?? null;
  }
  return pool.find(u => u.preferred_for_robotics !== true) ?? null;
}

export function classify(admissions: any, nc_note: string | undefined, profile: ApplicantProfile, t: OddsThresholds): OddsResult {
  const overall = coerceRate(admissions?.overall_admit_rate);
  if (overall === null) {
    return { tier: "NEEDS_DATA", reason: "No sourced overall admit rate published for this school.", effective_admit_rate: null, admit_rate_context: "n/a", used_test_score: false, gated_downgrade_applied: false, cs_gate: admissions?.cs_gate ?? null };
  }

  // Effective admit rate comes from VERIFIED structured fields extracted and
  // hand-checked from each school's CDS prose — not from regex-reading sentences
  // in the browser, which previously mis-parsed the residency splits.
  //   school in applicant's home state -> in-state rate
  //   otherwise                        -> out-of-state rate when published
  //   neither published                -> overall
  let rate = overall;
  let ctx = "overall";

  const inState = coerceRate(admissions.in_state_admit_rate);
  const oosRate = coerceRate(admissions.oos_admit_rate);
  const inHomeState = profile.home_state === "NC" && Boolean(admissions.is_home_state_nc);

  if (inHomeState && inState !== null) {
    rate = inState;
    ctx = `in-state (${profile.home_state} resident)`;
  } else if (!inHomeState && oosRate !== null) {
    rate = oosRate;
    ctx = `out-of-state (from ${profile.home_state})`;
  }

  // Per-college / per-program override. This is the point of the whole feature:
  // at CMU the engineering door is ~19% and SCS is ~5.2%; at UW the same
  // application is ~37% via Direct-to-College Engineering and ~2% via
  // Direct-to-Major CS for a non-resident.
  let unit: UnitRate | null = null;
  if (t.use_unit_rates) {
    unit = pickUnitRate(admissions, profile, t.pathway);
    if (unit) {
      rate = unit.rate;
      ctx = `${unit.unit}${unit.residency !== "all" ? ` · ${unit.residency === "in_state" ? "in-state" : "out-of-state"}` : ""}`;
    }
  }

  // Determine tier by admit rate
  let tier: OddsTier =
    rate < t.high_reach_admit_max ? "HIGH_REACH" :
    rate < t.target_admit_min     ? "REACH" :
    rate < t.likely_admit_min     ? "TARGET" :
                                    "LIKELY";
  let reason = `${ctx.charAt(0).toUpperCase() + ctx.slice(1)} admit rate ${(rate*100).toFixed(1)}%.`;

  // SAT modifier (informational only — moves TARGET → LIKELY if SAT ≥ 75th percentile)
  let used_test_score = false;
  if (Array.isArray(admissions.sat_mid50) && admissions.sat_mid50.length === 2 && profile.sat && profile.test_plan !== "not_submitting") {
    used_test_score = true;
    const [low, high] = admissions.sat_mid50 as [number, number];
    if (profile.sat >= high + t.sat_75_bonus && tier === "TARGET") {
      tier = "LIKELY";
      reason += ` Your SAT ${profile.sat} is at or above the 75th percentile (${high}).`;
    } else if (profile.sat < low && (tier === "TARGET" || tier === "LIKELY")) {
      tier = "REACH";
      reason += ` Your SAT ${profile.sat} is below the 25th percentile (${low}).`;
    }
  }

  // GPA modifier. Previously the profile collected GPA and nothing read it, so
  // the field did nothing at all. It only fires on a like-for-like comparison
  // (see compareGpa) and moves at most one tier, in the same spirit as the SAT
  // modifier -- admit rate remains the primary driver.
  const gpa = compareGpa(admissions, profile);
  let gpa_moved_tier = false;
  if (t.use_gpa && gpa.delta !== null) {
    const d = gpa.delta;
    const basisLabel = gpa.applicant_basis === "weighted" ? "weighted" : "unweighted";
    if (d >= t.gpa_delta && (tier === "TARGET" || tier === "REACH")) {
      tier = tier === "REACH" ? "TARGET" : "LIKELY";
      gpa_moved_tier = true;
      reason += ` Your ${basisLabel} GPA is ${d.toFixed(2)} above this school's published average (${gpa.school_avg?.toFixed(2)}).`;
    } else if (d <= -t.gpa_delta && (tier === "LIKELY" || tier === "TARGET")) {
      tier = tier === "LIKELY" ? "TARGET" : "REACH";
      gpa_moved_tier = true;
      reason += ` Your ${basisLabel} GPA is ${Math.abs(d).toFixed(2)} below this school's published average (${gpa.school_avg?.toFixed(2)}).`;
    } else if (Math.abs(d) < t.gpa_delta) {
      reason += ` Your ${basisLabel} GPA is within ${t.gpa_delta.toFixed(2)} of the published average (${gpa.school_avg?.toFixed(2)}), so it does not move the tier.`;
    } else {
      // The gap IS material, but the tier is already at the end of the scale in
      // that direction. Saying "within X" here would be factually wrong -- the
      // earlier version did exactly that and reported a 0.36 gap as "within 0.15".
      const dir = d > 0 ? "above" : "below";
      const ceiling = d > 0 ? "already the most favourable tier" : "already the least favourable tier";
      reason += ` Your ${basisLabel} GPA is ${Math.abs(d).toFixed(2)} ${dir} the published average (${gpa.school_avg?.toFixed(2)}), but this school is ${ceiling} on admit rate alone, so the tier does not change.`;
    }
  }

  // Gated-major downgrade, driven by the researched `cs_gate` enum rather than
  // keyword-matching prose. The old regex was negation-blind and penalised WPI,
  // RPI and Florida for explicitly NOT having a major-level gate.
  let gated_downgrade_applied = false;
  const gate: string | undefined = admissions.cs_gate;
  // Do NOT apply the gate penalty on top of a per-college rate. The cs_gate flag
  // is a PROXY for "the computing door is much harder than the university
  // average" -- which is exactly what a unit rate measures directly. Applying
  // both double-counted the same obstacle: CMU came out as High reach on the
  // engineering door's 19% rate, and Purdue as Target on 46.1%.
  const gateAlreadyPricedIn = unit !== null;
  if (t.gated_downgrade && !gateAlreadyPricedIn && gate === "strong" && tier !== "HIGH_REACH") {
    const order: OddsTier[] = ["LIKELY","TARGET","REACH","HIGH_REACH"];
    const idx = order.indexOf(tier);
    if (idx >= 0 && idx < order.length - 1) {
      tier = order[idx + 1];
      gated_downgrade_applied = true;
      reason += " Downgraded one tier: CS/AI sits behind a strong separate admission or internal gate here.";
    }
  }

  // If the school admits by college but publishes nothing for the requested door,
  // say so -- otherwise a university-wide fallback reads as a real per-door number
  // and the two doors look comparable when they are not.
  if (t.use_unit_rates && !unit && admissions?.admission_unit
      && admissions.admission_unit !== "university") {
    reason += ` Note: this school admits by ${String(admissions.admission_unit).replace(/_/g, " ")}, but publishes no admit rate for the ${t.pathway} door, so the university-wide figure is shown instead.`;
  }

  if (gateAlreadyPricedIn && gate === "strong") {
    reason += " The CS-gate penalty is not applied here because this school's own per-college rate already reflects which door you are using.";
  }

  return { tier, reason, effective_admit_rate: rate, admit_rate_context: ctx, used_test_score, gated_downgrade_applied, cs_gate: gate ?? null, gpa, gpa_moved_tier, unit_used: unit };
}

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
  /**
   * Rate each door's gate on its own researched severity rather than applying one
   * global flag to both.
   *
   * The earlier binary version waived the gate on the engineering door entirely,
   * on the theory that it describes a CS-specific obstacle. That holds at
   * Michigan, whose own note says "the binding constraint is the Computer Science
   * major, not the college". It does NOT hold at Texas A&M (every engineering
   * admit competes through ETAM), NC State (CODA), Virginia Tech (General
   * Engineering) or Maryland, whose Limited Enrollment Program list contains
   * Engineering alongside Computer Science. Waiving those understated a real
   * obstacle by a full tier.
   *
   * With per-door severities the engineering gate stays STRONG at NC State,
   * Texas A&M and Berkeley, and relaxes only where the evidence says it should.
   */
  use_door_gates: boolean;
  /**
   * Legacy global flag, kept so previously stored settings still load. It now
   * applies only when a school has no researched per-door severity, and defaults
   * to false because waiving a gate should be evidence-led, not assumed.
   */
  gate_pathway_aware: boolean;
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
  use_door_gates: true,
  gate_pathway_aware: false,
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
  /**
   * Set when the chosen unit rate blends residents and non-residents while the
   * school also publishes a residency split. The two are not comparable.
   */
  unit_residency_blended?: boolean;
  /** Set when a blended unit rate was capped at the applicant's residency rate. */
  unit_clamped_to?: number | null;
  /** Which test the modifier used, when one applied. */
  test_used?: "SAT" | "ACT" | null;
  /** The researched gate severity for the door actually being used. */
  door_gate_severity?: string | null;
  /** False when the school has no programme behind the requested door. */
  door_available?: boolean;
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

/**
 * How a school admits, as TWO independent facts.
 *
 * These were previously collapsed into one field, which produced a real error:
 * Duke was recorded as admitting university-wide because its Common Data Set
 * reports a single funnel, even though Duke applicants choose between Trinity
 * College of Arts & Sciences and the Pratt School of Engineering. Not publishing
 * a split is a DISCLOSURE fact. Requiring the applicant to pick a school is a
 * STRUCTURAL fact. Keep them apart.
 */
export type AppliesTo =
  | "university" | "college" | "major" | "first_year_eng" | "pre_major";

export interface AdmissionStructure {
  /** What the applicant actually selects on the application. */
  applies_to: AppliesTo;
  /** Real names of the selectable undergraduate units. */
  units_named?: string[];
  /** Whether an intended major is asked for AND evaluated. */
  applicant_selects_major?: boolean;
  /** Whether the school publishes admit rates broken out by unit. */
  separate_rates_published?: boolean;
}

export interface UnitRate {
  unit: string;
  rate: number;
  residency: "all" | "in_state" | "oos";
  /** Which application door this unit represents. "other" is context only and is
   *  never auto-selected, so a university-total row cannot be mistaken for a door. */
  door: "engineering" | "computing" | "other";
  basis?: string;
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
export interface UnitPick {
  unit: UnitRate;
  /**
   * True when the unit's residency basis matches the applicant's. False means an
   * all-residency row was used as a stand-in, which is NOT interchangeable with a
   * residency-specific figure -- see the clamp in classify().
   */
  residency_matched: boolean;
}

export function pickUnitRate(
  admissions: any,
  profile: ApplicantProfile,
  pathway: "engineering" | "computing",
): UnitPick | null {
  const units: UnitRate[] = Array.isArray(admissions?.unit_admit_rates)
    ? admissions.unit_admit_rates : [];
  if (!units.length) return null;

  const inHome = profile.home_state === "NC" && Boolean(admissions?.is_home_state_nc);
  const wantRes = inHome ? "in_state" : "oos";
  const relevant = units.filter(u => u.door === pathway);
  if (!relevant.length) return null;

  // Residency: exact match first. An "all" row is accepted only as a fallback and
  // is reported as unmatched, because a blend of residents and non-residents is a
  // different measurement from a residency-specific rate.
  let pool = relevant.filter(u => u.residency === wantRes);
  const matched = pool.length > 0;
  if (!pool.length) pool = relevant.filter(u => u.residency === "all");
  if (!pool.length) return null;

  // Doors are labelled explicitly, so no cross-door substitution is possible.
  // Georgia Tech publishes a computing figure and no engineering figure; asking
  // for the engineering door there correctly yields nothing and the caller falls
  // back to the university-wide rate with a visible note.
  //
  // When several rows share a door and residency, take the lowest rate rather
  // than whichever happens to be first in the file: array order is not a
  // meaningful signal, and the conservative figure is the safer default.
  const chosen = pool.reduce((a, b) => (b.rate < a.rate ? b : a));
  return { unit: chosen, residency_matched: matched };
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
  let unit_residency_blended = false;
  let unit_clamped_to: number | null = null;
  if (t.use_unit_rates) {
    const picked = pickUnitRate(admissions, profile, t.pathway);
    if (picked) {
      unit = picked.unit;
      const residencyRate = inHomeState ? inState : oosRate;
      // An all-residency unit figure blends residents with non-residents. At a
      // public that also publishes a residency split those are different
      // measurements, and swapping one for the other silently inverted Georgia
      // Tech: the College of Computing blend (11.3%) read as EASIER than the
      // published out-of-state university rate (10.1%), so choosing the harder
      // door made the school look more attainable. The blend only clears 10.1%
      // because it carries Georgia residents admitted at 29.5%.
      //
      // Rule: a blended unit rate may show a door is harder, never that it is
      // easier than the applicant's own residency-specific rate. Capping keeps
      // the informative signal (UIUC CS 7.4%, Purdue CS 35.9%) while removing
      // the inversion, and invents no number that nobody published.
      unit_residency_blended = !picked.residency_matched && residencyRate !== null;
      let unitRate = unit.rate;
      if (unit_residency_blended && residencyRate !== null && unitRate > residencyRate) {
        unit_clamped_to = residencyRate;
        unitRate = residencyRate;
      }
      rate = unitRate;
      // When the blend is capped, the number shown is no longer the unit's own
      // figure -- it is the university residency rate. Naming only the unit made
      // the label misattribute the value: Purdue read "College of Engineering
      // 43.6%" when the published College of Engineering rate is 46.1% and 43.6%
      // is the university out-of-state rate. Say so in the context itself so
      // every consumer inherits it, not just the odds table.
      const resLabel = unit.residency === "in_state" ? "in-state"
                     : unit.residency === "oos" ? "out-of-state" : "all residencies";
      ctx = unit_clamped_to !== null
        ? `${unit.unit}, capped at the ${inHomeState ? "in-state" : "out-of-state"} rate`
        : `${unit.unit}${unit.residency !== "all" ? ` · ${resLabel}` : " · all residencies"}`;
    }
  }

  // Determine tier by admit rate
  let tier: OddsTier =
    rate < t.high_reach_admit_max ? "HIGH_REACH" :
    rate < t.target_admit_min     ? "REACH" :
    rate < t.likely_admit_min     ? "TARGET" :
                                    "LIKELY";
  let reason = `${ctx.charAt(0).toUpperCase() + ctx.slice(1)} admit rate ${(rate*100).toFixed(1)}%.`;

  // Test-score modifier. Moves at most ONE tier in either direction.
  //
  // Two fixes here. The ACT was collected on the profile and read by nothing, so
  // an ACT-only applicant got no test signal at all -- the same defect the GPA
  // field had. And the downgrade used to jump LIKELY straight to REACH, skipping
  // TARGET, which labelled Rose-Hulman (80.9% admit) a Reach for an applicant
  // ten points under its 25th percentile.
  let used_test_score = false;
  let test_used: "SAT" | "ACT" | null = null;
  const satBand = Array.isArray(admissions.sat_mid50) && admissions.sat_mid50.length === 2
    ? (admissions.sat_mid50 as [number, number]) : null;
  const actBand = Array.isArray(admissions.act_mid50) && admissions.act_mid50.length === 2
    ? (admissions.act_mid50 as [number, number]) : null;

  // Prefer the SAT when both the applicant and the school have one; otherwise
  // fall back to the ACT. Penn publishes an ACT band and no SAT band, so without
  // this its test modifier could never fire for anyone.
  let band: [number, number] | null = null;
  let score: number | null = null;
  if (satBand && profile.sat) { band = satBand; score = profile.sat; test_used = "SAT"; }
  else if (actBand && profile.act) { band = actBand; score = profile.act; test_used = "ACT"; }

  if (band && score && profile.test_plan !== "not_submitting") {
    used_test_score = true;
    const [low, high] = band;
    const bonus = test_used === "SAT" ? t.sat_75_bonus : 0;
    if (score >= high + bonus && tier === "TARGET") {
      tier = "LIKELY";
      reason += ` Your ${test_used} ${score} is at or above the 75th percentile (${high}).`;
    } else if (score < low && (tier === "TARGET" || tier === "LIKELY")) {
      // "Hold — decide per school" means exactly that: a score below the 25th
      // percentile is the one you would withhold, so it should not drag the tier
      // down. Only an applicant committed to submitting takes that hit.
      if (profile.test_plan === "submitting") {
        tier = tier === "LIKELY" ? "TARGET" : "REACH";
        reason += ` Your ${test_used} ${score} is below the 25th percentile (${low}).`;
      } else {
        reason += ` Your ${test_used} ${score} is below the 25th percentile (${low}), but your test plan is "hold", so it does not move the tier — you would simply not submit it here.`;
      }
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
  //
  // A CAPPED unit rate is the exception: capping discards the blended figure and
  // falls back to the university residency rate, so no door-specific signal
  // survives and the proxy is needed again. Without this, Georgia Tech still
  // inverted on tier even after the rate was capped -- the engineering door took
  // the downgrade to High reach while the computing door kept Reach purely
  // because a (discarded) unit row existed.
  const gateAlreadyPricedIn = unit !== null && unit_clamped_to === null;
  // The gate describes the CS/AI door. Applying it to someone entering through
  // engineering said "harder to get in" when the truth is "harder to switch into
  // CS once in" -- and it produced a visible contradiction: Purdue's engineering
  // door classified HARDER than its computing door, because the gate landed on
  // engineering while computing's own per-college rate exempted it.
  // Per-door severity. `gate_by_door.engineering` comes from the ECE admission
  // research (which established the engineering-side gate for all 33 schools);
  // `gate_by_door.computing` is the researched cs_gate. Only "strong" moves a
  // tier, so behaviour is unchanged -- what changes is WHICH door is strong.
  const doorGate = t.use_door_gates
    ? (admissions?.gate_by_door?.[t.pathway] ?? null)
    : null;
  const doorSeverity: string | null = doorGate?.severity ?? null;
  const doorAvailable: boolean = doorGate?.available !== false;

  // Effective gate for THIS door. Fall back to the global flag only where no
  // per-door severity was researched.
  const effectiveGate = doorSeverity ?? gate;
  const gateSkippedForDoor = doorSeverity !== null
    ? (effectiveGate !== "strong" && gate === "strong")
    : (t.gate_pathway_aware && t.pathway !== "computing" && gate === "strong");

  if (t.gated_downgrade && !gateAlreadyPricedIn && effectiveGate === "strong" && tier !== "HIGH_REACH") {
    const order: OddsTier[] = ["LIKELY","TARGET","REACH","HIGH_REACH"];
    const idx = order.indexOf(tier);
    if (idx >= 0 && idx < order.length - 1) {
      tier = order[idx + 1];
      gated_downgrade_applied = true;
      reason += doorSeverity !== null
        ? ` Downgraded one tier: the ${t.pathway} door itself sits behind a strong gate here${doorGate?.basis ? ` — ${String(doorGate.basis).slice(0, 180)}` : ""}.`
        : " Downgraded one tier: CS/AI sits behind a strong separate admission or internal gate here.";
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

  if (gateSkippedForDoor) {
    reason += doorSeverity !== null
      ? ` CS/AI is strongly gated here, but the ${t.pathway} door's own gate is rated "${doorSeverity}", so it does not move the tier${doorGate?.basis ? ` (${String(doorGate.basis).slice(0, 160)})` : ""}. It remains a risk to switching into CS later.`
      : " CS/AI is gated here, but you are applying through the engineering door, so it does not change the admission bar — it remains a risk to reaching the major later.";
  }

  // A school with no ECE/engineering programme has no engineering door at all.
  // Silence here is what would otherwise let UNC-Chapel Hill read as "Likely" on
  // a door that does not exist.
  // Prepend, do not append. Appending buried this behind a long reason string and
  // left UNC-Chapel Hill reading as "Likely" on an engineering door that does not
  // exist -- the same misleading outcome as waiving its gate outright. The tier
  // still reflects general admission difficulty, which is real, but the missing
  // door has to be the first thing read.
  if (!doorAvailable) {
    reason = `No ${t.pathway === "engineering" ? "ECE/engineering" : "computing"} door here: this school has no ${t.pathway === "engineering" ? "electrical or computer engineering programme" : "computing programme"}, so the tier below reflects general admission only, not a route into the major. ` + reason;
  }

  if (unit_residency_blended && unit) {
    reason += unit_clamped_to !== null
      ? ` The ${unit.unit} figure (${(unit.rate*100).toFixed(1)}%) blends residents and non-residents, so it overstates your odds as a ${inHomeState ? "resident" : "non-resident"}; capped at the published ${(unit_clamped_to*100).toFixed(1)}% residency rate.`
      : ` Note: the ${unit.unit} figure blends residents and non-residents, while this school publishes a residency split — treat it as approximate.`;
  }
  if (unit?.note) {
    reason += ` Source note on this per-college figure: ${unit.note}`;
  }

  return { tier, reason, effective_admit_rate: rate, admit_rate_context: ctx, used_test_score, test_used, gated_downgrade_applied, cs_gate: gate ?? null, door_gate_severity: doorSeverity, door_available: doorAvailable, gpa, gpa_moved_tier, unit_used: unit, unit_residency_blended, unit_clamped_to };
}

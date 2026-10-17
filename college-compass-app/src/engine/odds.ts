/**
 * Admission-odds heuristic (on-device, no ML). Works in log-odds space:
 *
 *   L = logit(base admit rate) + Σ factor deltas
 *   p = clamp(sigmoid(L), P_MIN, P_MAX), then a hard cap for very selective schools.
 *
 * It is a transparent heuristic over published Common Data Set figures, NOT a prediction.
 * Every number below is a documented judgement call; tune them here and nowhere else.
 * Any College field may be null (AI research) — every branch degrades to "no effect,
 * lower confidence" rather than guessing, and nothing can produce NaN.
 */
import type { College, OddsFactor, OddsResult, StudentProfile, Tier, MajorArea } from "../types";
import { bestSat, schoolSatRange } from "./concordance";
import { clamp, interp, logit, mean, num, rate, sigmoid, fmtPct } from "./math";
import { majorLabel } from "./labels";

// ───────────────────────────── Constants ─────────────────────────────

/** Admit rate assumed when research found none (typical US four-year college). */
export const DEFAULT_ADMIT_RATE = 0.65;
/**
 * Without a researched admit rate we can't tell a 10% school from a 90% one, so the estimate is
 * capped here: never shown as "likely" or "safety" on a guessed starting point. (Seen in a real run:
 * UNC Chapel Hill's CDS tables didn't extract and the uncapped estimate read "likely 61–92%".)
 */
export const UNKNOWN_ADMIT_P_CAP = 0.5;
/** Final probability clamp. Nobody is ever shown 0% or 100%. */
export const P_MIN = 0.01;
export const P_MAX = 0.95;
/** Schools admitting fewer than this are always "high reach"… */
export const ULTRA_SELECTIVE_RATE = 0.15;
/** …and the estimate is capped at this multiple of their admit rate. */
export const ULTRA_SELECTIVE_MULTIPLIER = 2.5;

/**
 * Test score position. x = (score − p25) / (p75 − p25): 0 at the 25th percentile, 1 at the 75th.
 * The range describes ADMITTED students, who out-score the applicant pool the admit rate describes,
 * so the admitted median is already slightly positive. Saturates on both ends: a perfect score adds
 * at most +0.85; far below the range costs up to −1.6.
 */
export const TEST_POSITION_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [-2.0, -1.6], [-1.0, -1.1], [-0.5, -0.7], [0.0, -0.3], [0.5, 0.15], [1.0, 0.5], [1.5, 0.7], [2.5, 0.85],
];
/** Minimum spread used for x, so a narrow reported range can't explode the scale. */
export const TEST_MIN_SPREAD = 60;
/** At test-optional schools a low score can be withheld: the penalty is floored here. */
export const TEST_OPTIONAL_FLOOR = -0.15;
/** Test-required school and the student has no score. */
export const TEST_REQUIRED_NO_SCORE = -1.5;
/** Unknown policy and no score: mild penalty (many schools still expect scores). */
export const TEST_UNKNOWN_NO_SCORE = -0.3;

/** Expected unweighted GPA of admitted students by admit rate (used when CDS avg_gpa is missing). */
export const EXPECTED_GPA_BY_ADMIT: ReadonlyArray<readonly [number, number]> = [
  [0.05, 3.95], [0.15, 3.9], [0.3, 3.8], [0.5, 3.6], [0.7, 3.45], [0.9, 3.2],
];
/** GPA difference (student − reference) → logit delta, before selectivity scaling. Saturating. */
export const GPA_DIFF_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [-1.0, -2.5], [-0.5, -1.4], [-0.25, -0.7], [-0.1, -0.25], [0, 0], [0.1, 0.25], [0.25, 0.45], [0.5, 0.6],
];
/**
 * Weighted GPAs aren't comparable across high schools (different caps and bonus points), so
 * weighted-vs-weighted differences are shrunk by this factor before applying GPA_DIFF_KNOTS.
 */
export const WEIGHTED_DIFF_DAMPING = 0.75;
/** GPA matters a bit more at selective schools (multiplier on GPA_DIFF_KNOTS). */
export const GPA_SCALE_BY_ADMIT: ReadonlyArray<readonly [number, number]> = [
  [0.05, 1.0], [0.3, 0.9], [0.6, 0.75], [0.9, 0.6],
];
/** Weighted-GPA bump estimated from course rigor (used to convert between scales when only one GPA is known). */
export const WEIGHTED_BUMP_BY_RIGOR: Readonly<Record<StudentProfile["rigor"], number>> = {
  most: 0.45, very: 0.3, average: 0.15, below: 0.05,
};
/** CDS avg_gpa above this is on a weighted (5-point) scale. */
export const WEIGHTED_SCALE_THRESHOLD = 4.0;

/** Holistic factors: weight of "soft" factors by admit rate (holistic review matters more when selective). */
export const HOLISTIC_SCALE_BY_ADMIT: ReadonlyArray<readonly [number, number]> = [
  [0.05, 1.0], [0.2, 0.85], [0.4, 0.6], [0.7, 0.35], [0.9, 0.25],
];
export const RIGOR_DELTA: Readonly<Record<StudentProfile["rigor"], number>> = {
  most: 0.2, very: 0.1, average: -0.05, below: -0.35,
};
export const ACTIVITIES_DELTA: Readonly<Record<StudentProfile["activities_strength"], number>> = {
  national: 0.35, state: 0.2, school_leader: 0.1, involved: 0, light: -0.15,
};
/** |rigor + activities| never exceeds this. */
export const RIGOR_ACTIVITIES_CAP = 0.5;

/** Residency at public schools when in/out-of-state admit rates are unknown. */
export const RESIDENCY_DEFAULT_DELTA = 0.35;
/** Cap on the residency effect computed from researched in/out rates. */
export const RESIDENCY_CAP = 1.5;

/** ED: share of the raw ED-vs-RD logit gap credited to applying ED (the rest is applicant-pool strength). */
export const ED_POOL_DISCOUNT = 0.5;
export const ED_MAX_BOOST = 1.0;
/** ED boost when the school offers ED but no ED/RD rates were found. */
export const ED_DEFAULT_BOOST = 0.3;
/** Non-binding Early Action: tiny effect. */
export const EA_BOOST = 0.05;

export const GATED_MAJOR_PENALTY = -0.4;
export const FIRST_GEN_BOOST = 0.1;
export const FIRST_GEN_MAX_ADMIT = 0.3;

/** Band half-width in logit space by confidence. */
export const BAND_HALF_WIDTH: Readonly<Record<OddsResult["confidence"], number>> = {
  high: 0.4, medium: 0.7, low: 1.0,
};
/**
 * Confidence points: start from the researcher's data_confidence (high 3 / medium 2 / low 1), subtract
 * for missing inputs (no score at a test-optional school −0.5, no GPA −0.75, no score range −0.5,
 * GPA reference estimated from admit rate −0.25, …). ≥ CONF_HIGH_MIN → high, ≥ CONF_MEDIUM_MIN → medium.
 * A missing admit rate always means low.
 */
export const CONF_HIGH_MIN = 2.75;
export const CONF_MEDIUM_MIN = 1.5;
const CONF_POINTS: Readonly<Record<College["data_confidence"], number>> = { high: 3, medium: 2, low: 1 };

/** Tier cut-offs on p (SPEC). */
export const TIER_CUTS = { safety: 0.85, likely: 0.65, target: 0.35, reach: 0.15 } as const;

export function tierFromP(p: number): Tier {
  if (p >= TIER_CUTS.safety) return "safety";
  if (p >= TIER_CUTS.likely) return "likely";
  if (p >= TIER_CUTS.target) return "target";
  if (p >= TIER_CUTS.reach) return "reach";
  return "high_reach";
}

// ───────────────────────────── Helpers ─────────────────────────────

const GATED_RE =
  /\b(competitive|limited[- ]entry|limited enrollment|enrollment[- ]limited|capacity[- ](limited|constrained)|impacted|restricted|selective (admission|major|entry|program)|secondary admission|apply to the major)\b/i;
const NOT_GATED_RE = /\b(non[- ]?competitive|not competitive|not limited|no limit)\b/i;
const AUDITION_RE = /\b(audition|portfolio)\b/i;

function hasPlan(c: College, plans: string[]): boolean {
  const list = Array.isArray(c.application?.plans) ? c.application!.plans : [];
  return list.some((x) => x && plans.includes(String(x.plan).toUpperCase()));
}

export function offersEd(c: College): boolean {
  return c.cds?.offers_ed === true || hasPlan(c, ["ED", "ED2"]);
}

export function offersEa(c: College): boolean {
  return c.cds?.offers_ea === true || hasPlan(c, ["EA", "REA"]);
}

/** Primary major is capacity-limited / competitive entry at this college. */
export function isGatedMajor(c: College, major: MajorArea | undefined): boolean {
  if (!major || major === "undecided") return false;
  if (Array.isArray(c.cds?.gated_majors) && c.cds!.gated_majors!.includes(major)) return true;
  const note = programFor(c, major);
  if (!note) return false;
  const text = `${note.how_to_enter ?? ""} ${note.notes ?? ""}`;
  return GATED_RE.test(text) && !NOT_GATED_RE.test(text);
}

export function programFor(c: College, major: MajorArea) {
  return Array.isArray(c.programs) ? c.programs.find((p) => p && p.major === major) : undefined;
}

function isPublic(c: College): boolean {
  return c.ownership === "public";
}

export function isInState(c: College, profile: StudentProfile): boolean | null {
  const home = String(profile.home_state ?? "").trim().toUpperCase();
  const st = String(c.state ?? "").trim().toUpperCase();
  if (home.length !== 2 || st.length !== 2) return null;
  return home === st;
}

/** Resolve the base admit rate: overall → mean(in, out) → RD rate → default. */
export function baseAdmitRate(c: College): { rate: number; source: "overall" | "derived" | "default" } {
  const overall = rate(c.admit_rate);
  if (overall != null) return { rate: overall, source: "overall" };
  const res = mean([rate(c.cds?.in_state_admit_rate), rate(c.cds?.out_of_state_admit_rate)]);
  if (res != null) return { rate: res, source: "derived" };
  const rd = rate(c.cds?.rd_admit_rate);
  if (rd != null) return { rate: rd, source: "derived" };
  return { rate: DEFAULT_ADMIT_RATE, source: "default" };
}

function effectOf(delta: number): OddsFactor["effect"] {
  if (delta > 0.02) return "up";
  if (delta < -0.02) return "down";
  return "neutral";
}

const r2 = (x: number) => Math.round(x * 100) / 100;

// ───────────────────────────── Main ─────────────────────────────

export function estimateOdds(college: College, profile: StudentProfile): OddsResult {
  const factors: OddsFactor[] = [];
  const caveats: string[] = [];
  let conf = CONF_POINTS[college.data_confidence] ?? 1.5;
  let forceLow = false;

  const push = (label: string, delta: number) => {
    const d = Number.isFinite(delta) ? delta : 0;
    factors.push({ label, effect: effectOf(d), logit_delta: r2(d) });
    return d;
  };

  // 1) Base rate
  const base = baseAdmitRate(college);
  const admit = base.rate;
  let L = logit(admit);
  factors.push({
    label:
      base.source === "default"
        ? "We couldn't find their admit rate, so this is only a rough guess (capped at 50%)"
        : `Starting point: they admit about ${fmtPct(admit)} of applicants`,
    effect: "neutral",
    logit_delta: r2(L),
  });
  if (base.source === "default") {
    forceLow = true;
    caveats.push("Admit rate not found — this estimate is a rough guess. Check the college's own admissions page.");
  } else if (base.source === "derived") {
    conf -= 0.5;
    caveats.push("Overall admit rate not found — estimated from other admissions figures.");
  }
  const holistic = interp(admit, HOLISTIC_SCALE_BY_ADMIT);

  // 2) Test scores
  const policy = college.test_policy ?? "unknown";
  const score = bestSat(profile);
  const range = schoolSatRange(college);
  if (policy === "blind") {
    push("Test-blind — they don't look at SAT/ACT scores", 0);
  } else if (score == null) {
    if (policy === "required") {
      L += push("They require SAT/ACT scores and you haven't listed one", TEST_REQUIRED_NO_SCORE);
      caveats.push("Test-required: you'll need to send an SAT or ACT score to apply.");
    } else if (policy === "unknown") {
      L += push("No test score listed and we couldn't confirm their test policy", TEST_UNKNOWN_NO_SCORE);
      conf -= 0.5;
    } else {
      push("Test-optional — applying without a score isn't held against you", 0);
      conf -= 0.5;
    }
  } else if (range == null) {
    push("We couldn't find their score range, so your score isn't counted", 0);
    conf -= 0.5;
  } else {
    const spread = Math.max(range.p75 - range.p25, TEST_MIN_SPREAD);
    const x = (score - range.p25) / spread;
    let d = interp(x, TEST_POSITION_KNOTS);
    const where =
      score >= range.p75 ? "above" : score >= range.p25 ? "inside" : "below";
    const actNote = range.fromAct ? " (their ACT range, converted)" : "";
    let label =
      where === "above"
        ? `Your score is above their middle 50%${actNote}`
        : where === "inside"
          ? `Your score is inside their middle 50%${actNote}`
          : `Your score is below their middle 50%${actNote}`;
    if ((policy === "optional" || policy === "considered") && d < TEST_OPTIONAL_FLOOR) {
      d = TEST_OPTIONAL_FLOOR;
      label = `Your score is below their middle 50% — at a test-optional school you can apply without it`;
      caveats.push("Your score is below their typical range; consider applying test-optional here.");
    }
    if (policy === "unknown") conf -= 0.25;
    L += push(label, d);
  }

  // 3) GPA vs school average / selectivity
  const uw = num(profile.gpa_unweighted);
  const w = num(profile.gpa_weighted);
  const studentUw = uw != null && uw > 0 && uw <= 4.0 ? uw : null;
  const studentW = w != null && w > 0 && w <= 6 ? w : null;
  const bump = WEIGHTED_BUMP_BY_RIGOR[profile.rigor] ?? 0.15;
  const avgGpa = num(college.cds?.avg_gpa);
  const validAvg = avgGpa != null && avgGpa >= 1.5 && avgGpa <= 5.5 ? avgGpa : null;
  let ref: number;
  let refKind: "weighted" | "unweighted" | "expected";
  if (validAvg != null && validAvg > WEIGHTED_SCALE_THRESHOLD) {
    ref = validAvg;
    refKind = "weighted";
  } else if (validAvg != null) {
    ref = validAvg;
    refKind = "unweighted";
  } else {
    ref = interp(admit, EXPECTED_GPA_BY_ADMIT);
    refKind = "expected";
  }
  let student: number | null = null;
  let estimated = false;
  if (refKind === "weighted") {
    if (studentW != null) student = studentW;
    else if (studentUw != null) { student = studentUw + bump; estimated = true; }
  } else {
    if (studentUw != null) student = studentUw;
    else if (studentW != null) { student = clamp(studentW - bump, 0, 4); estimated = true; }
  }
  if (student == null) {
    push("No GPA listed, so grades aren't counted", 0);
    conf -= 0.75;
  } else {
    const diff = (student - ref) * (refKind === "weighted" ? WEIGHTED_DIFF_DAMPING : 1);
    const d = interp(diff, GPA_DIFF_KNOTS) * interp(admit, GPA_SCALE_BY_ADMIT);
    const what = refKind === "expected" ? "what's typical for a school this selective" : "their admitted students' average";
    const label =
      diff >= 0.05
        ? `Your GPA is above ${what}`
        : diff <= -0.05
          ? `Your GPA is below ${what}`
          : `Your GPA is about ${refKind === "expected" ? what : `the same as ${what}`}`;
    L += push(label, d);
    if (refKind === "expected") conf -= 0.25;
    if (estimated) conf -= 0.25;
  }

  // 4) Rigor & activities (small; bigger at selective schools; capped together)
  let dRigor = (RIGOR_DELTA[profile.rigor] ?? 0) * holistic;
  let dAct = (ACTIVITIES_DELTA[profile.activities_strength] ?? 0) * holistic;
  const soft = dRigor + dAct;
  if (Math.abs(soft) > RIGOR_ACTIVITIES_CAP) {
    const k = RIGOR_ACTIVITIES_CAP / Math.abs(soft);
    dRigor *= k;
    dAct *= k;
  }
  if (Math.abs(dRigor) > 0.005) {
    L += push(
      dRigor > 0 ? "You're taking challenging classes" : "Your schedule is lighter than many applicants'",
      dRigor,
    );
  }
  if (Math.abs(dAct) > 0.005) {
    L += push(
      dAct > 0 ? "Your activities stand out" : "Your activities list is on the light side",
      dAct,
    );
  }

  // 5) Residency at public schools
  if (isPublic(college)) {
    const inState = isInState(college, profile);
    if (inState != null) {
      const own = rate(inState ? college.cds?.in_state_admit_rate : college.cds?.out_of_state_admit_rate);
      let d: number;
      if (own != null) {
        d = clamp(logit(own) - logit(admit), -RESIDENCY_CAP, RESIDENCY_CAP);
      } else {
        d = inState ? RESIDENCY_DEFAULT_DELTA : -RESIDENCY_DEFAULT_DELTA;
      }
      const label = inState
        ? `You're in-state — public colleges favor their own residents${own != null ? ` (about ${fmtPct(own)} admitted)` : ""}`
        : `You're out-of-state — this public college admits fewer non-residents${own != null ? ` (about ${fmtPct(own)} admitted)` : ""}`;
      L += push(label, d);
    }
  }

  // 6) Early plans
  let usedEd = false;
  if (offersEd(college) && profile.plan === "ed_ok") {
    const ed = rate(college.cds?.ed_admit_rate);
    const rdOrAll = rate(college.cds?.rd_admit_rate) ?? (base.source === "overall" ? admit : null);
    let d = ED_DEFAULT_BOOST;
    if (ed != null && rdOrAll != null) {
      d = clamp((logit(ed) - logit(rdOrAll)) * ED_POOL_DISCOUNT, 0, ED_MAX_BOOST);
    }
    L += push("If you apply Early Decision (binding)", d);
    usedEd = true;
    caveats.push(
      "Early Decision is binding — if admitted you must attend, and you can only apply ED to one school. Use it only for a clear first choice whose cost works.",
    );
    caveats.push(
      "ED admit rates look higher partly because ED applicants are often stronger (including recruited athletes); we count only part of that gap.",
    );
  }
  if (!usedEd && offersEa(college) && profile.plan !== "rd_only") {
    L += push("Applying Early Action may help a little", EA_BOOST);
  }

  // 7) Gated / competitive-entry major
  const primary = Array.isArray(profile.majors) ? profile.majors[0] : undefined;
  if (isGatedMajor(college, primary)) {
    L += push(`${cap(majorLabel(primary))} is a limited-entry major here`, GATED_MAJOR_PENALTY);
    caveats.push(`Getting into ${majorLabel(primary)} here is harder than getting into the college — check how students enter the major.`);
  }
  if (primary && primary !== "undecided") {
    const note = programFor(college, primary);
    const text = note ? `${note.how_to_enter ?? ""} ${note.notes ?? ""}` : "";
    if (AUDITION_RE.test(text)) {
      caveats.push(`${cap(majorLabel(primary))} may require an audition or portfolio — that review matters a lot.`);
    }
  }

  // 8) First-generation bump at selective schools
  if (profile.first_gen && admit < FIRST_GEN_MAX_ADMIT) {
    L += push("First in your family to attend college — selective schools value that", FIRST_GEN_BOOST);
  }

  // ── Probability, caps, band
  if (!Number.isFinite(L)) L = logit(admit);
  let cap01 = P_MAX;
  const ultra = base.source !== "default" && admit < ULTRA_SELECTIVE_RATE;
  if (ultra) {
    cap01 = Math.min(P_MAX, ULTRA_SELECTIVE_MULTIPLIER * admit);
    caveats.push("Very selective — even top applicants are usually turned down, so treat this as a reach for anyone.");
  }
  if (base.source === "default") cap01 = Math.min(cap01, UNKNOWN_ADMIT_P_CAP);
  const capP = (x: number) => clamp(x, P_MIN, Math.max(P_MIN, cap01));
  const p = capP(sigmoid(L));

  const confidence: OddsResult["confidence"] = forceLow ? "low" : conf >= CONF_HIGH_MIN ? "high" : conf >= CONF_MEDIUM_MIN ? "medium" : "low";
  const hw = BAND_HALF_WIDTH[confidence];
  let low = Math.min(p, capP(sigmoid(L - hw)));
  // A guessed starting point can be far off in either direction: keep the band honestly wide.
  if (base.source === "default") low = Math.min(low, TIER_CUTS.reach);
  const high = Math.max(p, capP(sigmoid(L + hw)));

  let tier: Tier = ultra ? "high_reach" : tierFromP(p);
  // Honesty: don't call something a safety on thin data.
  if (tier === "safety" && confidence === "low" && low < TIER_CUTS.likely) tier = "likely";

  return {
    p: round3(p),
    low: round3(low),
    high: round3(high),
    tier,
    confidence,
    factors,
    caveats: dedupe(caveats),
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

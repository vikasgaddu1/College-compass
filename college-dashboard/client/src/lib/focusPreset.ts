// Robotics + AI focus preset.
//
// Builds a balanced shortlist by admissions tier, then ranks within each tier by
// how strong the school actually is for robotics and AI.
//
// The tiering is NOT baked into the dataset. It runs the same client-side
// classify() heuristic the /odds page uses, reading the applicant's own numbers
// from their local profile. No applicant name, score or GPA appears in this file
// or anywhere in the repository — the shape of the shortlist is committed, the
// applicant's data stays in localStorage / their Supabase workspace.

import { School, schools } from "./data";
import { ApplicantProfile, OddsThresholds, OddsTier, classify } from "./applicantProfile";

/** How many schools to pick per tier. */
export interface FocusSpec {
  high_reach: number;
  reach: number;
  target: number;
  likely: number;
}

export const DEFAULT_FOCUS_SPEC: FocusSpec = { high_reach: 1, reach: 2, target: 4, likely: 3 };

export interface FocusPick {
  school: School;
  tier: OddsTier;
  fit: number;
  rate: number | null;
  context: string;
  reason: string;
  /** Set when the school carries a researched robotics pathway caveat. */
  caveat: string | null;
  /** ABET background on the robotics credential. Context, not a warning. */
  accreditation: string | null;
}

export interface FocusResult {
  picks: FocusPick[];
  /**
   * The next-best candidates in each tier that did not make the cut. Fit scores
   * often separate by a few hundredths, which is not a meaningful difference, so
   * these are surfaced rather than hidden behind a falsely crisp cutoff.
   */
  runnersUp: { tier: OddsTier; pick: FocusPick; gapFromLastPick: number }[];
  /** Tiers where fewer schools were available than requested. */
  shortfalls: { tier: OddsTier; wanted: number; got: number }[];
  /** Schools excluded because their robotics route is closed or not open to freshmen. */
  excluded: { school: School; why: string }[];
  /**
   * Schools that qualify on admissions odds but do not clear the robotics
   * evidence bar, so they are never auto-picked. Surfaced rather than hidden:
   * several are excellent for AI and remain worth selecting by hand.
   */
  belowBar: { school: School; tier: OddsTier; robotics_curriculum: number | null; why: string }[];
}


/**
 * Minimum researched robotics-curriculum score for a school to be auto-picked
 * onto a *robotics* shortlist.
 *
 * Without this, the preset fills each tier's quota with whatever is available at
 * that admit rate, whether or not the school teaches robotics. UIUC was the case
 * that exposed it: three undergraduate robotics courses, no robotics minor,
 * concentration, degree or capstone, yet auto-picked because it was one of only
 * two schools in the REACH band. A quota is not evidence.
 *
 * 4 represents a documented, structured robotics route with degree-applicable
 * coursework and a credential or design/project pathway. It is not a course
 * count. Schools below the bar stay fully available to select by
 * hand, and are listed with the reason.
 */
export const MIN_ROBOTICS_CURRICULUM = 4;

/**
 * Composite robotics + AI strength, 0-5.
 * Undergraduate robotics curriculum/access carry 65%, hands-on projects 15%,
 * foundations 10%, and supporting AI coursework 10%. A lab's research domain
 * does not establish that its undergraduate courses or lab seats are accessible.
 */
export function roboticsAiFit(s: School): number {
  const ax = s.axes;
  const rc = ax.robotics_curriculum ?? 0;
  const ra = ax.robotics_access ?? 0;

  let fit = rc * 0.40 + ra * 0.25 + (ax.hands_on ?? 0) * 0.15
    + (ax.foundations ?? 0) * 0.10 + (ax.program_depth ?? 0) * 0.10;

  // Available but behind a later competitive application: rank slightly lower.
  if (s.robotics_pathway_risk?.severity === "internal_gate") fit -= 0.25;

  // Accreditation is contextual rather than an automatic ranking penalty.
  // Engineering and engineering technology have different curricula; graduate
  // programs, employers and licensing boards set their own eligibility rules.

  return Math.round(fit * 100) / 100;
}

/**
 * Exclude a school only when the unavailable route is the basis of its robotics
 * standing. A caveat on a side pathway must not remove the whole school:
 * Northeastern's degree-completion mechatronics program is irrelevant to a
 * first-year applicant whose route there is the robotics minor and the Institute
 * for Experiential Robotics, so it stays eligible.
 */
function hardExclusion(s: School): string | null {
  const r = s.robotics_pathway_risk;
  if (!r || !r.undermines_robotics_score) return null;
  if (r.severity === "closed") return `${r.affects} is closed to new declarations`;
  if (r.severity === "not_freshman") return `${r.affects} is not a first-year entry path`;
  return null;
}

export function buildRoboticsFocus(
  profile: ApplicantProfile,
  thresholds: OddsThresholds,
  spec: FocusSpec = DEFAULT_FOCUS_SPEC,
  pool: School[] = schools,
  useRecommendedDoor = true,
): FocusResult {
  const excluded: FocusResult["excluded"] = [];
  const belowBar: FocusResult["belowBar"] = [];
  const scored: FocusPick[] = [];

  for (const s of pool) {
    if (!useRecommendedDoor && s.recommended_admission_door && s.recommended_admission_door !== thresholds.pathway) {
      excluded.push({ school: s, why: "The recorded robotics curriculum score describes a different primary application route. Compare the alternative credential manually; its fit is not automatically borrowed." });
      continue;
    }
    const why = hardExclusion(s);
    if (why) {
      excluded.push({ school: s, why });
      continue;
    }
    const routeThresholds = { ...thresholds, pathway: useRecommendedDoor ? (s.recommended_admission_door ?? thresholds.pathway) : thresholds.pathway };
    const r = classify((s as any).admissions, (s as any).nc_applicant_note, profile, routeThresholds);
    if (r.tier === "NEEDS_DATA") continue; // never recommend on absent data

    // Odds alone must not put a school on a robotics shortlist.
    const rc = s.axes.robotics_curriculum ?? 0;
    if (rc < MIN_ROBOTICS_CURRICULUM) {
      const courses = s.robotics_curriculum_detail?.course_count_undergrad;
      belowBar.push({
        school: s,
        tier: r.tier,
        robotics_curriculum: s.axes.robotics_curriculum ?? null,
        why: `robotics curriculum ${rc}/5${courses != null ? `, ${courses} undergraduate robotics course${courses === 1 ? "" : "s"}` : ""}`
          + `${s.robotics_credential ? "" : ", no robotics degree, minor or concentration"}`,
      });
      continue;
    }

    scored.push({
      school: s,
      tier: r.tier,
      fit: roboticsAiFit(s),
      rate: r.effective_admit_rate,
      context: r.admit_rate_context,
      reason: r.reason,
      caveat: buildCaveat(s),
      accreditation: buildAccreditationNote(s),
    });
  }

  const want: [OddsTier, number][] = [
    ["HIGH_REACH", spec.high_reach],
    ["REACH", spec.reach],
    ["TARGET", spec.target],
    ["LIKELY", spec.likely],
  ];

  const picks: FocusPick[] = [];
  const shortfalls: FocusResult["shortfalls"] = [];
  const runnersUp: FocusResult["runnersUp"] = [];

  for (const [tier, n] of want) {
    const avail = scored
      .filter(p => p.tier === tier)
      .sort((a, b) => b.fit - a.fit || a.school.short.localeCompare(b.school.short));
    const chosen = avail.slice(0, n);
    picks.push(...chosen);
    if (avail.length < n) shortfalls.push({ tier, wanted: n, got: avail.length });

    const last = chosen[chosen.length - 1];
    for (const p of avail.slice(n, n + 2)) {
      runnersUp.push({
        tier,
        pick: p,
        gapFromLastPick: last ? Math.round((last.fit - p.fit) * 100) / 100 : 0,
      });
    }
  }

  return { picks, runnersUp, shortfalls, excluded, belowBar };
}

/**
 * Accreditation background — informational, not a warning. Robotics and AI work
 * is unlicensed: there is no certificate or licence that ABET commission gates,
 * and employers and CS/robotics graduate programs do not filter on it. It is
 * recorded because it shapes the flavour of the coursework, not because it is a
 * reason to avoid a school.
 */
function buildAccreditationNote(s: School): string | null {
  const cred = s.robotics_credential;
  if (cred?.abet_commission === "ETAC") {
    return (
      `${cred.program_name} is ABET engineering technology (ETAC) rather than engineering (EAC) — ` +
      `applied and hands-on. Compare its mathematics, design and controls requirements with ` +
      `the engineering route, and check the prerequisites of any intended graduate program or licensure board.` +
      (cred.eac_alternative ? ` EAC alternative here: ${cred.eac_alternative}` : "")
    );
  }
  if (cred?.abet_commission === "NOT_ABET_ACCREDITED") {
    return (
      `${cred.program_name} has no verified ABET accreditation in this dataset. Review the degree's ` +
      `curriculum and the requirements of prospective graduate programs or licensing boards; absence of ` +
      `accreditation does not by itself establish curriculum quality or employer eligibility.`
    );
  }
  return null;
}

/** A genuine obstacle to actually getting into the robotics route. */
function buildCaveat(s: School): string | null {
  if (s.robotics_pathway_risk?.severity === "internal_gate") {
    return `${s.robotics_pathway_risk.affects}: ${s.robotics_pathway_risk.note}`;
  }
  return null;
}

export const TIER_LABEL: Record<OddsTier, string> = {
  HIGH_REACH: "High reach",
  REACH: "Reach",
  TARGET: "Target",
  LIKELY: "Likely",
  NEEDS_DATA: "Needs data",
};

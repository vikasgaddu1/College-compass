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
}

const DOMAIN_MAX = 20; // 10 domains x 2 points for "strong"

/**
 * Composite robotics + AI strength, 0-5.
 * Robotics carries the most weight (the point of the preset), then general
 * program depth and research access, then how broadly the school covers the ten
 * researched robotics subdomains.
 */
export function roboticsAiFit(s: School): number {
  const ax = s.axes;
  const rc = ax.robotics_curriculum ?? 0;
  const ra = ax.robotics_access ?? 0;

  const dom = s.robotics_domains ?? {};
  const strong = Object.values(dom).filter(d => d.coverage === "strong").length;
  const present = Object.values(dom).filter(d => d.coverage === "present").length;
  const breadth = ((strong * 2 + present) / DOMAIN_MAX) * 5;

  const core = [ax.program_depth, ax.research_access]
    .filter((v): v is number => typeof v === "number");
  const coreAvg = core.length ? core.reduce((a, b) => a + b, 0) / core.length : 0;

  let fit = ((rc + ra) / 2) * 0.45 + coreAvg * 0.35 + breadth * 0.20;

  // Available but behind a later competitive application: rank slightly lower.
  if (s.robotics_pathway_risk?.severity === "internal_gate") fit -= 0.25;

  // ABET commission deliberately does NOT affect this score. Robotics and AI are
  // unlicensed: no certificate or licence depends on which commission accredited
  // the degree, and employers and CS and robotics graduate programs do not filter
  // on it. An ETAC degree is more applied and less theoretical, which is worth
  // knowing when comparing curricula -- it is surfaced as context on the school,
  // not as a ranking penalty. The one case where the commission genuinely binds
  // is PE licensure, which belongs to civil and structural work rather than to
  // this path.

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
): FocusResult {
  const excluded: FocusResult["excluded"] = [];
  const scored: FocusPick[] = [];

  for (const s of pool) {
    const why = hardExclusion(s);
    if (why) {
      excluded.push({ school: s, why });
      continue;
    }
    const r = classify((s as any).admissions, (s as any).nc_applicant_note, profile, thresholds);
    if (r.tier === "NEEDS_DATA") continue; // never recommend on absent data
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

  return { picks, runnersUp, shortfalls, excluded };
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
      `applied and hands-on rather than theory-heavy. Not a factor for robotics or AI roles; it ` +
      `matters mainly for PE licensure or a traditional engineering master's.` +
      (cred.eac_alternative ? ` EAC alternative here: ${cred.eac_alternative}` : "")
    );
  }
  if (cred?.abet_commission === "NOT_ABET_ACCREDITED") {
    return (
      `${cred.program_name} is not ABET-accredited. The curriculum is still theory-heavy, and ` +
      `robotics and AI hiring and graduate admissions do not look at ABET — the only real ` +
      `consequence is that it is not a PE licensure route.`
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

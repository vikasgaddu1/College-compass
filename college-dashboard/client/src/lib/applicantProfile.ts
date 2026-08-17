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
}

export interface OddsThresholds {
  likely_admit_min: number;      // 0.35
  target_admit_min: number;      // 0.20
  high_reach_admit_max: number;  // 0.10
  sat_75_bonus: number;          // pts above mid-50 high => likely bump
  gated_downgrade: boolean;      // downgrade one tier when major_admit_context flags gated CS
}

const DEFAULT_PROFILE: ApplicantProfile = {
  gpa_uw: null, gpa_w: null, sat: null, act: null,
  test_plan: "optional_hold", rigor_note: "",
  home_state: "NC",
};

const DEFAULT_THRESHOLDS: OddsThresholds = {
  likely_admit_min: 0.35,
  target_admit_min: 0.20,
  high_reach_admit_max: 0.10,
  sat_75_bonus: 0,
  gated_downgrade: true,
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

  // Gated-major downgrade, driven by the researched `cs_gate` enum rather than
  // keyword-matching prose. The old regex was negation-blind and penalised WPI,
  // RPI and Florida for explicitly NOT having a major-level gate.
  let gated_downgrade_applied = false;
  const gate: string | undefined = admissions.cs_gate;
  if (t.gated_downgrade && gate === "strong" && tier !== "HIGH_REACH") {
    const order: OddsTier[] = ["LIKELY","TARGET","REACH","HIGH_REACH"];
    const idx = order.indexOf(tier);
    if (idx >= 0 && idx < order.length - 1) {
      tier = order[idx + 1];
      gated_downgrade_applied = true;
      reason += " Downgraded one tier: CS/AI sits behind a strong separate admission or internal gate here.";
    }
  }

  return { tier, reason, effective_admit_rate: rate, admit_rate_context: ctx, used_test_score, gated_downgrade_applied, cs_gate: gate ?? null };
}

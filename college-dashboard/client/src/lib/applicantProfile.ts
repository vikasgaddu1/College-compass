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
  effective_admit_rate: number | null;   // NC-adjusted for publics
  admit_rate_context: string; // "OOS" | "in-state" | "overall"
  used_test_score: boolean;
  gated_downgrade_applied: boolean;
}

export function classify(admissions: any, nc_note: string | undefined, profile: ApplicantProfile, t: OddsThresholds): OddsResult {
  if (!admissions || typeof admissions.overall_admit_rate !== "number") {
    return { tier: "NEEDS_DATA", reason: "This school has not published a sourced overall admit rate.", effective_admit_rate: null, admit_rate_context: "n/a", used_test_score: false, gated_downgrade_applied: false };
  }

  // Pick the effective admit rate. For a NC applicant:
  //  - If the school is NC (UNC-CH, NC State, Duke) and admissions.admit_rate_note contains "in-state" — use in-state
  //  - If publics and OOS rate is available in admit_rate_note or nc_applicant_note, prefer OOS
  //  - Otherwise fall back to overall.
  let rate = admissions.overall_admit_rate as number;
  let ctx = "overall";

  const note = (admissions.admit_rate_note || "") + " " + (nc_note || "");
  const ncMatch = note.match(/NC[^0-9]{0,20}(\d{1,2}(?:\.\d+)?)\s*%/i);
  const oosMatch = note.match(/OOS[^0-9]{0,20}(\d{1,2}(?:\.\d+)?)\s*%/i);
  const majorAdvantage = /MAJOR ADVANTAGE|friendliest/i.test(nc_note || "");

  if (majorAdvantage && ncMatch) {
    rate = parseFloat(ncMatch[1]) / 100;
    ctx = "in-state (NC)";
  } else if (oosMatch) {
    rate = parseFloat(oosMatch[1]) / 100;
    ctx = "out-of-state (from NC)";
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

  // Gated major downgrade
  let gated_downgrade_applied = false;
  if (t.gated_downgrade) {
    const ctxTxt = (admissions.major_admit_context || "").toLowerCase();
    const gatedSignal =
      /direct[- ]admit/.test(ctxTxt) ||
      /gated|restricted|competitive|separately admitted|closed to/.test(ctxTxt) ||
      /cs \d.*%/.test(ctxTxt) ||
      /separately/.test(ctxTxt);
    if (gatedSignal && tier !== "HIGH_REACH") {
      const order: OddsTier[] = ["LIKELY","TARGET","REACH","HIGH_REACH"];
      const idx = order.indexOf(tier);
      if (idx >= 0 && idx < order.length - 1) {
        tier = order[idx + 1];
        gated_downgrade_applied = true;
        reason += " Downgraded one tier: this school flags a gated/competitive CS admit (see major_admit_context).";
      }
    }
  }

  return { tier, reason, effective_admit_rate: rate, admit_rate_context: ctx, used_test_score, gated_downgrade_applied };
}

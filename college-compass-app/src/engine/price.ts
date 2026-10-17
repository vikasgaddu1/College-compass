/**
 * Estimated yearly net price for this student (what the family pays after grants).
 *
 * Order of preference:
 *   1. net_price_by_income for the student's income band (IPEDS/Scorecard style; in-state at publics)
 *   2. avg_net_price (all aided students) — also used when income is "prefer_not"
 *   3. cost_of_attendance ("sticker price", before any aid)
 * Out-of-state students at public colleges: net-price figures describe in-state students,
 * so we add (tuition_out_of_state − tuition_in_state) and say so.
 */
import type { College, IncomeNetPrice, StudentProfile } from "../types";
import { fmtK, usd } from "./math";
import { isInState } from "./odds";

export interface NetPriceEstimate {
  value: number | null;
  note: string;
}

/** A published COA at or above out-of-state tuition + this is assumed to already be the out-of-state COA. */
export const COA_ALREADY_OUT_OF_STATE_MARGIN = 12000;

const BAND_LABEL: Readonly<Record<keyof IncomeNetPrice, string>> = {
  "0_30k": "under $30k",
  "30_48k": "$30k–$48k",
  "48_75k": "$48k–$75k",
  "75_110k": "$75k–$110k",
  "110k_plus": "over $110k",
};

function roundTo100(x: number): number {
  return Math.round(x / 100) * 100;
}

export function estimateNetPrice(college: College, profile: StudentProfile): NetPriceEstimate {
  const band = profile.income_band;
  const byIncome = college.net_price_by_income ?? ({} as Partial<IncomeNetPrice>);
  const avg = usd(college.avg_net_price);
  const coa = usd(college.cost_of_attendance);

  let value: number | null = null;
  let kind: "band" | "avg" | "coa" | "none" = "none";
  const notes: string[] = [];

  if (band !== "prefer_not" && band in BAND_LABEL) {
    const v = usd(byIncome[band as keyof IncomeNetPrice]);
    if (v != null && v > 0) {
      value = v;
      kind = "band";
      notes.push(`Average net price for families earning ${BAND_LABEL[band as keyof IncomeNetPrice]}`);
    }
  }
  if (value == null && avg != null && avg > 0) {
    value = avg;
    kind = "avg";
    notes.push(
      band === "prefer_not"
        ? "Average net price across all aided students"
        : "Average net price across all aided students (no figure for your income band)",
    );
  }
  if (value == null && coa != null && coa > 0) {
    value = coa;
    kind = "coa";
    notes.push("Sticker price (full cost before aid) — financial aid could lower this");
  }

  if (value == null) {
    return { value: null, note: "Cost data not found — try the college's net price calculator" };
  }

  // Out-of-state adjustment at public colleges.
  if (college.ownership === "public" && isInState(college, profile) === false) {
    const tin = usd(college.tuition_in_state);
    const tout = usd(college.tuition_out_of_state);
    const diff = tin != null && tout != null ? tout - tin : null;
    if (diff != null && diff > 0) {
      const alreadyOut = kind === "coa" && tout != null && value >= tout + COA_ALREADY_OUT_OF_STATE_MARGIN;
      if (!alreadyOut) {
        value += diff;
        notes.push(`plus about ${fmtK(diff)} out-of-state tuition`);
      } else {
        notes.push("out-of-state cost");
      }
    } else if (kind !== "coa") {
      notes.push("in-state figure — out-of-state students usually pay more");
    } else {
      notes.push("may not include out-of-state tuition");
    }
  }

  return { value: roundTo100(value), note: notes.join("; ") };
}

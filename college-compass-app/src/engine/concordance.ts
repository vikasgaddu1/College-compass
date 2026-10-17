/**
 * ACT → SAT concordance.
 *
 * Source: "Guide to the 2018 ACT/SAT Concordance" (ACT, Inc. & College Board, June 2018),
 * Table A1 — ACT composite → single-point SAT total (EBRW + Math) concordance.
 * The official table starts at ACT 9 (SAT 590). ACT 1–8 are below the published table;
 * we extrapolate ~40 SAT points per ACT point and floor at the SAT minimum of 400.
 */
import type { StudentProfile } from "../types";
import { num } from "./math";

export const ACT_TO_SAT_2018: Readonly<Record<number, number>> = Object.freeze({
  36: 1590, 35: 1540, 34: 1500, 33: 1460, 32: 1430, 31: 1400, 30: 1370,
  29: 1340, 28: 1310, 27: 1280, 26: 1240, 25: 1210, 24: 1180, 23: 1140,
  22: 1110, 21: 1080, 20: 1040, 19: 1010, 18: 970, 17: 930, 16: 890,
  15: 850, 14: 800, 13: 760, 12: 710, 11: 670, 10: 630, 9: 590,
  // Extrapolated below the published table (documented above).
  8: 550, 7: 510, 6: 470, 5: 430, 4: 400, 3: 400, 2: 400, 1: 400,
});

/** Convert an ACT composite (1–36) to an SAT total. Non-integers are rounded; out-of-range → null. */
export function actToSat(act: unknown): number | null {
  const v = num(act);
  if (v == null) return null;
  const a = Math.round(v);
  if (a < 1 || a > 36) return null;
  return ACT_TO_SAT_2018[a] ?? null;
}

/** Student's best SAT-equivalent score: the higher of the SAT and the concorded ACT. */
export function bestSat(profile: Pick<StudentProfile, "sat" | "act">): number | null {
  const s = num(profile.sat);
  const sat = s != null && s >= 400 && s <= 1600 ? s : null;
  const fromAct = actToSat(profile.act);
  if (sat == null) return fromAct;
  if (fromAct == null) return sat;
  return Math.max(sat, fromAct);
}

/**
 * A school's SAT 25th/75th range, using its ACT range (concorded) when SAT data is missing.
 * Returns null if neither range is usable.
 */
export function schoolSatRange(c: {
  sat_25?: number | null; sat_75?: number | null; act_25?: number | null; act_75?: number | null;
}): { p25: number; p75: number; fromAct: boolean } | null {
  const s25 = num(c.sat_25);
  const s75 = num(c.sat_75);
  if (s25 != null && s75 != null && s25 >= 400 && s75 <= 1600 && s75 >= s25) {
    return { p25: s25, p75: s75, fromAct: false };
  }
  const a25 = actToSat(c.act_25);
  const a75 = actToSat(c.act_75);
  if (a25 != null && a75 != null && a75 >= a25) return { p25: a25, p75: a75, fromAct: true };
  return null;
}

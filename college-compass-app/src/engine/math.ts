/** Small numeric helpers shared by the engine. Pure functions only. */

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/** log(p / (1 - p)), with p kept away from 0 and 1 so the result stays finite. */
export function logit(p: number): number {
  const q = clamp(p, 1e-4, 1 - 1e-4);
  return Math.log(q / (1 - q));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Piecewise-linear interpolation over sorted [x, y] knots; flat outside the range. */
export function interp(x: number, knots: ReadonlyArray<readonly [number, number]>): number {
  if (knots.length === 0) return NaN;
  const first = knots[0]!;
  const last = knots[knots.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i]!;
    const [x0, y0] = knots[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

export function round(x: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** "$12k" style rounding for short UI strings. */
export function fmtK(usd: number): string {
  const k = Math.round(Math.abs(usd) / 1000);
  return `$${k}k`;
}

export function fmtPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/**
 * Defensive number reader for AI-researched data: returns a finite number or null.
 * Plain numeric strings ("12,345", "$28000") are accepted; anything fancier ("$28k") is null.
 */
export function num(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") {
    const t = x.replace(/[,\s$]/g, "");
    if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/** A positive dollar amount, or null. */
export function usd(x: unknown): number | null {
  const v = num(x);
  return v != null && v >= 0 ? v : null;
}

/**
 * A rate in 0..1. Values in (1, 100] are treated as percentages (AI output sometimes says 12 for 12%).
 * Zero and out-of-range values → null (a 0% admit rate is never real data).
 */
export function rate(x: unknown): number | null {
  let v = num(x);
  if (v == null) return null;
  if (v > 1 && v <= 100) v = v / 100;
  if (v <= 0 || v > 1) return null;
  return v;
}

/** Mean of the non-null values, or null when there are none. */
export function mean(xs: ReadonlyArray<number | null | undefined>): number | null {
  const ok = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

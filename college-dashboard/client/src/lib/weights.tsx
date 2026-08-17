import { createContext, useContext, useState, ReactNode, useMemo, useCallback, useEffect } from "react";
import { School } from "./data";

/**
 * Personal-priorities weighting. The user can weight each of the 7 aggregate
 * axes from 0-5 (0 = "don't care", 5 = "must have"). We compute a personal
 * score per school as the weighted average of their axis scores, and expose
 * that so the Overview page can sort or highlight by it.
 */

export type AxisKey =
  | "program_depth"
  | "foundations"
  | "hands_on"
  | "research_access"
  | "campus_life"
  | "ambition_healthy"
  | "outcomes";

export type Weights = Record<AxisKey, number>;

export const axisMeta: { key: AxisKey; label: string; blurb: string }[] = [
  { key: "program_depth",     label: "AI curriculum depth", blurb: "Breadth of AI courses, LLMs/agents, current availability" },
  { key: "research_access",   label: "Research & faculty access", blurb: "Undergrad research programs, faculty mentorship, compute" },
  { key: "hands_on",          label: "Hands-on projects", blurb: "Project-based courses, robotics, technical clubs" },
  { key: "foundations",       label: "CS & math foundations", blurb: "Rigor of the required foundations sequence" },
  { key: "ambition_healthy",  label: "Healthy ambition", blurb: "Intense but not cutthroat; strong student agency" },
  { key: "campus_life",       label: "Campus & non-Greek social life", blurb: "Non-Greek scene, non-technical clubs, rec, daily life" },
  { key: "outcomes",          label: "Career & grad-school outcomes", blurb: "Industry placement, PhD/MS prep, 4+1 quality" },
];

const DEFAULT_WEIGHTS: Weights = {
  program_depth: 4,
  research_access: 4,
  hands_on: 3,
  foundations: 3,
  ambition_healthy: 3,
  campus_life: 3,
  outcomes: 3,
};
const STORAGE_KEY = "college-compass-weights.v1";

interface Ctx {
  weights: Weights;
  setWeight: (k: AxisKey, v: number) => void;
  reset: () => void;
  personalScore: (s: School) => number | null;
  isCustomized: boolean;
}

const WeightsCtx = createContext<Ctx | null>(null);

function detectStorage(): boolean {
  try {
    const k = "__ccw_test__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch { return false; }
}

export function WeightsProvider({ children }: { children: ReactNode }) {
  const [weights, setWeights] = useState<Weights>(() => {
    if (typeof window === "undefined" || !detectStorage()) return DEFAULT_WEIGHTS;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_WEIGHTS;
      const parsed = JSON.parse(raw);
      // Validate: must have all 7 keys as numbers 0-5
      const cleaned: Weights = { ...DEFAULT_WEIGHTS };
      for (const k of Object.keys(DEFAULT_WEIGHTS) as AxisKey[]) {
        const v = parsed[k];
        if (typeof v === "number" && v >= 0 && v <= 5) cleaned[k] = v;
      }
      return cleaned;
    } catch { return DEFAULT_WEIGHTS; }
  });

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(weights)); } catch {}
  }, [weights]);

  const setWeight = useCallback((k: AxisKey, v: number) => {
    setWeights(w => ({ ...w, [k]: Math.max(0, Math.min(5, v)) }));
  }, []);
  const reset = useCallback(() => setWeights(DEFAULT_WEIGHTS), []);

  const personalScore = useCallback((s: School): number | null => {
    // Weighted average: sum(weight * axis_score) / sum(weight),
    // with NaN axes skipped (weight doesn't count if the axis has no score).
    let num = 0, denom = 0;
    for (const { key } of axisMeta) {
      const w = weights[key];
      if (w <= 0) continue;
      const av = (s.axes as any)[key];
      if (av == null) continue;
      num += w * av;
      denom += w;
    }
    return denom > 0 ? num / denom : null;
  }, [weights]);

  const isCustomized = useMemo(
    () => (Object.keys(DEFAULT_WEIGHTS) as AxisKey[]).some(k => weights[k] !== DEFAULT_WEIGHTS[k]),
    [weights]
  );

  const value = useMemo<Ctx>(() => ({ weights, setWeight, reset, personalScore, isCustomized }),
    [weights, setWeight, reset, personalScore, isCustomized]);
  return <WeightsCtx.Provider value={value}>{children}</WeightsCtx.Provider>;
}

export function useWeights() {
  const v = useContext(WeightsCtx);
  if (!v) throw new Error("WeightsProvider missing");
  return v;
}

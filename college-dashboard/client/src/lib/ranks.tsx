import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useMemo } from "react";

/**
 * Personal ranking — one integer rank per school slug (1 = top pick).
 * Ranks are stored in localStorage as {slug: rank}. Missing slugs are
 * "unranked" and treated as coming after all ranked schools.
 *
 * We support two workflows:
 * 1. Fine-grained per-school rank input (edit a number)
 * 2. Drag-reorder in the ranked list (auto-renumbers)
 */

const STORAGE_KEY = "college-compass-ranks.v1";

interface Ctx {
  ranks: Record<string, number>;
  getRank: (slug: string) => number | null;
  setRank: (slug: string, rank: number | null) => void;
  moveUp: (slug: string) => void;
  moveDown: (slug: string) => void;
  reorder: (orderedSlugs: string[]) => void;
  clearAll: () => void;
  rankedCount: number;
  storageAvailable: boolean;
}

const RanksCtx = createContext<Ctx | null>(null);

function storageOK(): boolean {
  try {
    const k = "__ccr_test__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch { return false; }
}

/** Normalize ranks so they run 1..N consecutively for whichever slugs are ranked. */
function normalize(rmap: Record<string, number>): Record<string, number> {
  const entries = Object.entries(rmap)
    .filter(([, v]) => typeof v === "number" && v > 0)
    .sort((a, b) => a[1] - b[1]);
  const out: Record<string, number> = {};
  entries.forEach(([slug], i) => { out[slug] = i + 1; });
  return out;
}

export function RanksProvider({ children }: { children: ReactNode }) {
  const storageAvailable = typeof window !== "undefined" && storageOK();

  const [ranks, setRanks] = useState<Record<string, number>>(() => {
    if (!storageAvailable) return {};
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || !parsed) return {};
      // Whitelist number values only
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "number" && v > 0 && Number.isFinite(v)) clean[k] = Math.floor(v);
      }
      return normalize(clean);
    } catch { return {}; }
  });

  useEffect(() => {
    if (!storageAvailable) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ranks)); } catch {}
  }, [ranks, storageAvailable]);

  const getRank = useCallback((slug: string) => ranks[slug] ?? null, [ranks]);

  const setRank = useCallback((slug: string, rank: number | null) => {
    setRanks(prev => {
      const next = { ...prev };
      if (rank == null || rank <= 0) {
        delete next[slug];
      } else {
        // Insert at position `rank`: shift others down as needed
        const target = Math.max(1, Math.floor(rank));
        // Sort current ranked slugs (excluding this one)
        const others = Object.entries(next)
          .filter(([s]) => s !== slug)
          .sort((a, b) => a[1] - b[1])
          .map(([s]) => s);
        // Rebuild: insert slug at position (target-1) among others
        others.splice(Math.min(target - 1, others.length), 0, slug);
        const rebuilt: Record<string, number> = {};
        others.forEach((s, i) => { rebuilt[s] = i + 1; });
        return rebuilt;
      }
      return normalize(next);
    });
  }, []);

  const moveUp = useCallback((slug: string) => {
    setRanks(prev => {
      const cur = prev[slug];
      if (!cur || cur <= 1) return prev;
      const target = cur - 1;
      const other = Object.entries(prev).find(([, v]) => v === target)?.[0];
      const next = { ...prev, [slug]: target };
      if (other) next[other] = cur;
      return next;
    });
  }, []);

  const moveDown = useCallback((slug: string) => {
    setRanks(prev => {
      const cur = prev[slug];
      const max = Math.max(...Object.values(prev), 0);
      if (!cur || cur >= max) return prev;
      const target = cur + 1;
      const other = Object.entries(prev).find(([, v]) => v === target)?.[0];
      const next = { ...prev, [slug]: target };
      if (other) next[other] = cur;
      return next;
    });
  }, []);

  const reorder = useCallback((orderedSlugs: string[]) => {
    const next: Record<string, number> = {};
    orderedSlugs.forEach((s, i) => { next[s] = i + 1; });
    setRanks(next);
  }, []);

  const clearAll = useCallback(() => setRanks({}), []);

  const rankedCount = useMemo(() => Object.keys(ranks).length, [ranks]);

  const value = useMemo<Ctx>(() => ({
    ranks, getRank, setRank, moveUp, moveDown, reorder, clearAll, rankedCount, storageAvailable,
  }), [ranks, getRank, setRank, moveUp, moveDown, reorder, clearAll, rankedCount, storageAvailable]);

  return <RanksCtx.Provider value={value}>{children}</RanksCtx.Provider>;
}

export function useRanks() {
  const v = useContext(RanksCtx);
  if (!v) throw new Error("RanksProvider missing");
  return v;
}

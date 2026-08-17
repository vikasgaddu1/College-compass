import { createContext, useContext, useState, useMemo, useEffect, ReactNode, useCallback } from "react";
import { schools, School } from "./data";

const STORAGE_KEY = "cc_hidden_schools_v1";

/** localStorage is blocked in sandboxed preview iframes (opaque origin), so probe
 *  before relying on it and fall back to in-memory state. Same pattern as ranks/notes. */
function storageOK(): boolean {
  try {
    const k = "__cch_test__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch { return false; }
}

interface HiddenCtx {
  hidden: Set<string>;
  toggle: (slug: string) => void;
  hide: (slug: string) => void;
  show: (slug: string) => void;
  clear: () => void;
  hideAllExcept: (keep: string[]) => void;
  visible: School[];
  hiddenList: School[];
  isHidden: (slug: string) => boolean;
}

const Ctx = createContext<HiddenCtx | null>(null);

export function HiddenSchoolsProvider({ children }: { children: ReactNode }) {
  const storageAvailable = typeof window !== "undefined" && storageOK();

  const [hidden, setHidden] = useState<Set<string>>(() => {
    if (!storageAvailable) return new Set();
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      // Only keep slugs that still exist in the dataset, so a renamed or removed
      // school can never permanently hide itself with no way to unhide.
      const valid = new Set(schools.map(s => s.slug));
      return new Set(parsed.filter(x => typeof x === "string" && valid.has(x)));
    } catch { return new Set(); }
  });

  useEffect(() => {
    if (!storageAvailable) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(hidden)));
    } catch {}
  }, [hidden, storageAvailable]);

  const toggle = useCallback((slug: string) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);
  const hide = useCallback((slug: string) => setHidden(prev => new Set(prev).add(slug)), []);
  const show = useCallback((slug: string) => setHidden(prev => {
    const next = new Set(prev); next.delete(slug); return next;
  }), []);
  const clear = useCallback(() => setHidden(new Set()), []);
  const hideAllExcept = useCallback((keep: string[]) => {
    const keepSet = new Set(keep);
    setHidden(new Set(schools.filter(s => !keepSet.has(s.slug)).map(s => s.slug)));
  }, []);
  const isHidden = useCallback((slug: string) => hidden.has(slug), [hidden]);

  const visible = useMemo(() => schools.filter(s => !hidden.has(s.slug)), [hidden]);
  const hiddenList = useMemo(() => schools.filter(s => hidden.has(s.slug)), [hidden]);

  return (
    <Ctx.Provider value={{ hidden, toggle, hide, show, clear, hideAllExcept, visible, hiddenList, isHidden }}>
      {children}
    </Ctx.Provider>
  );
}

export function useHidden() {
  const v = useContext(Ctx);
  if (!v) throw new Error("HiddenSchoolsProvider missing");
  return v;
}

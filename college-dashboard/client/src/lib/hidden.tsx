import { createContext, useContext, useState, useMemo, ReactNode, useCallback } from "react";
import { schools, School } from "./data";

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
  // No localStorage in sandbox — this stays in memory, which is fine for a session.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

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

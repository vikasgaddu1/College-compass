/** App state: profile, colleges, shortlist, notes, chat and prefs — persisted under `cc2:`. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AiMessage, ChatGPTAccount, College, RankedCollege, StudentProfile } from "@/types";
import { clearAll, exportAll, importAll, load, save } from "@/lib/storage";
import { auth, balance, devKey, isConnected, rankColleges, type BalancedListResult } from "./services";
import { DEMO_COLLEGES, DEMO_PROFILE } from "./fixtures";
import { defaultProfile } from "./catalog";

export type SortKey = "fit" | "odds" | "price";

export interface Prefs {
  model: string | null;
  sort: SortKey;
  seenPlanSheet: boolean;
  demo: boolean;
  onboardingDone: boolean;
  researchedAt: string | null;
  theme: "system";
  /** How many colleges a research run aims for (planner tops up to this). */
  researchCount: 6 | 12 | 18;
  /** iOS app: the student asked to be notified when research finishes, so later runs arm it automatically. */
  notifyWhenReady: boolean;
  /** Share researched college facts (never personal data) so other students skip research. */
  shareResearch: boolean;
}

const DEFAULT_PREFS: Prefs = { model: null, sort: "fit", seenPlanSheet: false, demo: false, onboardingDone: false, researchedAt: null, theme: "system", researchCount: 12, notifyWhenReady: false, shareResearch: true };

export interface Store {
  profile: StudentProfile;
  hasProfile: boolean;
  updateProfile: (patch: Partial<StudentProfile>) => void;
  replaceProfile: (p: StudentProfile) => void;
  colleges: College[];
  setColleges: (c: College[]) => void;
  upsertCollege: (c: College) => void;
  removeCollege: (id: string) => void;
  ranked: RankedCollege[];
  balanced: BalancedListResult;
  /** Researched colleges that didn't make the balanced picks. */
  others: RankedCollege[];
  byId: Map<string, RankedCollege>;
  shortlist: string[];
  isSaved: (id: string) => boolean;
  toggleSaved: (id: string) => void;
  moveSaved: (id: string, dir: -1 | 1) => void;
  notes: Record<string, string>;
  setNote: (id: string, text: string) => void;
  chat: AiMessage[];
  setChat: (m: AiMessage[] | ((prev: AiMessage[]) => AiMessage[])) => void;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  account: ChatGPTAccount | null;
  connected: boolean;
  hasDevKey: boolean;
  demo: boolean;
  enterDemo: () => void;
  exitDemo: () => void;
  resetAll: () => void;
  exportJson: () => string;
  importJson: (json: string) => number;
  refreshAuth: () => void;
}

const Ctx = createContext<Store | null>(null);

const K = { profile: "profile", colleges: "colleges", shortlist: "shortlist", notes: "notes", chat: "chat", prefs: "prefs" } as const;

function usePersisted<T>(key: string, fallback: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => load<T>(key, fallback));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    save(key, v);
  }, [key, v]);
  return [v, setV];
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = usePersisted<StudentProfile | null>(K.profile, null);
  const [colleges, setCollegesRaw] = usePersisted<College[]>(K.colleges, []);
  const [shortlist, setShortlist] = usePersisted<string[]>(K.shortlist, []);
  const [notes, setNotes] = usePersisted<Record<string, string>>(K.notes, {});
  const [chat, setChatRaw] = usePersisted<AiMessage[]>(K.chat, []);
  const [prefsRaw, setPrefsRaw] = usePersisted<Partial<Prefs>>(K.prefs, {});
  const prefs = useMemo<Prefs>(() => ({ ...DEFAULT_PREFS, ...prefsRaw }), [prefsRaw]);

  const [authTick, setAuthTick] = useState(0);
  useEffect(() => auth.subscribe(() => setAuthTick((t) => t + 1)), []);
  const refreshAuth = useCallback(() => setAuthTick((t) => t + 1), []);
  const account = useMemo(() => auth.account(), [authTick]);
  const hasDevKey = useMemo(() => !!devKey(), [authTick]);
  const connected = useMemo(() => isConnected(), [authTick]);

  const effectiveProfile = useMemo(() => profile ?? defaultProfile(), [profile]);
  const ranked = useMemo(() => (profile ? rankColleges(colleges, profile) : []), [colleges, profile]);
  const { picks: balanced, others } = useMemo(() => balance(ranked, effectiveProfile), [ranked, effectiveProfile]);
  const byId = useMemo(() => new Map(ranked.map((r) => [r.college.id, r])), [ranked]);

  const updateProfile = useCallback((patch: Partial<StudentProfile>) => setProfile((p) => ({ ...(p ?? defaultProfile()), ...patch })), [setProfile]);
  const replaceProfile = useCallback((p: StudentProfile) => setProfile(p), [setProfile]);

  const setColleges = useCallback((c: College[]) => setCollegesRaw(c), [setCollegesRaw]);
  const upsertCollege = useCallback(
    (c: College) =>
      setCollegesRaw((prev) => {
        const i = prev.findIndex((x) => x.id === c.id || x.name.toLowerCase() === c.name.toLowerCase());
        if (i < 0) return [...prev, c];
        const next = prev.slice();
        next[i] = c;
        return next;
      }),
    [setCollegesRaw],
  );
  const removeCollege = useCallback(
    (id: string) => {
      setCollegesRaw((prev) => prev.filter((c) => c.id !== id));
      setShortlist((prev) => prev.filter((x) => x !== id));
    },
    [setCollegesRaw, setShortlist],
  );

  const isSaved = useCallback((id: string) => shortlist.includes(id), [shortlist]);
  const toggleSaved = useCallback((id: string) => setShortlist((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])), [setShortlist]);
  const moveSaved = useCallback(
    (id: string, dir: -1 | 1) =>
      setShortlist((prev) => {
        const i = prev.indexOf(id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= prev.length) return prev;
        const next = prev.slice();
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      }),
    [setShortlist],
  );
  const setNote = useCallback(
    (id: string, text: string) =>
      setNotes((prev) => {
        const next = { ...prev };
        if (text.trim()) next[id] = text;
        else delete next[id];
        return next;
      }),
    [setNotes],
  );
  const setChat = useCallback((m: AiMessage[] | ((prev: AiMessage[]) => AiMessage[])) => setChatRaw(m), [setChatRaw]);
  const setPrefs = useCallback((patch: Partial<Prefs>) => setPrefsRaw((p) => ({ ...p, ...patch })), [setPrefsRaw]);

  const enterDemo = useCallback(() => {
    setProfile(DEMO_PROFILE);
    setCollegesRaw(DEMO_COLLEGES);
    setPrefsRaw((p) => ({ ...p, demo: true, onboardingDone: true, researchedAt: new Date().toISOString() }));
  }, [setProfile, setCollegesRaw, setPrefsRaw]);
  const exitDemo = useCallback(() => {
    setProfile(null);
    setCollegesRaw([]);
    setShortlist([]);
    setNotes({});
    setChatRaw([]);
    setPrefsRaw({});
  }, [setProfile, setCollegesRaw, setShortlist, setNotes, setChatRaw, setPrefsRaw]);

  const resetAll = useCallback(() => {
    const key = devKey();
    clearAll();
    if (key) save("dev_openai_key", key);
    setProfile(null);
    setCollegesRaw([]);
    setShortlist([]);
    setNotes({});
    setChatRaw([]);
    setPrefsRaw({});
  }, [setProfile, setCollegesRaw, setShortlist, setNotes, setChatRaw, setPrefsRaw]);

  const importJson = useCallback(
    (json: string) => {
      const n = importAll(json);
      if (n > 0) {
        setProfile(load<StudentProfile | null>(K.profile, null));
        setCollegesRaw(load<College[]>(K.colleges, []));
        setShortlist(load<string[]>(K.shortlist, []));
        setNotes(load<Record<string, string>>(K.notes, {}));
        setChatRaw(load<AiMessage[]>(K.chat, []));
        setPrefsRaw(load<Partial<Prefs>>(K.prefs, {}));
      }
      return n;
    },
    [setProfile, setCollegesRaw, setShortlist, setNotes, setChatRaw, setPrefsRaw],
  );

  const value: Store = {
    profile: effectiveProfile,
    hasProfile: !!profile,
    updateProfile,
    replaceProfile,
    colleges,
    setColleges,
    upsertCollege,
    removeCollege,
    ranked,
    balanced,
    others,
    byId,
    shortlist,
    isSaved,
    toggleSaved,
    moveSaved,
    notes,
    setNote,
    chat,
    setChat,
    prefs,
    setPrefs,
    account,
    connected,
    hasDevKey,
    demo: prefs.demo,
    enterDemo,
    exitDemo,
    resetAll,
    exportJson: exportAll,
    importJson,
    refreshAuth,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}

/** Formatting helpers shared by screens. */
export const fmt = {
  usd(n: number | null | undefined, opts: { k?: boolean } = {}): string {
    if (n == null) return "—";
    if (opts.k) return `$${Math.round(n / 1000)}k`;
    return `$${Math.round(n).toLocaleString("en-US")}`;
  },
  pct(p: number | null | undefined): string {
    return p == null ? "—" : `${Math.round(p * 100)}%`;
  },
  band(low: number, high: number): string {
    return `${Math.round(low * 100)}–${Math.round(high * 100)}%`;
  },
  num(n: number | null | undefined): string {
    return n == null ? "—" : n.toLocaleString("en-US");
  },
};

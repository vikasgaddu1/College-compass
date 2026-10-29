/**
 * App state, persisted under `cc2:`. Global: prefs and the lists index. Per list (the active one is
 * loaded): profile, colleges, shortlist, notes and chat — see ./lists for the storage layout.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AiMessage, ChatGPTAccount, College, RankedCollege, StudentProfile } from "@/types";
import { clearAll, exportAll, importAll, load, save } from "@/lib/storage";
import { auth, balance, devKey, isConnected, rankColleges, type BalancedListResult } from "./services";
import { DEMO_COLLEGES, DEMO_PROFILE } from "./fixtures";
import { defaultProfile } from "./catalog";
import { DEFAULT_LIST_NAME, DEMO_LIST_NAME, LISTS_KEY, autoListName, copyProfile, listKey, newListMeta, nextListName, reconcileLists, removeListData, uniqueName, type ListMeta, type ListsIndex } from "./lists";
import { syncDeadlineReminders } from "@/deadlines/schedule";
import { applyChecks, checkCollegeDeadlines, needsDeadlineCheck } from "@/deadlines/check";

export type { ListMeta } from "./lists";

export type SortKey = "fit" | "odds" | "price";

export interface Prefs {
  model: string | null;
  sort: SortKey;
  seenPlanSheet: boolean;
  theme: "system";
  /** How many colleges a research run aims for (planner tops up to this). */
  researchCount: 6 | 12 | 18;
  /** iOS app: the student asked to be notified when research finishes, so later runs arm it automatically. */
  notifyWhenReady: boolean;
  /** Share researched college facts (never personal data) so other students skip research. */
  shareResearch: boolean;
  /** When the AI-assistance notice was acknowledged (ISO date); null until the first research run. Per install, not per list. */
  aiNoticeAcceptedAt: string | null;
}

const DEFAULT_PREFS: Prefs = { model: null, sort: "fit", seenPlanSheet: false, theme: "system", researchCount: 12, notifyWhenReady: false, shareResearch: true, aiNoticeAcceptedAt: null };

export interface Store {
  profile: StudentProfile;
  hasProfile: boolean;
  updateProfile: (patch: Partial<StudentProfile>) => void;
  replaceProfile: (p: StudentProfile) => void;
  colleges: College[];
  setColleges: (c: College[]) => void;
  upsertCollege: (c: College) => void;
  /**
   * Add or replace a freshly researched college, then check its deadlines against the college's own
   * pages in the background (never in demo mode) and store the result when it arrives.
   */
  upsertResearched: (c: College) => void;
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
  /** The active list finished the questions (per list). */
  onboardingDone: boolean;
  /** Mark the questions finished; a list the student never named is named from its answers. */
  finishOnboarding: () => void;
  /** When research last ran for the active list (per list). */
  researchedAt: string | null;
  markResearched: () => void;
  // Lists
  lists: ListMeta[];
  activeListId: string;
  activeList: ListMeta;
  /** Create a list and make it active. Returns its id. `name` empty → "List N" (auto-named later from the answers). */
  createList: (opts?: { name?: string; copyAnswersFrom?: string }) => string;
  switchList: (id: string) => void;
  renameList: (id: string, name: string) => void;
  /** Delete a list and its data. Deleting the active one returns to the list it was created from (or the nearest); deleting the last leaves an empty "My list". */
  deleteList: (id: string) => void;
  /** Turn deadline reminders on or off for a list (iPhone app; stored with the list). */
  setListRemind: (id: string, on: boolean) => void;
  account: ChatGPTAccount | null;
  connected: boolean;
  hasDevKey: boolean;
  /** The active list is the sample-data "Demo" list. */
  demo: boolean;
  enterDemo: () => void;
  exitDemo: () => void;
  resetAll: () => void;
  exportJson: () => string;
  importJson: (json: string) => number;
  refreshAuth: () => void;
}

const Ctx = createContext<Store | null>(null);

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

/** Everything that is not per list: the lists index, prefs and the ChatGPT session. */
interface Shared {
  index: ListsIndex;
  setIndex: (f: (i: ListsIndex) => ListsIndex) => void;
  /** Bumped to reload the active list from storage (after an import or a full reset). */
  reload: () => void;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  setPrefsRaw: (p: Partial<Prefs>) => void;
  account: ChatGPTAccount | null;
  connected: boolean;
  hasDevKey: boolean;
  refreshAuth: () => void;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  // Runs the flat-keys → lists migration before anything else reads storage.
  const [index, setIndexRaw] = useState<ListsIndex>(reconcileLists);
  const firstIndex = useRef(true);
  useEffect(() => {
    if (firstIndex.current) {
      firstIndex.current = false;
      return;
    }
    save(LISTS_KEY, index);
  }, [index]);
  const setIndex = useCallback((f: (i: ListsIndex) => ListsIndex) => setIndexRaw((i) => f(i)), []);
  const [epoch, setEpoch] = useState(0);
  const reload = useCallback(() => setEpoch((e) => e + 1), []);

  const [prefsRaw, setPrefsRaw] = usePersisted<Partial<Prefs>>("prefs", {});
  const prefs = useMemo<Prefs>(() => ({ ...DEFAULT_PREFS, ...prefsRaw }), [prefsRaw]);
  const setPrefs = useCallback((patch: Partial<Prefs>) => setPrefsRaw((p) => ({ ...p, ...patch })), [setPrefsRaw]);

  const [authTick, setAuthTick] = useState(0);
  useEffect(() => auth.subscribe(() => setAuthTick((t) => t + 1)), []);
  // Renew the ChatGPT session when the app comes back to the front, so renewals happen while the app
  // is open rather than mid-research while iOS may suspend it (a renewal cut off by suspension can end
  // the session, since the previous renewal token is retired as soon as a new one is issued).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void auth.ensureFresh?.().catch(() => setAuthTick((t) => t + 1));
    };
    onVisible();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  const refreshAuth = useCallback(() => setAuthTick((t) => t + 1), []);
  const account = useMemo(() => auth.account(), [authTick]);
  const hasDevKey = useMemo(() => !!devKey(), [authTick]);
  const connected = useMemo(() => isConnected(), [authTick]);

  const shared: Shared = { index, setIndex, reload, prefs, setPrefs, setPrefsRaw, account, connected, hasDevKey, refreshAuth };
  // Keyed by the active list: switching lists remounts the per-list state so it loads from storage.
  return (
    <ActiveList key={`${index.active}:${epoch}`} shared={shared}>
      {children}
    </ActiveList>
  );
}

function ActiveList({ shared, children }: { shared: Shared; children: ReactNode }) {
  const { index, setIndex, reload, prefs, setPrefs, setPrefsRaw, account, connected, hasDevKey, refreshAuth } = shared;
  const id = index.active;
  const activeList = index.items.find((it) => it.id === id) ?? index.items[0]!;

  const [profile, setProfile] = usePersisted<StudentProfile | null>(listKey(id, "profile"), null);
  const [colleges, setCollegesRaw] = usePersisted<College[]>(listKey(id, "colleges"), []);
  const [shortlist, setShortlist] = usePersisted<string[]>(listKey(id, "shortlist"), []);
  const [notes, setNotes] = usePersisted<Record<string, string>>(listKey(id, "notes"), {});
  const [chat, setChatRaw] = usePersisted<AiMessage[]>(listKey(id, "chat"), []);

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
  const upsertResearched = useCallback(
    (c: College) => {
      upsertCollege(c);
      if (activeList.demo || !needsDeadlineCheck(c)) return;
      void checkCollegeDeadlines(c).then((checked) => {
        if (checked === c) return;
        // Apply to whatever the list holds now (plan by plan), so a newer refresh keeps its own facts.
        setCollegesRaw((prev) => prev.map((x) => (x.id === c.id ? applyChecks(x, checked) : x)));
      });
    },
    [upsertCollege, setCollegesRaw, activeList.demo],
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

  // ── Lists ──
  const updateList = useCallback((listId: string, patch: Partial<ListMeta>) => setIndex((i) => ({ ...i, items: i.items.map((it) => (it.id === listId ? { ...it, ...patch } : it)) })), [setIndex]);

  const finishOnboarding = useCallback(() => {
    const p = profile ?? defaultProfile();
    setIndex((i) => ({
      ...i,
      items: i.items.map((it) => (it.id === id ? { ...it, onboardingDone: true, name: it.named ? it.name : uniqueName(autoListName(p), i.items, id) } : it)),
    }));
  }, [setIndex, id, profile]);
  const markResearched = useCallback(() => updateList(id, { researchedAt: new Date().toISOString() }), [updateList, id]);
  const setListRemind = useCallback((listId: string, on: boolean) => updateList(listId, { remind: on }), [updateList]);

  // Deadline reminders (iPhone app): rebuild the pending notifications whenever a list's colleges,
  // shortlist, answers or reminder setting change, and once at launch. Debounced; no-op on web.
  useEffect(() => {
    if (!index.items.some((it) => it.remind)) {
      // Nothing asked for reminders: clear whatever an earlier setting left pending.
      void syncDeadlineReminders(index.items);
      return;
    }
    const t = setTimeout(() => {
      void syncDeadlineReminders(index.items, { id, data: { colleges, shortlist, profile } });
    }, 400);
    return () => clearTimeout(t);
  }, [index.items, id, colleges, shortlist, profile]);

  const createList = useCallback(
    (opts: { name?: string; copyAnswersFrom?: string } = {}) => {
      const typed = opts.name?.trim() ?? "";
      const meta = newListMeta(typed ? uniqueName(typed, index.items) : nextListName(index.items), { from: id, ...(typed ? { named: true } : {}) });
      // Data first, then the index: the new list mounts from storage.
      if (opts.copyAnswersFrom) copyProfile(opts.copyAnswersFrom, meta.id);
      setIndex((i) => ({ ...i, active: meta.id, items: [...i.items, meta] }));
      return meta.id;
    },
    [setIndex, index.items, id],
  );
  const switchList = useCallback((listId: string) => setIndex((i) => (i.items.some((it) => it.id === listId) ? { ...i, active: listId } : i)), [setIndex]);
  const renameList = useCallback(
    (listId: string, name: string) => {
      const n = name.trim();
      if (n) updateList(listId, { name: n, named: true });
    },
    [updateList],
  );
  const deleteList = useCallback(
    (listId: string) => {
      removeListData(listId);
      setIndex((i) => {
        const gone = i.items.find((it) => it.id === listId);
        const at = i.items.findIndex((it) => it.id === listId);
        const items = i.items.filter((it) => it.id !== listId);
        if (!items.length) items.push(newListMeta(DEFAULT_LIST_NAME));
        let active = i.active;
        if (active === listId || !items.some((it) => it.id === active)) {
          const back = gone?.from && items.find((it) => it.id === gone.from);
          active = (back || items[Math.max(0, Math.min(at, items.length - 1))] || items[0])!.id;
        }
        return { ...i, active, items };
      });
    },
    [setIndex],
  );

  // ── Demo: its own temporary list, so the student's real lists are untouched. ──
  const enterDemo = useCallback(() => {
    const existing = index.items.find((it) => it.demo);
    if (existing) {
      if (existing.id !== id) switchList(existing.id);
      return;
    }
    const meta = newListMeta(uniqueName(DEMO_LIST_NAME, index.items), { demo: true, named: true, onboardingDone: true, researchedAt: new Date().toISOString(), from: id });
    save(listKey(meta.id, "profile"), DEMO_PROFILE);
    save(listKey(meta.id, "colleges"), DEMO_COLLEGES);
    setIndex((i) => ({ ...i, active: meta.id, items: [...i.items, meta] }));
  }, [index.items, id, switchList, setIndex]);
  const exitDemo = useCallback(() => {
    for (const it of index.items) if (it.demo) deleteList(it.id);
  }, [index.items, deleteList]);

  const resetAll = useCallback(() => {
    const key = devKey();
    clearAll();
    if (key) save("dev_openai_key", key);
    setPrefsRaw({});
    setIndex(() => {
      const meta = newListMeta(DEFAULT_LIST_NAME);
      return { v: 1, active: meta.id, items: [meta] };
    });
    reload();
  }, [setPrefsRaw, setIndex, reload]);

  const importJson = useCallback(
    (json: string) => {
      const n = importAll(json);
      if (n > 0) {
        const next = reconcileLists();
        setPrefsRaw(load<Partial<Prefs>>("prefs", {}));
        setIndex(() => next);
        reload();
      }
      return n;
    },
    [setPrefsRaw, setIndex, reload],
  );

  const value: Store = {
    profile: effectiveProfile,
    hasProfile: !!profile,
    updateProfile,
    replaceProfile,
    colleges,
    setColleges,
    upsertCollege,
    upsertResearched,
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
    onboardingDone: !!activeList.onboardingDone,
    finishOnboarding,
    researchedAt: activeList.researchedAt ?? null,
    markResearched,
    lists: index.items,
    activeListId: id,
    activeList,
    createList,
    switchList,
    renameList,
    deleteList,
    setListRemind,
    account,
    connected,
    hasDevKey,
    demo: !!activeList.demo,
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

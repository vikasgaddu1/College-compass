import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useMemo } from "react";

export interface SchoolNote {
  slug: string;
  rating: number;
  status: string | null;
  pros: string;
  cons: string;
  notes: string;
  visited: number;
  tags: string;
  questions_for_visit: string;
  updated_at: number;
}

export type NoteStatus = "considering" | "shortlist" | "backup" | "ruled_out";

export const statusLabel: Record<string, string> = {
  considering: "Considering",
  shortlist:   "On my shortlist",
  backup:      "Backup",
  ruled_out:   "Ruled out",
};
export const statusTone: Record<string, string> = {
  considering: "chip-outline",
  shortlist:   "fit-top",
  backup:      "fit-strong",
  ruled_out:   "fit-lower",
};

interface Ctx {
  notes: Record<string, SchoolNote>;
  getNote: (slug: string) => SchoolNote | undefined;
  upsert: (patch: Partial<SchoolNote> & { slug: string }) => Promise<void>;
  remove: (slug: string) => Promise<void>;
  clearAll: () => Promise<void>;
  importNotes: (rows: SchoolNote[]) => Promise<void>;
  loading: boolean;
  drawerSlug: string | null;
  openDrawer: (slug: string) => void;
  closeDrawer: () => void;
  storageAvailable: boolean;
}

const NotesCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "college-compass-notes.v1";

/** Return true if a note has any content worth remembering. */
export function hasContent(n: SchoolNote | undefined): boolean {
  if (!n) return false;
  return (
    (n.rating ?? 0) > 0 ||
    !!n.status ||
    (n.pros || "").trim() !== "" ||
    (n.cons || "").trim() !== "" ||
    (n.notes || "").trim() !== "" ||
    (n.tags || "").trim() !== "" ||
    (n.questions_for_visit || "").trim() !== "" ||
    !!n.visited
  );
}

// Detect whether localStorage is actually usable (blocked in some sandboxed
// iframes and in Safari private mode).
function detectStorage(): boolean {
  try {
    const k = "__cc_test__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch { return false; }
}

function loadFromStorage(): Record<string, SchoolNote> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, SchoolNote>;
  } catch {}
  return {};
}

function saveToStorage(notes: Record<string, SchoolNote>): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); } catch {}
}

export function NotesProvider({ children }: { children: ReactNode }) {
  const [storageAvailable] = useState<boolean>(() => typeof window !== "undefined" && detectStorage());
  const [notes, setNotes] = useState<Record<string, SchoolNote>>({});
  const [loading, setLoading] = useState(true);
  const [drawerSlug, setDrawerSlug] = useState<string | null>(null);

  // Load once on mount
  useEffect(() => {
    if (storageAvailable) setNotes(loadFromStorage());
    setLoading(false);
  }, [storageAvailable]);

  // Save whenever notes change
  useEffect(() => {
    if (!loading && storageAvailable) saveToStorage(notes);
  }, [notes, loading, storageAvailable]);

  const getNote = useCallback((slug: string) => notes[slug], [notes]);

  const upsert = useCallback(async (patch: Partial<SchoolNote> & { slug: string }) => {
    setNotes(m => {
      const existing = m[patch.slug];
      const merged: SchoolNote = {
        slug: patch.slug,
        rating: patch.rating ?? existing?.rating ?? 0,
        status: patch.status ?? existing?.status ?? null,
        pros: patch.pros ?? existing?.pros ?? "",
        cons: patch.cons ?? existing?.cons ?? "",
        notes: patch.notes ?? existing?.notes ?? "",
        visited: patch.visited ?? existing?.visited ?? 0,
        tags: patch.tags ?? existing?.tags ?? "",
        questions_for_visit: patch.questions_for_visit ?? existing?.questions_for_visit ?? "",
        updated_at: Date.now(),
      };
      return { ...m, [patch.slug]: merged };
    });
  }, []);

  const remove = useCallback(async (slug: string) => {
    setNotes(m => { const c = { ...m }; delete c[slug]; return c; });
  }, []);

  const clearAll = useCallback(async () => setNotes({}), []);

  const importNotes = useCallback(async (rows: SchoolNote[]) => {
    setNotes(m => {
      const next = { ...m };
      for (const r of rows) {
        if (r && r.slug) next[r.slug] = { ...r, updated_at: r.updated_at || Date.now() };
      }
      return next;
    });
  }, []);

  const value = useMemo<Ctx>(() => ({
    notes, getNote, upsert, remove, clearAll, importNotes, loading,
    drawerSlug,
    openDrawer: (slug: string) => setDrawerSlug(slug),
    closeDrawer: () => setDrawerSlug(null),
    storageAvailable,
  }), [notes, getNote, upsert, remove, clearAll, importNotes, loading, drawerSlug, storageAvailable]);

  return <NotesCtx.Provider value={value}>{children}</NotesCtx.Provider>;
}

export function useNotes() {
  const v = useContext(NotesCtx);
  if (!v) throw new Error("NotesProvider missing");
  return v;
}

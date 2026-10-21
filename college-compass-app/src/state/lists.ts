/**
 * Multiple college lists. Each list has its own answers (profile), researched colleges, shortlist,
 * notes and chat, stored under `cc2:list:<id>:<part>`; the index of lists lives under `cc2:lists`.
 *
 * Installs from before lists kept one profile under flat keys (`cc2:profile`, `cc2:colleges`, …)
 * with `onboardingDone` / `researchedAt` in prefs. `reconcileLists()` moves those into the first
 * list ("My list"). It is idempotent and crash-safe: new keys are written first, then the index,
 * then the flat keys are removed — a run cut off anywhere is finished by the next one.
 */
import type { MajorArea, StudentProfile } from "@/types";
import { has, keysWithPrefix, load, remove, save } from "@/lib/storage";
import { majorLabel, regionLabel } from "./catalog";

export interface ListMeta {
  id: string;
  name: string;
  createdAt: string;
  /** The student typed or edited this name, so it is never auto-named from the answers. */
  named?: boolean;
  onboardingDone?: boolean;
  researchedAt?: string | null;
  /** Sample-data list made by "Try demo". */
  demo?: boolean;
  /** The list that was active when this one was created; deleting this one returns there. */
  from?: string;
  /** iPhone app: schedule local notifications 7 days and 1 day before this list's deadlines. */
  remind?: boolean;
}

export interface ListsIndex {
  v: 1;
  active: string;
  items: ListMeta[];
}

export const LISTS_KEY = "lists";
export const DEFAULT_LIST_NAME = "My list";
export const DEMO_LIST_NAME = "Demo";
/** Stored parts of a list. `profile` is `null`-able; the rest default to empty. */
export const LIST_PARTS = ["profile", "colleges", "shortlist", "notes", "chat"] as const;
export type ListPart = (typeof LIST_PARTS)[number];

export function listKey(id: string, part: ListPart): string {
  return `list:${id}:${part}`;
}

export function newListId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  const rnd = c && typeof c.getRandomValues === "function" ? Array.from(c.getRandomValues(new Uint8Array(6)), (b) => b.toString(36)).join("") : Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}${rnd}`.replace(/[^a-z0-9]/g, "").slice(0, 20);
}

export function newListMeta(name: string, extra: Partial<ListMeta> = {}): ListMeta {
  return { id: newListId(), name, createdAt: new Date().toISOString(), ...extra };
}

function validIndex(v: unknown): v is ListsIndex {
  if (!v || typeof v !== "object") return false;
  const i = v as Partial<ListsIndex>;
  return typeof i.active === "string" && Array.isArray(i.items) && i.items.every((it) => it && typeof it.id === "string" && it.id && typeof it.name === "string");
}

export function loadIndex(): ListsIndex | null {
  const v = load<unknown>(LISTS_KEY, null);
  return validIndex(v) ? { v: 1, active: v.active, items: v.items.map((it) => ({ ...it })) } : null;
}

/** Persist the lists index; false if the write failed (e.g. storage full). */
export function saveIndex(index: ListsIndex): boolean {
  return save(LISTS_KEY, index);
}

export function removeListData(id: string): void {
  for (const p of LIST_PARTS) remove(listKey(id, p));
}

/** Copy one list's answers (only the profile) to another list. */
export function copyProfile(fromId: string, toId: string): boolean {
  const p = load<StudentProfile | null>(listKey(fromId, "profile"), null);
  if (!p) return false;
  return save(listKey(toId, "profile"), p);
}

/** Stored summary of a list without loading it into state (for the lists sheet). */
export function listCollegeCount(id: string): number {
  const c = load<unknown>(listKey(id, "colleges"), []);
  return Array.isArray(c) ? c.length : 0;
}

export function listHasProfile(id: string): boolean {
  return load<unknown>(listKey(id, "profile"), null) != null;
}

/** "List 2", "List 3", … — the first number not already taken. */
export function nextListName(items: ListMeta[]): string {
  const taken = new Set(items.map((i) => i.name.trim().toLowerCase()));
  for (let n = items.length + 1; ; n++) {
    const name = `List ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** `name`, or `name 2`, `name 3`, … if another list already has it. */
export function uniqueName(name: string, items: ListMeta[], exceptId?: string): string {
  const others = new Set(items.filter((i) => i.id !== exceptId).map((i) => i.name.trim().toLowerCase()));
  if (!others.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const cand = `${name} ${n}`;
    if (!others.has(cand.toLowerCase())) return cand;
  }
}

const SHORT_MAJOR: Partial<Record<MajorArea, string>> = {
  computer_science: "Comp sci",
  robotics_mechatronics: "Robotics",
  math_stats: "Math",
  physical_sciences: "Physics",
  environmental_science: "Enviro sci",
  economics_social: "Economics",
  health: "Health",
  kinesiology_sports: "Kinesiology",
  political_science_law: "Poli sci",
  english_humanities: "Humanities",
  history_philosophy: "History",
  languages_international: "Languages",
  communication: "Communication",
  film_media: "Film",
  arts_design: "Art & design",
  performing_arts: "Music",
  education: "Education",
  agriculture_food: "Agriculture",
};

function shortMajor(id: MajorArea): string {
  return SHORT_MAJOR[id] ?? majorLabel(id).split(/\s*(?:&|,)\s*/)[0]!;
}

const AUTO_NAME_MAX = 30;

/**
 * A short label from the answers — primary major and where the student wants to be — for lists
 * the student didn't name: "Robotics · New England", "Business · NC" (no regions = home state).
 */
export function autoListName(p: StudentProfile): string {
  const major = p.majors[0] ? shortMajor(p.majors[0]) : "";
  const regions = p.regions.map(regionLabel);
  let place = "";
  if (regions.length === 1) place = regions[0]!;
  else if (regions.length >= 2) {
    const pair = `${regions[0]} & ${regions[1]}`;
    place = regions.length === 2 && `${major} · ${pair}`.length <= AUTO_NAME_MAX ? pair : `${regions[0]} +${regions.length - 1}`;
  } else if (p.home_state) place = p.home_state.toUpperCase();
  const name = [major, place].filter(Boolean).join(" · ");
  return name || DEFAULT_LIST_NAME;
}

// ───────────────────────────── migration ─────────────────────────────

const FLAT_PREFS_KEYS = ["onboardingDone", "researchedAt", "demo"] as const;

interface FlatData {
  parts: Partial<Record<ListPart, unknown>>;
  onboardingDone: boolean;
  researchedAt: string | null;
  demo: boolean;
}

/** The pre-lists flat keys, or null when none is stored. */
function readFlat(): FlatData | null {
  const parts: Partial<Record<ListPart, unknown>> = {};
  let any = false;
  for (const p of LIST_PARTS) {
    if (!has(p)) continue;
    any = true;
    parts[p] = load<unknown>(p, null);
  }
  const prefs = load<Record<string, unknown>>("prefs", {});
  const hasPrefFlags = FLAT_PREFS_KEYS.some((k) => k in prefs);
  if (!any && !hasPrefFlags) return null;
  return {
    parts,
    onboardingDone: prefs.onboardingDone === true,
    researchedAt: typeof prefs.researchedAt === "string" ? prefs.researchedAt : null,
    demo: prefs.demo === true,
  };
}

function removeFlat(): void {
  const prefs = load<Record<string, unknown>>("prefs", {});
  let changed = false;
  for (const k of FLAT_PREFS_KEYS) {
    if (k in prefs) {
      delete prefs[k];
      changed = true;
    }
  }
  if (changed) save("prefs", prefs);
  for (const p of LIST_PARTS) remove(p);
}

/** True when list `id` already holds exactly the flat data (a migration cut off before the flat keys were removed). */
function sameAsFlat(id: string, flat: FlatData): boolean {
  if (!Object.keys(flat.parts).length) return false;
  return LIST_PARTS.every((p) => {
    const a = p in flat.parts ? JSON.stringify(flat.parts[p] ?? null) : null;
    const b = has(listKey(id, p)) ? JSON.stringify(load<unknown>(listKey(id, p), null)) : null;
    return a === b;
  });
}

function freshIndex(): ListsIndex {
  return { v: 1, active: "", items: [] };
}

/**
 * Make the lists index consistent with storage and return it:
 * - flat (pre-lists) keys → a list of their own (the first list, or "Imported" next to existing ones);
 * - a missing or empty index → one empty "My list";
 * - an active id that doesn't exist → the first list;
 * - stored `list:*` keys of lists that aren't in the index → removed.
 * Runs at start-up and after importing a backup.
 */
/** Copy a list's parts under `id`; false if any write failed (e.g. storage full). */
function copyParts(id: string, parts: Partial<Record<(typeof LIST_PARTS)[number], unknown>>): boolean {
  for (const p of LIST_PARTS) if (p in parts && !save(listKey(id, p), parts[p])) return false;
  return true;
}

export function reconcileLists(): ListsIndex {
  let index = loadIndex();
  const flat = readFlat();
  if (flat) {
    const dup = index?.items.find((it) => sameAsFlat(it.id, flat));
    if (dup || !Object.keys(flat.parts).length) {
      // Already moved (a run cut off before the flat keys went), or only the old prefs flags are left.
      removeFlat();
    } else {
      const id = newListId();
      if (!copyParts(id, flat.parts)) {
        // Storage is full: free the on-device research cache (it refills itself) and try once more.
        remove("research_cache");
        if (!copyParts(id, flat.parts)) {
          // Still can't copy. Keep the original data where it is (never delete it unsaved); the next
          // launch tries again and brings it in as its own list.
          for (const p of LIST_PARTS) remove(listKey(id, p));
          const kept = index ?? freshIndex();
          saveIndex(kept);
          return kept;
        }
      }
      const base = flat.demo ? DEMO_LIST_NAME : index ? "Imported" : DEFAULT_LIST_NAME;
      const meta: ListMeta = { id, name: uniqueName(base, index?.items ?? []), createdAt: new Date().toISOString(), onboardingDone: flat.onboardingDone, researchedAt: flat.researchedAt };
      if (flat.demo) {
        meta.demo = true;
        meta.named = true;
        if (index) meta.from = index.active;
      }
      const next: ListsIndex = index ? { ...index, active: id, items: [...index.items, meta] } : { v: 1, active: id, items: [meta] };
      if (!saveIndex(next)) {
        // The copy is only findable through the index: without it, keep the original data and drop
        // the copy (a later launch tries again).
        for (const p of LIST_PARTS) remove(listKey(id, p));
        const kept = index ?? freshIndex();
        saveIndex(kept);
        return kept;
      }
      index = next;
      removeFlat();
    }
  }
  if (!index) index = freshIndex();
  let dirty = false;
  if (!index.items.length) {
    index.items = [newListMeta(DEFAULT_LIST_NAME)];
    dirty = true;
  }
  if (!index.items.some((it) => it.id === index!.active)) {
    index.active = index.items[0]!.id;
    dirty = true;
  }
  if (dirty) saveIndex(index);
  const known = new Set(index.items.map((it) => it.id));
  for (const k of keysWithPrefix("list:")) {
    const id = k.slice("list:".length).split(":")[0] ?? "";
    if (!known.has(id)) remove(k);
  }
  return index;
}

/**
 * On-device research cache (localStorage `cc2:research_cache`), keyed by normalized college name
 * (official name, short name and the name the student typed). Size-capped LRU; entries older than
 * 30 days are treated as stale.
 */
import type { College } from "../types";
import { load, remove, save } from "../lib/storage";
import { KEYS } from "./config";
import { normalizeName } from "./normalize";

export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface Entry {
  aliases: string[];
  college: College;
  used: number;
}
interface Store {
  v: 1;
  entries: Entry[];
}

export interface ResearchCache {
  /** Fresh (< maxAge) cached college for this name, or null. Marks it recently used. */
  get(name: string, maxAgeMs?: number): College | null;
  /** Store/replace a researched college; `aliases` are extra names that should find it. */
  put(college: College, aliases?: string[]): void;
  remove(name: string): void;
  clear(): void;
  all(): College[];
}

export interface CacheOptions {
  key?: string;
  maxEntries?: number;
  /** Approximate cap on the serialized size (characters). */
  maxChars?: number;
  now?: () => number;
}

function researchedAt(c: College): number {
  const t = Date.parse(c.researched_at);
  return Number.isFinite(t) ? t : 0;
}

/** Find a fresh college for `name` in a plain list (e.g. ResearchOptions.cache). */
export function findFresh(list: College[] | undefined, name: string, now: number, maxAgeMs = CACHE_MAX_AGE_MS): College | null {
  if (!list?.length) return null;
  const n = normalizeName(name);
  if (!n) return null;
  let best: College | null = null;
  for (const c of list) {
    if (!c || now - researchedAt(c) >= maxAgeMs) continue;
    if (normalizeName(c.name) === n || normalizeName(c.short) === n) {
      if (!best || researchedAt(c) > researchedAt(best)) best = c;
    }
  }
  return best;
}

export function createResearchCache(opts: CacheOptions = {}): ResearchCache {
  const key = opts.key ?? KEYS.researchCache;
  const maxEntries = opts.maxEntries ?? 150;
  const maxChars = opts.maxChars ?? 1_500_000;
  const now = opts.now ?? (() => Date.now());

  const read = (): Store => {
    const s = load<Store | null>(key, null);
    return s && s.v === 1 && Array.isArray(s.entries) ? s : { v: 1, entries: [] };
  };

  const write = (s: Store) => {
    s.entries.sort((a, b) => b.used - a.used);
    if (s.entries.length > maxEntries) s.entries.length = maxEntries;
    // Trim least-recently-used until it fits; if storage still refuses (quota), keep halving.
    while (s.entries.length && JSON.stringify(s).length > maxChars) s.entries.pop();
    while (!save(key, s) && s.entries.length) s.entries.length = Math.floor(s.entries.length / 2);
  };

  const findIdx = (s: Store, name: string) => {
    const n = normalizeName(name);
    return n ? s.entries.findIndex((e) => e.aliases.includes(n)) : -1;
  };

  return {
    get(name, maxAgeMs = CACHE_MAX_AGE_MS) {
      const s = read();
      const i = findIdx(s, name);
      if (i < 0) return null;
      const e = s.entries[i]!;
      if (now() - researchedAt(e.college) >= maxAgeMs) return null;
      e.used = now();
      write(s);
      return e.college;
    },
    put(college, aliases = []) {
      const s = read();
      const names = [...new Set([college.name, college.short, ...aliases].map(normalizeName).filter(Boolean))];
      // Replace any entry sharing an alias or the id.
      const merged = new Set(names);
      s.entries = s.entries.filter((e) => {
        const clash = e.college.id === college.id || e.aliases.some((a) => names.includes(a));
        if (clash) for (const a of e.aliases) merged.add(a);
        return !clash;
      });
      s.entries.push({ aliases: [...merged], college, used: now() });
      write(s);
    },
    remove(name) {
      const s = read();
      const i = findIdx(s, name);
      if (i >= 0) {
        s.entries.splice(i, 1);
        write(s);
      }
    },
    clear() {
      remove(key);
    },
    all() {
      return read().entries.map((e) => e.college);
    },
  };
}

export const researchCache: ResearchCache = createResearchCache();

/**
 * "Is there anyone who can help?" — a once-per-session look at the counselor directory, so the app's
 * contextual prompts (college page, deadlines, research done, Ask, list) can say "3 counselors in
 * North Carolina help with STEM applications" and stay silent when nobody is listed.
 *
 * One `counselor_directory` call per home state, cached in memory for the session (no storage) with
 * in-flight dedupe, so five prompts never cost five requests. The call sends the state only — never
 * anything about the student; specialties are matched here, on the phone. Off entirely when shared
 * data is off (`sharedConfig()` null): every prompt then sees `count: 0` and renders nothing.
 */
import { NATIONWIDE, SPECIALTIES, createDirectoryApi, type Counselor, type DirectoryApi, type Specialty } from "./counselors";

export interface CounselorMatches {
  /** Listed counselors who serve the student's state (or work with students anywhere). */
  count: number;
  /** Of those, how many list one of the student's specialties. */
  matching: number;
  /** The student's specialty with the most counselors (null when none matches). */
  interest: Specialty | null;
  /** Human label for `interest`, phrased for "… help with {interest} applications". */
  interestLabel: string | null;
  /** How many counselors list `interest` (what a filtered directory for it will show). */
  interestCount: number;
  /** Counselors per specialty, so a prompt never links to a filter that would come up empty. */
  bySpecialty: Partial<Record<Specialty, number>>;
  /** How many of `count` are tied to the state itself (the rest are nationwide/virtual). */
  local: number;
}

export const NO_MATCHES: CounselorMatches = { count: 0, matching: 0, interest: null, interestLabel: null, interestCount: 0, bySpecialty: {}, local: 0 };

/** Plain-English phrasing for "help with … applications". */
const INTEREST_PHRASE: Partial<Record<Specialty, string>> = {
  stem: "STEM",
  engineering: "engineering",
  arts: "arts and performing-arts",
  athletics: "athletic-recruiting",
  international: "international",
  financial_aid: "financial-aid",
  essays: "essay",
  test_prep: "test-prep",
  transfer: "transfer",
  learning_differences: "learning-differences",
  first_gen: "first-gen",
};

export function summarizeMatches(rows: Counselor[], state: string | null, specialties: readonly string[]): CounselorMatches {
  // Without a home state the directory lists everyone; keep the ones who work virtually (as the screen does).
  const pool = state ? rows : rows.filter((c) => c.modes.includes("virtual"));
  if (!pool.length) return NO_MATCHES;
  let best: Specialty | null = null;
  let bestN = 0;
  const bySpecialty: Partial<Record<Specialty, number>> = {};
  for (const s of SPECIALTIES) {
    const n = pool.filter((c) => c.specialties.includes(s.id)).length;
    if (n) bySpecialty[s.id] = n;
    if (!specialties.includes(s.id)) continue;
    if (n > bestN) {
      best = s.id;
      bestN = n;
    }
  }
  const matching = specialties.length ? pool.filter((c) => c.specialties.some((s) => specialties.includes(s))).length : 0;
  return {
    count: pool.length,
    matching,
    interest: best,
    interestLabel: best ? INTEREST_PHRASE[best] ?? null : null,
    interestCount: bestN,
    bySpecialty,
    local: state ? pool.filter((c) => c.states.includes(state) && !c.states.includes(NATIONWIDE)).length : 0,
  };
}

// ───────────────────────────── session cache ─────────────────────────────

let apiOverride: DirectoryApi | null | undefined;
let defaultApi: DirectoryApi | null | undefined;
/** In-flight or settled requests, one per state. */
const inflight = new Map<string, Promise<Counselor[]>>();
/** Settled results, so a prompt that mounts later renders at once without a loading flash. */
const resolved = new Map<string, Counselor[]>();

function api(): DirectoryApi | null {
  if (apiOverride !== undefined) return apiOverride;
  if (defaultApi === undefined) defaultApi = createDirectoryApi();
  return defaultApi;
}

/** Tests (and the mocked e2e build) inject or disable the directory; `undefined` restores the real one. */
export function setCounselorDirectoryForMatches(a: DirectoryApi | null | undefined): void {
  apiOverride = a;
  resetCounselorMatchesCache();
}

export function resetCounselorMatchesCache(): void {
  inflight.clear();
  resolved.clear();
}

const keyFor = (state: string | null) => state ?? "*";

/**
 * Listed counselors for a state (plus nationwide ones), fetched once per session. Never rejects: a
 * failed or unavailable directory resolves to `[]` (and is not cached, so a later prompt may retry).
 */
export function loadCounselorsFor(state: string | null): Promise<Counselor[]> {
  const a = api();
  if (!a) return Promise.resolve([]);
  const key = keyFor(state);
  const hit = inflight.get(key);
  if (hit) return hit;
  const p = a
    .list(state, [])
    .then((rows) => {
      resolved.set(key, rows);
      return rows;
    })
    .catch(() => {
      inflight.delete(key);
      return [] as Counselor[];
    });
  inflight.set(key, p);
  return p;
}

/** The settled result for a state, if this session already has it. */
export function peekCounselorsFor(state: string | null): Counselor[] | undefined {
  return resolved.get(keyFor(state));
}

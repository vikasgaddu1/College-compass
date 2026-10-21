/**
 * Shared college data (Supabase): federal College Scorecard figures for ~2,000 four-year colleges,
 * loaded by a scheduled job (scripts/scorecard-load.mjs). Read-only from the app with the project's
 * publishable key. Holds college facts only — the app never sends student data here.
 *
 * Used to fill what research didn't find (most often net price by income, outcomes, size) and to
 * flag research figures that disagree sharply with federal data.
 */
import type { College, IncomeNetPrice, MajorArea, ProgramNote } from "../types";
import { load, save } from "../lib/storage";
import { getAppAttestPlugin } from "../platform";
import { createAttestor, type Attestor } from "./attest";

const DEFAULT_URL = "https://nspbxlnocelknibrajkv.supabase.co";
/** Publishable key: designed to ship in apps; Row Level Security limits it to reading published rows. */
const DEFAULT_KEY = "sb_publishable_QtuV5ARTS9MNO8DS0ncd7Q_Jla-48g-";

function env(name: string): string {
  try {
    const v = (import.meta as ImportMeta).env?.[name];
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

/** Null when shared data is turned off (VITE_CC_SHARED_DATA=off, e.g. the mocked e2e build) or in unit tests. */
export function sharedConfig(): { url: string; key: string } | null {
  if (env("VITE_CC_SHARED_DATA") === "off" || env("MODE") === "test") return null;
  return { url: env("VITE_CC_SUPABASE_URL") || DEFAULT_URL, key: env("VITE_CC_SUPABASE_KEY") || DEFAULT_KEY };
}

export interface SharedStats {
  data_year: string | null;
  admit_rate: number | null;
  sat_25: number | null;
  sat_75: number | null;
  act_25: number | null;
  act_75: number | null;
  tuition_in_state: number | null;
  tuition_out_of_state: number | null;
  cost_of_attendance: number | null;
  cost_of_attendance_basis: "out_of_state" | "in_state" | "same" | null;
  avg_net_price: number | null;
  net_price_by_income: Partial<IncomeNetPrice>;
  grad_rate_6yr: number | null;
  retention_rate: number | null;
  median_earnings_10yr: number | null;
  program_share: College["program_share"];
}

export interface SharedCollege {
  unitid: string;
  name: string;
  city: string | null;
  state: string | null;
  lat: number | null;
  lon: number | null;
  locale: College["locale"];
  url: string | null;
  undergrad_size: number | null;
  hbcu: boolean;
  women_only: boolean;
  religious: boolean;
  stats: SharedStats | null;
  /** Verified research published by the shared database, per admissions cycle ("Fall 2027"). */
  research: { cycle: string; data: Record<string, unknown>; verified_count: number; researched_at: string; stale_after: string }[];
  /** Verified program notes per major area. */
  programs: { major_area: string; data: Record<string, unknown>; verified_count: number; stale_after: string }[];
}

/** What the app sends after researching a college: college facts only (see contributionPayload). */
export interface Contribution {
  install_id: string;
  app_version: string;
  cycle: string;
  college: Record<string, unknown>;
  programs: Record<string, unknown>[];
}

export interface SharedLookup {
  /** Best match per requested name (keyed by the name exactly as passed). Never throws. */
  lookup(targets: { name: string; state: string | null }[], signal?: AbortSignal): Promise<Map<string, SharedCollege>>;
  /** Send researched college facts to the shared database (fire-and-forget; never throws). Attested with App Attest on iOS when possible. */
  contribute?(c: Contribution): Promise<void>;
}

type Fetch = typeof fetch;

/**
 * The App Attest path for contributions in the iOS app (src/data/attest.ts); null on the web, in tests,
 * or when turned off for a build with VITE_CC_APP_ATTEST=off.
 */
export function defaultAttestor(cfg: { url: string; key: string }, doFetch: Fetch): Attestor | null {
  if (env("VITE_CC_APP_ATTEST") === "off") return null;
  const native = getAppAttestPlugin();
  if (!native) return null;
  return createAttestor({ endpoint: `${cfg.url}/functions/v1/attest`, apiKey: cfg.key, native, fetch: doFetch });
}

export function createSharedLookup(
  cfg = sharedConfig(),
  doFetch: Fetch = (...a) => globalThis.fetch(...a),
  timeoutMs = 6000,
  attestor?: Attestor | null,
): SharedLookup | null {
  if (!cfg) return null;
  const attested = attestor === undefined ? defaultAttestor(cfg, doFetch) : attestor;
  const headers = { apikey: cfg.key, "Content-Type": "application/json", Accept: "application/json" };
  return {
    async lookup(targets, signal) {
      const out = new Map<string, SharedCollege>();
      if (!targets.length) return out;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      const onAbort = () => ctl.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const m = await doFetch(`${cfg.url}/rest/v1/rpc/match_colleges`, {
          method: "POST",
          headers,
          body: JSON.stringify({ names: targets.map((t) => t.name), states: targets.map((t) => t.state) }),
          signal: ctl.signal,
        });
        if (!m.ok) return out;
        const matches = (await m.json()) as { requested: string; unitid: string }[];
        const ids = Array.from(new Set(matches.map((x) => x.unitid))).filter((x) => /^\d+$/.test(x));
        if (!ids.length) return out;
        const q = `${cfg.url}/rest/v1/colleges?select=*,college_stats(*),college_research(cycle,data,verified_count,researched_at,stale_after),college_programs(major_area,data,verified_count,stale_after)&unitid=in.(${ids.join(",")})`;
        const r = await doFetch(q, { headers, signal: ctl.signal });
        if (!r.ok) return out;
        const rows = (await r.json()) as (Record<string, unknown> & { college_stats?: Record<string, unknown>[] })[];
        const byId = new Map(rows.map((row) => [String(row.unitid), toShared(row)]));
        for (const x of matches) {
          const c = byId.get(x.unitid);
          if (c) out.set(x.requested, c);
        }
        return out;
      } catch {
        return out; // offline, timeout or aborted: research proceeds without shared data
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
    async contribute(c) {
      // iOS: try the App Attest path first (time-boxed); on any failure send it unattested as before.
      try {
        if (attested && (await attested.contribute(c))) return;
      } catch {
        /* fall back */
      }
      try {
        await doFetch(`${cfg.url}/rest/v1/rpc/contribute_research`, { method: "POST", headers, body: JSON.stringify({ payload: c }) });
      } catch {
        /* best-effort: the student's research is unaffected */
      }
    },
  };
}

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

type Row = Record<string, unknown> & {
  college_stats?: Record<string, unknown>[];
  college_research?: Record<string, unknown>[];
  college_programs?: Record<string, unknown>[];
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function toShared(row: Row): SharedCollege {
  const s = row.college_stats?.find((x) => x.source === "scorecard") ?? row.college_stats?.[0] ?? null;
  const locale = row.locale;
  return {
    unitid: String(row.unitid),
    name: String(row.name ?? ""),
    city: typeof row.city === "string" ? row.city : null,
    state: typeof row.state === "string" ? row.state : null,
    lat: n(row.lat),
    lon: n(row.lon),
    locale: locale === "city" || locale === "suburb" || locale === "town" || locale === "rural" ? locale : null,
    url: typeof row.url === "string" ? row.url : null,
    undergrad_size: n(row.undergrad_size),
    hbcu: row.hbcu === true,
    women_only: row.women_only === true,
    religious: row.religious === true,
    stats: s
      ? {
          data_year: typeof s.data_year === "string" ? s.data_year : null,
          admit_rate: n(s.admit_rate),
          sat_25: n(s.sat_25),
          sat_75: n(s.sat_75),
          act_25: n(s.act_25),
          act_75: n(s.act_75),
          tuition_in_state: n(s.tuition_in_state),
          tuition_out_of_state: n(s.tuition_out_of_state),
          cost_of_attendance: n(s.cost_of_attendance),
          cost_of_attendance_basis:
            s.cost_of_attendance_basis === "out_of_state" || s.cost_of_attendance_basis === "in_state" || s.cost_of_attendance_basis === "same" ? s.cost_of_attendance_basis : null,
          avg_net_price: n(s.avg_net_price),
          net_price_by_income: (s.net_price_by_income && typeof s.net_price_by_income === "object" ? s.net_price_by_income : {}) as Partial<IncomeNetPrice>,
          grad_rate_6yr: n(s.grad_rate_6yr),
          retention_rate: n(s.retention_rate),
          median_earnings_10yr: n(s.median_earnings_10yr),
          program_share: (s.program_share && typeof s.program_share === "object" ? s.program_share : {}) as College["program_share"],
        }
      : null,
    research: (row.college_research ?? []).map((r) => ({
      cycle: String(r.cycle ?? ""),
      data: obj(r.data),
      verified_count: n(r.verified_count) ?? 0,
      researched_at: String(r.researched_at ?? ""),
      stale_after: String(r.stale_after ?? ""),
    })),
    programs: (row.college_programs ?? []).map((p) => ({
      major_area: String(p.major_area ?? ""),
      data: obj(p.data),
      verified_count: n(p.verified_count) ?? 0,
      stale_after: String(p.stale_after ?? ""),
    })),
  };
}

/** "Fall 2027 entry" / "Fall 2027" → "Fall 2027" (the shared database's cycle key). */
export function cycleKey(cycle: string): string {
  return cycle.replace(/\s+entry$/i, "").trim();
}

const fresh = (staleAfter: string, nowMs: number) => {
  const t = Date.parse(staleAfter);
  return Number.isFinite(t) && t > nowMs;
};

/**
 * Raw researcher-shaped record for a college whose research for this cycle — and program notes for
 * every one of the student's majors — are published and fresh. Null otherwise (then it is researched).
 * The caller normalizes it exactly like fresh research.
 */
export function sharedResearchRecord(shared: SharedCollege, cycle: string, majors: MajorArea[], nowMs: number): { raw: Record<string, unknown>; verified: number; researchedAt: string } | null {
  const r = shared.research.find((x) => x.cycle === cycleKey(cycle) && fresh(x.stale_after, nowMs));
  if (!r) return null;
  const wanted = majors.filter((m) => m !== "undecided");
  const programs: ProgramNote[] = [];
  for (const m of wanted) {
    const p = shared.programs.find((x) => x.major_area === m && fresh(x.stale_after, nowMs));
    if (!p) return null; // a major nobody has researched here yet → research this college
    programs.push(p.data as unknown as ProgramNote);
  }
  const raw: Record<string, unknown> = {
    name: shared.name,
    city: shared.city,
    state: shared.state,
    url: shared.url,
    lat: shared.lat,
    lon: shared.lon,
    locale: shared.locale,
    undergrad_size: shared.undergrad_size,
    hbcu: shared.hbcu,
    women_only: shared.women_only,
    religious: shared.religious,
    program_share: shared.stats?.program_share ?? {},
    ...r.data,
    programs,
  };
  return { raw, verified: Math.max(r.verified_count, 2), researchedAt: r.researched_at };
}

const COLLEGE_FIELDS = [
  "name", "short", "city", "state", "ownership", "url", "admit_rate", "sat_25", "sat_75", "act_25", "act_75", "test_policy",
  "tuition_in_state", "tuition_out_of_state", "cost_of_attendance", "cost_of_attendance_basis", "avg_net_price", "net_price_by_income",
  "grad_rate_6yr", "retention_rate", "median_earnings_10yr", "undergrad_size", "data_year", "data_confidence", "cds", "application",
  "scholarships", "sources",
] as const;

/**
 * The contribution for one researched college: whitelisted college facts and program notes only.
 * Never the student's profile, answers, notes, name or anything from ChatGPT besides these facts.
 * (The database checks and trims everything again.)
 */
export function contributionPayload(college: College, cycle: string, installId: string, appVersion: string): Contribution {
  const c: Record<string, unknown> = {};
  for (const k of COLLEGE_FIELDS) {
    const v = (college as unknown as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) c[k] = v;
  }
  if (c.cds && typeof c.cds === "object") {
    const { notes: _notes, ...cds } = c.cds as Record<string, unknown>; // free-text notes can echo the student
    c.cds = cds;
  }
  const programs = (college.programs ?? []).map((p) => ({ major: p.major, offered: p.offered, degree: p.degree, how_to_enter: p.how_to_enter, notes: p.notes }));
  return { install_id: installId, app_version: appVersion, cycle: cycleKey(cycle), college: c, programs };
}

const LABELS: Record<string, string> = {
  admit_rate: "admit rate",
  sat_25: "SAT range",
  act_25: "ACT range",
  tuition_in_state: "in-state tuition",
  tuition_out_of_state: "out-of-state tuition",
  cost_of_attendance: "cost of attendance",
  avg_net_price: "average net price",
  net_price_by_income: "net price by family income",
  grad_rate_6yr: "graduation rate",
  retention_rate: "retention rate",
  median_earnings_10yr: "earnings after 10 years",
  program_share: "degrees by field",
  undergrad_size: "enrollment",
};

/**
 * Fill what research left empty from federal data, cite it, and flag a researched admit rate that
 * disagrees sharply with federal data. Researched values always win (they are newer, per cycle).
 */
export function mergeShared(college: College, shared: SharedCollege): College {
  const c: College = { ...college, net_price_by_income: { ...college.net_price_by_income }, data_notes: [...college.data_notes], sources: [...college.sources] };
  const s = shared.stats;
  const filled: string[] = [];
  const fill = <K extends keyof College>(key: K, v: College[K] | null | undefined, label = key as string) => {
    if ((c[key] === null || c[key] === undefined) && v !== null && v !== undefined) {
      c[key] = v as College[K];
      if (LABELS[label]) filled.push(LABELS[label]!);
    }
  };
  fill("undergrad_size", shared.undergrad_size);
  fill("lat", shared.lat);
  fill("lon", shared.lon);
  fill("url", shared.url);
  fill("locale", shared.locale);
  if (s) {
    fill("admit_rate", s.admit_rate);
    if (c.sat_25 == null && c.sat_75 == null && s.sat_25 != null && s.sat_75 != null) { c.sat_25 = s.sat_25; c.sat_75 = s.sat_75; filled.push(LABELS.sat_25!); }
    if (c.act_25 == null && c.act_75 == null && s.act_25 != null && s.act_75 != null) { c.act_25 = s.act_25; c.act_75 = s.act_75; filled.push(LABELS.act_25!); }
    fill("tuition_in_state", s.tuition_in_state);
    fill("tuition_out_of_state", s.tuition_out_of_state);
    if (c.cost_of_attendance == null && s.cost_of_attendance != null) {
      c.cost_of_attendance = s.cost_of_attendance;
      c.cost_of_attendance_basis = s.cost_of_attendance_basis;
      filled.push(LABELS.cost_of_attendance!);
    }
    fill("avg_net_price", s.avg_net_price);
    let bands = 0;
    for (const k of Object.keys(c.net_price_by_income) as (keyof IncomeNetPrice)[]) {
      const v = n(s.net_price_by_income?.[k]);
      if (c.net_price_by_income[k] == null && v != null) { c.net_price_by_income[k] = v; bands++; }
    }
    if (bands) filled.push(LABELS.net_price_by_income!);
    fill("grad_rate_6yr", s.grad_rate_6yr);
    fill("retention_rate", s.retention_rate);
    fill("median_earnings_10yr", s.median_earnings_10yr);
    if (!Object.keys(c.program_share ?? {}).length && Object.keys(s.program_share ?? {}).length) { c.program_share = s.program_share; filled.push(LABELS.program_share!); }

    if (college.admit_rate != null && s.admit_rate != null && Math.abs(college.admit_rate - s.admit_rate) > 0.15) {
      c.data_notes.push(
        `Researched admit rate (${Math.round(college.admit_rate * 100)}%) differs from federal data (${Math.round(s.admit_rate * 100)}%, an earlier year). Check the college's Common Data Set.`,
      );
    }
  }
  c.hbcu = c.hbcu || shared.hbcu;
  c.women_only = c.women_only || shared.women_only;
  if (filled.length) {
    c.data_notes.push(`From federal College Scorecard data (may be a year or two older than the research): ${Array.from(new Set(filled)).join(", ")}.`);
    c.sources.push({ title: "College Scorecard — U.S. Department of Education", url: `https://collegescorecard.ed.gov/school/?${shared.unitid}` });
  }
  return c;
}

/** Random per-install ID for shared-research consensus (not tied to any person, account or device ID). */
export function installId(): string {
  const existing = load<string | null>("install_id", null);
  if (existing && /^[0-9a-f-]{32,36}$/i.test(existing)) return existing;
  const c = globalThis.crypto as Crypto | undefined;
  const id = c && typeof c.randomUUID === "function"
    ? c.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
  save("install_id", id);
  return id;
}

export const APP_VERSION: string = (() => {
  try {
    const v = (import.meta as ImportMeta).env?.VITE_CC_APP_VERSION;
    return typeof v === "string" && v ? v : "1.0.0";
  } catch {
    return "1.0.0";
  }
})();

/**
 * Shared college data (Supabase): federal College Scorecard figures for ~2,000 four-year colleges,
 * loaded by a scheduled job (scripts/scorecard-load.mjs). Read-only from the app with the project's
 * publishable key. Holds college facts only — the app never sends student data here.
 *
 * Used to fill what research didn't find (most often net price by income, outcomes, size) and to
 * flag research figures that disagree sharply with federal data.
 */
import type { College, IncomeNetPrice } from "../types";

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
}

export interface SharedLookup {
  /** Best match per requested name (keyed by the name exactly as passed). Never throws. */
  lookup(targets: { name: string; state: string | null }[], signal?: AbortSignal): Promise<Map<string, SharedCollege>>;
}

type Fetch = typeof fetch;

export function createSharedLookup(cfg = sharedConfig(), doFetch: Fetch = (...a) => globalThis.fetch(...a), timeoutMs = 6000): SharedLookup | null {
  if (!cfg) return null;
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
        const q = `${cfg.url}/rest/v1/colleges?select=*,college_stats(*)&unitid=in.(${ids.join(",")})`;
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
  };
}

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

function toShared(row: Record<string, unknown> & { college_stats?: Record<string, unknown>[] }): SharedCollege {
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
  };
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

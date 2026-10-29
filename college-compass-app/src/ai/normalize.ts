/**
 * Validate + normalize researcher output (untrusted model JSON) into `College`.
 * Coerces strings to numbers, percentages to 0–1, clamps ranges, drops impossible values (with a
 * data note), fills enums with safe defaults and derives id / short name / region.
 */
import type { ApplicationFacts, College, CuratedCds, DeadlineCheck, IncomeNetPrice, Locale, MajorArea, Ownership, ProgramNote } from "../types";
import { regionFromState, stateCode } from "./geo";
import { CONFIDENCE, MAJOR_AREAS, PLAN_KINDS } from "./prompts";

// ───────────────────────────── names ─────────────────────────────

/** Normalized name for matching/caching: "The University of X–Y" ≈ "university of x y". */
export function normalizeName(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\buniv\.?(?=\s|$)/g, "university")
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\bmain campus\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slug(s: string): string {
  return normalizeName(s).replace(/\s+/g, "-").slice(0, 80) || "college";
}

const STOP = new Set(["university", "college", "of", "at", "and", "in", "institute", "state", "the", "campus"]);
function tokens(s: string): Set<string> {
  return new Set(normalizeName(s).split(" ").filter((t) => t && !STOP.has(t)));
}

/** Loose match between a requested name and a returned official name. */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if ((na.length >= 8 && nb.includes(na)) || (nb.length >= 8 && na.includes(nb))) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  // "state" is a stop word, so "Ohio State" vs "Ohio University" needs care: require the full stop-word-free sets to agree.
  const sa = normalizeName(a).includes(" state");
  const sb = normalizeName(b).includes(" state");
  if (sa !== sb && (ta.size <= 2 || tb.size <= 2)) return false;
  return inter / Math.max(ta.size, tb.size) >= 0.75;
}

/** Display name ≤ ~22 chars (used when the researcher didn't give a usable `short`). */
export function shortName(name: string): string {
  const n = name.trim().replace(/^the\s+/i, "");
  if (n.length <= 22) return n;
  let s = n
    .replace(/,?\s+main campus$/i, "")
    .replace(/Institute of Technology/g, "Tech")
    .replace(/State University/g, "State")
    .replace(/University/g, "Univ.")
    .replace(/\bSaint\b/g, "St.")
    .replace(/\s+at\s+/g, " ")
    .replace(/,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= 22) return s;
  const words = s.split(" ");
  s = "";
  for (const w of words) {
    if ((s ? s.length + 1 : 0) + w.length > 21) break;
    s = s ? `${s} ${w}` : w;
  }
  return (s || n.slice(0, 21)) + "…";
}

// ───────────────────────────── scalar coercion ─────────────────────────────

interface Ctx { notes: Set<string> }

/** "$12,345" → 12345, "27%" → 27, " 1,200 " → 1200; ranges, words, NaN → null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/[$,\s]/g, "").replace(/usd$/i, "").replace(/%$/, "");
  if (!s || !/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) {
    const k = v.trim().match(/^\$?\s*(\d+(?:\.\d+)?)\s*k$/i); // "$45k"
    return k ? Number(k[1]) * 1000 : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Rates → 0..1. "27%" / 27 → 0.27; > 100 or negative → null. */
export function toRate(v: unknown, ctx?: Ctx, label?: string): number | null {
  const pct = typeof v === "string" && v.trim().endsWith("%");
  let n = toNumber(v);
  if (n == null) return null;
  if (pct || n > 1) n = n / 100;
  if (n < 0 || n > 1) {
    if (ctx && label) ctx.notes.add(`An implausible ${label} was removed.`);
    return null;
  }
  return Math.round(n * 10000) / 10000;
}

function toMoney(v: unknown, ctx: Ctx, label: string, max = 200_000): number | null {
  const n = toNumber(v);
  if (n == null) return null;
  if (n < 0 || n > max) {
    ctx.notes.add(`An implausible ${label} was removed.`);
    return null;
  }
  return Math.round(n);
}

function toIntIn(v: unknown, lo: number, hi: number, ctx: Ctx, label: string): number | null {
  const n = toNumber(v);
  if (n == null) return null;
  const r = Math.round(n);
  if (r < lo || r > hi) {
    ctx.notes.add(`An out-of-range ${label} was removed.`);
    return null;
  }
  return r;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(s)) return true;
    if (["false", "no", "n", "0"].includes(s)) return false;
  }
  return null;
}

function toStr(v: unknown, max = 400): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s || /^(null|n\/?a|none|unknown|-+)$/i.test(s)) return null;
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function toUrl(v: unknown): string | null {
  const s = toStr(v, 2000);
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s) ? `https://${s}` : null;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A deadline proof page: https only, ≤ 300 chars (the verifier later insists it is on the college's own domain). */
export function toProofUrl(v: unknown): string | null {
  const u = toUrl(v);
  if (!u || !/^https:\/\//i.test(u) || u.length > 300) return null;
  return u;
}

const CHECK_STATUSES = new Set(["verified", "mismatch", "unchecked"]);
/** A stored proof-check result (from this app or the shared database); null unless it has the expected shape. */
export function toCheck(v: unknown): DeadlineCheck | null {
  const c = rec(v);
  if (typeof c.status !== "string" || !CHECK_STATUSES.has(c.status)) return null;
  const checkedAt = typeof c.checkedAt === "string" && Number.isFinite(Date.parse(c.checkedAt)) ? new Date(c.checkedAt).toISOString() : null;
  if (!checkedAt) return null;
  const url = toProofUrl(c.url);
  const host = toStr(c.host, 120)?.toLowerCase().replace(/[^a-z0-9.-]/g, "") || null;
  const reason = toStr(c.reason, 40)?.replace(/[^a-z0-9_]/gi, "") || null;
  const out: DeadlineCheck = { status: c.status as DeadlineCheck["status"], checkedAt };
  if (reason) out.reason = reason;
  if (url) {
    out.url = url;
    out.host = host ?? new URL(url).hostname.replace(/^www\./, "");
  }
  // A "verified" without the page it was verified on proves nothing.
  if (out.status === "verified" && !out.url) return null;
  return out;
}

function arrOf(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ───────────────────────────── enums ─────────────────────────────

const MAJOR_SET = new Set<string>(MAJOR_AREAS);
export function toMajor(v: unknown): MajorArea | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/[\s/&-]+/g, "_");
  return MAJOR_SET.has(s) ? (s as MajorArea) : null;
}

function toOwnership(v: unknown, ctx: Ctx): Ownership {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (s.includes("public")) return "public";
  if (s.includes("private") || s.includes("nonprofit")) return "private_nonprofit";
  ctx.notes.add("Public/private status wasn't confirmed.");
  return "private_nonprofit";
}

function toLocale(v: unknown): Locale | null {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (!s) return null;
  if (/city|urban/.test(s)) return "city";
  if (/suburb/.test(s)) return "suburb";
  if (/town/.test(s)) return "town";
  if (/rural/.test(s)) return "rural";
  return null;
}

function toTestPolicy(v: unknown): College["test_policy"] {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (/blind|free/.test(s)) return "blind";
  if (/optional|flexible/.test(s)) return "optional";
  if (/consider|recommend/.test(s)) return "considered";
  if (/requir|mandatory/.test(s)) return "required";
  return "unknown";
}

type PlanKind = ApplicationFacts["plans"][number]["plan"];
const PLAN_SET = new Set<string>(PLAN_KINDS);
export function toPlanKind(v: unknown): PlanKind | null {
  if (typeof v !== "string") return null;
  const raw = v.trim();
  if (PLAN_SET.has(raw.toUpperCase()) && raw.length <= 3) return raw.toUpperCase() as PlanKind;
  const s = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(ed ?(2|ii)|early decision (2|ii))\b/.test(s)) return "ED2";
  if (/^(ed ?(1|i)?|early decision( (1|i))?)$/.test(s) || s.startsWith("early decision")) return "ED";
  if (/restrictive|single choice|scea|^rea\b/.test(s)) return "REA";
  if (/^(ea ?(1|i|2|ii)?|early action( (1|i|2|ii))?)$/.test(s) || s.startsWith("early action")) return "EA";
  if (/^(rd|regular( decision)?)/.test(s)) return "RD";
  if (/rolling/.test(s)) return "Rolling";
  if (/priority/.test(s)) return "Priority";
  if (raw === "Rolling" || raw === "Priority") return raw;
  return null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Deadlines → "YYYY-MM-DD" when parseable; otherwise the cleaned string (e.g. "Nov 1"). */
export function toDeadline(v: unknown): string | null {
  const s = toStr(v, 80);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  const mdy = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (mdy && MONTHS[mdy[1]!.toLowerCase()]) {
    return `${mdy[3]}-${String(MONTHS[mdy[1]!.toLowerCase()]).padStart(2, "0")}-${mdy[2]!.padStart(2, "0")}`;
  }
  return s;
}

// ───────────────────────────── main ─────────────────────────────

export interface NormalizeContext {
  /** The name the app asked about (used when the model omits/garbles the name). */
  requestedName?: string;
  requestedState?: string | null;
  /** Fallback application cycle label, e.g. "Fall 2027 entry". */
  cycle?: string;
  now?: Date;
}

const CONF_SET = new Set<string>(CONFIDENCE);
type ShareKey = keyof College["program_share"];

/** Returns null when the input isn't recognizably a college record. */
export function normalizeCollege(raw: unknown, context: NormalizeContext = {}): College | null {
  const r = rec(raw);
  const name = toStr(r.name, 160) ?? toStr(context.requestedName, 160);
  if (!name) return null;
  const ctx: Ctx = { notes: new Set() };
  const state = stateCode(r.state) ?? stateCode(context.requestedState) ?? "";
  if (!state) ctx.notes.add("The college's state wasn't confirmed.");

  // Admissions
  let sat25 = toIntIn(r.sat_25, 400, 1600, ctx, "SAT score");
  let sat75 = toIntIn(r.sat_75, 400, 1600, ctx, "SAT score");
  if (sat25 != null && sat75 != null && sat25 > sat75) [sat25, sat75] = [sat75, sat25];
  let act25 = toIntIn(r.act_25, 1, 36, ctx, "ACT score");
  let act75 = toIntIn(r.act_75, 1, 36, ctx, "ACT score");
  if (act25 != null && act75 != null && act25 > act75) [act25, act75] = [act75, act25];

  // Cost
  const nbi = rec(r.net_price_by_income);
  const net_price_by_income: IncomeNetPrice = {
    "0_30k": toMoney(nbi["0_30k"], ctx, "net price"),
    "30_48k": toMoney(nbi["30_48k"], ctx, "net price"),
    "48_75k": toMoney(nbi["48_75k"], ctx, "net price"),
    "75_110k": toMoney(nbi["75_110k"], ctx, "net price"),
    "110k_plus": toMoney(nbi["110k_plus"], ctx, "net price"),
  };

  // Program share: accept [{major, share}] or {major: share}
  const program_share: College["program_share"] = {};
  const psRaw = r.program_share;
  const psPairs: [unknown, unknown][] = Array.isArray(psRaw)
    ? psRaw.map((x) => [rec(x).major, rec(x).share])
    : Object.entries(rec(psRaw));
  for (const [m, sh] of psPairs) {
    const major = toMajor(m);
    const share = toRate(sh);
    if (major && share != null && major !== "undecided" && major !== "robotics_mechatronics") program_share[major as ShareKey] = share;
  }

  // Programs
  const programs: ProgramNote[] = [];
  const seenProg = new Set<string>();
  for (const p of arrOf(r.programs)) {
    const pr = rec(p);
    const major = toMajor(pr.major);
    if (!major || seenProg.has(major)) continue;
    seenProg.add(major);
    programs.push({
      major,
      offered: toBool(pr.offered) ?? !!toStr(pr.degree),
      degree: toStr(pr.degree, 160),
      how_to_enter: toStr(pr.how_to_enter, 300),
      notes: toStr(pr.notes, 400),
    });
  }

  // Application
  const appRaw = rec(r.application);
  const plans: ApplicationFacts["plans"] = [];
  const seenPlan = new Set<string>();
  for (const p of arrOf(appRaw.plans)) {
    const pr = rec(p);
    const plan = toPlanKind(pr.plan);
    if (!plan || seenPlan.has(plan)) continue;
    seenPlan.add(plan);
    const notes = toStr(pr.notes, 200);
    const source_url = toProofUrl(pr.source_url);
    const quote = toStr(pr.quote, 240);
    const check = toCheck(pr.check);
    plans.push({
      plan,
      deadline: toDeadline(pr.deadline),
      ...(notes ? { notes } : {}),
      ...(source_url ? { source_url } : {}),
      ...(quote ? { quote } : {}),
      ...(check ? { check } : {}),
    });
  }
  const application: ApplicationFacts | undefined =
    plans.length || toStr(appRaw.test_policy_note) || toStr(appRaw.essays_note) || toStr(appRaw.fee)
      ? {
          cycle: toStr(appRaw.cycle, 60) ?? context.cycle ?? "",
          plans,
          test_policy_note: toStr(appRaw.test_policy_note, 300),
          essays_note: toStr(appRaw.essays_note, 300),
          fee: toStr(appRaw.fee, 80),
        }
      : undefined;

  // CDS details
  const cr = rec(r.cds);
  const gated = [...new Set(arrOf(cr.gated_majors).map(toMajor).filter((m): m is MajorArea => !!m))];
  let offersEd = toBool(cr.offers_ed);
  let offersEa = toBool(cr.offers_ea);
  if (plans.some((p) => p.plan === "ED" || p.plan === "ED2")) offersEd = true;
  if (plans.some((p) => p.plan === "EA" || p.plan === "REA")) offersEa = true;
  const avgGpaRaw = toNumber(cr.avg_gpa);
  const avgGpa = avgGpaRaw != null && avgGpaRaw > 0 && avgGpaRaw <= 5 ? Math.round(avgGpaRaw * 100) / 100 : null;
  if (avgGpaRaw != null && avgGpa == null) ctx.notes.add("An implausible average GPA was removed.");
  const cdsYear = toStr(cr.cds_year, 40);
  const cds: CuratedCds = {
    cds_year: cdsYear ?? toStr(r.data_year, 40) ?? "unknown",
    ed_admit_rate: toRate(cr.ed_admit_rate, ctx, "ED admit rate"),
    ea_admit_rate: toRate(cr.ea_admit_rate, ctx, "EA admit rate"),
    rd_admit_rate: toRate(cr.rd_admit_rate, ctx, "RD admit rate"),
    in_state_admit_rate: toRate(cr.in_state_admit_rate, ctx, "in-state admit rate"),
    out_of_state_admit_rate: toRate(cr.out_of_state_admit_rate, ctx, "out-of-state admit rate"),
    avg_gpa: avgGpa,
    gated_majors: gated,
  };
  if (offersEd != null) cds.offers_ed = offersEd;
  if (offersEa != null) cds.offers_ea = offersEa;
  const cdsNotes = toStr(cr.notes, 300);
  if (cdsNotes) cds.notes = cdsNotes;
  const cdsUrl = toUrl(cr.source_url);
  if (cdsUrl) cds.source_url = cdsUrl;

  // Scholarships
  const scholarships = arrOf(r.scholarships)
    .map((s) => rec(s))
    .map((s) => ({ name: toStr(s.name, 120), amount: toStr(s.amount, 80), note: toStr(s.note, 240) }))
    .filter((s): s is { name: string; amount: string | null; note: string | null } => !!s.name)
    .slice(0, 8);

  // Sources
  const seenUrl = new Set<string>();
  const sources: College["sources"] = [];
  for (const s of arrOf(r.sources)) {
    const sr = typeof s === "string" ? { url: s } : rec(s);
    const url = toUrl(sr.url);
    if (!url || seenUrl.has(url)) continue;
    seenUrl.add(url);
    sources.push({ title: toStr(sr.title, 140) ?? new URL(url).hostname.replace(/^www\./, ""), url });
    if (sources.length >= 12) break;
  }
  if (cdsUrl && !seenUrl.has(cdsUrl)) sources.unshift({ title: `Common Data Set ${cds.cds_year}`.trim(), url: cdsUrl });

  // Coordinates (US campuses)
  const lat = toNumber(r.lat);
  const lon = toNumber(r.lon);
  const coordsOk = lat != null && lon != null && lat >= 17 && lat <= 72 && lon >= -180 && lon <= -60;

  const college: College = {
    id: `ai-${slug(`${name} ${state}`)}`,
    name,
    short: (() => {
      const s = toStr(r.short, 40);
      return s && s.length <= 24 ? s : shortName(name);
    })(),
    city: toStr(r.city, 80) ?? "",
    state,
    region: regionFromState(state),
    lat: coordsOk ? Math.round(lat! * 10000) / 10000 : null,
    lon: coordsOk ? Math.round(lon! * 10000) / 10000 : null,
    ownership: toOwnership(r.ownership, ctx),
    locale: toLocale(r.locale),
    url: toUrl(r.url),
    undergrad_size: toIntIn(r.undergrad_size, 50, 150_000, ctx, "enrollment"),
    admit_rate: toRate(r.admit_rate, ctx, "admit rate"),
    sat_25: sat25,
    sat_75: sat75,
    act_25: act25,
    act_75: act75,
    test_policy: toTestPolicy(r.test_policy),
    tuition_in_state: toMoney(r.tuition_in_state, ctx, "tuition", 120_000),
    tuition_out_of_state: toMoney(r.tuition_out_of_state, ctx, "tuition", 120_000),
    cost_of_attendance: toMoney(r.cost_of_attendance, ctx, "cost of attendance", 150_000),
    cost_of_attendance_basis: r.cost_of_attendance_basis === "out_of_state" || r.cost_of_attendance_basis === "in_state" || r.cost_of_attendance_basis === "same" ? r.cost_of_attendance_basis : null,
    avg_net_price: toMoney(r.avg_net_price, ctx, "net price", 120_000),
    net_price_by_income,
    grad_rate_6yr: toRate(r.grad_rate_6yr, ctx, "graduation rate"),
    retention_rate: toRate(r.retention_rate, ctx, "retention rate"),
    median_earnings_10yr: toMoney(r.median_earnings_10yr, ctx, "earnings figure", 400_000),
    program_share,
    hbcu: toBool(r.hbcu) ?? false,
    women_only: toBool(r.women_only) ?? false,
    religious: toBool(r.religious) ?? false,
    data_year: toStr(r.data_year, 40) ?? cdsYear ?? "unknown",
    source: "ai_research",
    cds,
    ...(application ? { application } : {}),
    ...(programs.length ? { programs } : {}),
    ...(scholarships.length ? { scholarships } : {}),
    sources,
    researched_at: (context.now ?? new Date()).toISOString(),
    data_confidence: "low",
    data_notes: [],
  };
  if (college.tuition_in_state == null && college.ownership === "private_nonprofit" && college.tuition_out_of_state != null) {
    college.tuition_in_state = college.tuition_out_of_state;
  }

  // Confidence: trust the model's own rating, but never above what the data supports.
  let conf = typeof r.data_confidence === "string" && CONF_SET.has(r.data_confidence.toLowerCase())
    ? (r.data_confidence.toLowerCase() as College["data_confidence"]) : "low";
  const keyFields = [college.admit_rate, college.sat_25 ?? college.act_25, college.cost_of_attendance, college.avg_net_price, college.grad_rate_6yr]
    .filter((x) => x != null).length;
  if (keyFields <= 1) conf = "low";
  else if (keyFields <= 3 && conf === "high") conf = "medium";
  if (!sources.length && conf === "high") conf = "medium";
  college.data_confidence = conf;

  const modelNotes = arrOf(r.data_notes).map((n) => toStr(n, 240)).filter((n): n is string => !!n);
  if (typeof r.data_notes === "string") {
    const n = toStr(r.data_notes, 240);
    if (n) modelNotes.push(n);
  }
  if (!sources.length) ctx.notes.add("No sources were cited — verify these figures on the college's website.");
  college.data_notes = [...new Set([...modelNotes.slice(0, 8), ...ctx.notes])];
  return college;
}

/** Extract the first JSON object from free text (fallback when the model answered in prose). */
export function extractJsonObject(text: string): unknown | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fence ? [fence[1]!, text] : [text];
  for (const c of candidates) {
    const start = c.indexOf("{");
    if (start < 0) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(c.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}

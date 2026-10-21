/**
 * Second-model review ("adversarial fact-check") of one researched college.
 *
 * After research, a different model gets ONLY the college's checkable facts (never the student's
 * profile — just the entry cycle and the major areas to check programs for), verifies each claim
 * against official sources with web search, and returns structured corrections through the
 * `submit_review` function tool. Corrections are applied conservatively:
 *  - only with an http(s) source URL and medium/high confidence;
 *  - big jumps (admit rate > 15 points, SAT > 150, ACT > 5, money outside 0.6–1.7×) need high confidence;
 *  - removing a plan or marking a program as not offered needs high confidence;
 *  - a value is never erased without a replacement, and values must parse and be in range;
 *  - every change is written to data_notes ("Reviewer corrected the EA deadline … (source: …)") and
 *    its source is added to the college's sources.
 * Callers (research.ts) treat any failure as "keep the unreviewed record".
 */
import { AiError, type AiCallResult, type AiClient, type AiMessage, type AiUsage, type College, type MajorArea, type ReviewChange, type ReviewSummary } from "../types";
import { extractJsonObject, toDeadline, toNumber, toRate } from "./normalize";
import { CONFIDENCE, MAJOR_AREAS, MAJOR_TEXT, PLAN_KINDS, TEST_POLICIES } from "./prompts";

export const REVIEW_TOOL_NAME = "submit_review";

/** Claims the reviewer checks (and may correct). */
export const REVIEW_FIELDS = [
  "admit_rate", "sat_25", "sat_75", "act_25", "act_75", "test_policy",
  "tuition_in_state", "tuition_out_of_state", "cost_of_attendance", "cost_of_attendance_basis",
  "plan_deadline", "plan_offered", "program_offered", "program_degree", "program_how_to_enter",
] as const;
export type ReviewField = (typeof REVIEW_FIELDS)[number];
type PlanKind = (typeof PLAN_KINDS)[number];
type Confidence = (typeof CONFIDENCE)[number];

export interface ReviewContext {
  /** Major areas to check programs for (no other student data is ever sent). */
  majors: MajorArea[];
  /** e.g. "Fall 2027 entry". */
  cycle: string;
  now?: Date;
}

export interface ReviewDeps {
  /** A Responses client; when it has listModels() the model name is resolved against it. */
  client: AiClient & { listModels?(): Promise<{ slug: string; display_name: string }[]> };
  /** Reviewer model: slug or display name (e.g. "sol 6.1"). Omitted = the account's default model. */
  model?: string;
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

/** A correction as the reviewer returned it (validated shape, value still text). */
export interface ParsedCorrection {
  field: ReviewField;
  plan: PlanKind | null;
  major: MajorArea | null;
  old: string | null;
  new: string;
  source_url: string | null;
  confidence: Confidence;
  reason: string;
}

export interface ParsedReview {
  corrections: ParsedCorrection[];
  verified: ReviewField[];
  unverified: { field: ReviewField; reason: string }[];
}

// ───────────────────────────── schema + prompt ─────────────────────────────

type Schema = Record<string, unknown>;
const str = (description?: string): Schema => ({ type: "string", ...(description ? { description } : {}) });
const nstr = (description?: string): Schema => ({ type: ["string", "null"], ...(description ? { description } : {}) });
const enm = (values: readonly string[], description?: string): Schema => ({ type: "string", enum: [...values], ...(description ? { description } : {}) });
const nenm = (values: readonly string[], description?: string): Schema => ({ type: ["string", "null"], enum: [...values, null], ...(description ? { description } : {}) });
const arr = (items: Schema, description?: string): Schema => ({ type: "array", items, ...(description ? { description } : {}) });
function obj(properties: Record<string, Schema>, description?: string): Schema {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false, ...(description ? { description } : {}) };
}

export const submitReviewTool = {
  type: "function" as const,
  name: REVIEW_TOOL_NAME,
  description: "Submit the fact-check of the college record: corrections with sources, fields verified, fields you could not verify. Call exactly once.",
  strict: true,
  parameters: obj({
    corrections: arr(
      obj({
        field: enm(REVIEW_FIELDS, "Which claim is wrong or missing."),
        plan: nenm(PLAN_KINDS, "For plan_deadline / plan_offered: which plan. Otherwise null."),
        major: nenm(MAJOR_AREAS, "For program_* fields: which major area. Otherwise null."),
        old: nstr("The value in the record, as text (null if it was empty)."),
        new: str("The correct value, in the formats given in the instructions."),
        source_url: nstr("The official page you read that states the correct value. Null only if you have none (then it is not applied)."),
        confidence: enm(CONFIDENCE, "high: official page for the right year/cycle; medium: official but older/approximate; low: secondary source or inference."),
        reason: str("One short sentence: what the source says."),
      }),
      "Only claims that an official source contradicts or fills. Empty if the record is right.",
    ),
    verified: arr(enm(REVIEW_FIELDS), "Fields you confirmed against an official source."),
    unverified: arr(obj({ field: enm(REVIEW_FIELDS), reason: str("Why you couldn't verify it (one short phrase).") }), "Fields you could not check."),
  }),
};

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function reviewerInstructions(now: Date = new Date()): string {
  return `You are an adversarial fact-checker for US college admissions data. Today is ${today(now)}. Another AI researched the college record below for a high-school student's college list. Assume it contains mistakes until a source shows otherwise — typical ones: last cycle's deadlines presented as this cycle's, plans the college doesn't offer (or missing ED II / residency-specific Early Action), an outdated test policy (many colleges changed theirs recently), an admit rate or SAT range from the wrong year or the wrong campus, an out-of-state budget labelled as in-state, a degree name that doesn't exist, "direct admit" where entry to the major is actually competitive after the first year.

Check each claim against official sources (use web search), in this order of trust: the college's own admissions / financial-aid / catalog pages for the entry cycle; its most recent Common Data Set (usually 2025-2026: C1 applicants/admits, C8 test policy, C9 SAT/ACT percentiles, G cost); then College Scorecard / IPEDS.
1. admit_rate — CDS C1 admitted ÷ applied (or the official class profile).
2. sat_25 / sat_75 / act_25 / act_75 — CDS C9 composite percentiles of enrolled first-years.
3. test_policy — for the entry cycle: required / optional / blind / considered.
4. tuition_in_state, tuition_out_of_state, cost_of_attendance, cost_of_attendance_basis — the official cost-of-attendance page for the latest year. At public universities make sure cost_of_attendance matches its stated basis (in-state vs out-of-state budget).
5. Application plans for the entry cycle — which plans exist (ED, ED2, EA, REA, RD, Rolling, Priority) and their deadlines.
6. Programs for the listed major areas — does the bachelor's exist, its exact degree name, and how students get in (direct admission to the major vs a competitive internal application after enrollment).

Rules:
- Report a correction only when an official source states a different value (or fills an empty one), and give the exact URL you read in source_url. If you can't find a source, don't correct — list the field under unverified.
- Never "correct" a value to an older year's figure. If the record cites a newer Common Data Set than you found, leave it. Rounding differences are not errors (admit rate within 1 point, SAT within 10, ACT within 1, costs within 3%).
- Never propose removing a value without giving the correct one. To say a plan isn't offered use plan_offered = "false"; to say a program doesn't exist use program_offered = "false".
- Formats for "new": rates as decimals 0–1 ("0.142"); SAT/ACT and dollars as whole numbers ("1450", "61234"); deadlines as "YYYY-MM-DD"; test_policy one of required / optional / blind / considered; cost_of_attendance_basis one of out_of_state / in_state / same; plan_offered and program_offered "true" or "false"; program_degree and program_how_to_enter short plain text. Set plan for plan_* fields and major for program_* fields.
- If this cycle's dates aren't published yet, last cycle's dates are acceptable — don't correct them unless they are wrong for last cycle too.
- confidence: high = read on an official page for the right year/cycle; medium = official but older or approximate; low = anything else (low-confidence corrections are ignored).

Do not answer in prose. Call \`${REVIEW_TOOL_NAME}\` exactly once.`;
}

/**
 * The facts the reviewer sees: a whitelist of checkable college facts. Never data notes, CDS free-text
 * notes, program notes or scholarships (free text can echo the student), and nothing from the profile.
 */
export function reviewSubject(c: College): Record<string, unknown> {
  return {
    name: c.name,
    state: c.state,
    url: c.url,
    ownership: c.ownership,
    data_year: c.data_year,
    admit_rate: c.admit_rate,
    sat_25: c.sat_25,
    sat_75: c.sat_75,
    act_25: c.act_25,
    act_75: c.act_75,
    test_policy: c.test_policy,
    tuition_in_state: c.tuition_in_state,
    tuition_out_of_state: c.tuition_out_of_state,
    cost_of_attendance: c.cost_of_attendance,
    cost_of_attendance_basis: c.cost_of_attendance_basis ?? null,
    common_data_set: c.cds ? { year: c.cds.cds_year, offers_ed: c.cds.offers_ed ?? null, offers_ea: c.cds.offers_ea ?? null, source_url: c.cds.source_url ?? null } : null,
    application: c.application
      ? { cycle: c.application.cycle, plans: c.application.plans.map((p) => ({ plan: p.plan, deadline: p.deadline })), test_policy_note: c.application.test_policy_note }
      : null,
    programs: (c.programs ?? []).map((p) => ({ major: p.major, offered: p.offered, degree: p.degree, how_to_enter: p.how_to_enter })),
    sources: c.sources.map((s) => s.url).slice(0, 12),
  };
}

export function reviewerInput(record: College, ctx: ReviewContext): AiMessage[] {
  const majors = ctx.majors.filter((m) => m !== "undecided");
  const majorLine = majors.length ? majors.map((m) => `${m} = ${MAJOR_TEXT[m]}`).join("; ") : "none";
  const content = [
    `Review this research record for: ${record.name}${record.state ? ` (${record.state})` : ""}`,
    `Entry cycle: ${ctx.cycle}`,
    `Major areas to check programs for: ${majorLine}`,
    `Record (JSON):\n\`\`\`json\n${JSON.stringify(reviewSubject(record), null, 1)}\n\`\`\``,
    `Verify it as instructed and call \`${REVIEW_TOOL_NAME}\` once.`,
  ].join("\n\n");
  return [{ role: "user", content }];
}

// ───────────────────────────── parsing ─────────────────────────────

const FIELD_SET = new Set<string>(REVIEW_FIELDS);
const PLAN_SET = new Set<string>(PLAN_KINDS);
const MAJOR_SET = new Set<string>(MAJOR_AREAS);
const CONF_SET = new Set<string>(CONFIDENCE);

function argsOf(res: AiCallResult): unknown {
  const call = res.tool_calls.find((c) => c.name === REVIEW_TOOL_NAME) ?? res.tool_calls.find((c) => c.name.endsWith(REVIEW_TOOL_NAME)) ?? res.tool_calls[0];
  if (call) {
    try {
      return JSON.parse(call.arguments);
    } catch {
      const recovered = extractJsonObject(call.arguments);
      if (recovered) return recovered;
    }
  }
  const fromText = res.text ? extractJsonObject(res.text) : null;
  if (fromText) return fromText;
  throw new AiError("server", "The reviewer didn't return structured results.");
}

const s = (v: unknown, max = 300): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return String(v);
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** Validate the reviewer's tool arguments (untrusted model JSON). Malformed items are dropped. */
export function parseReview(raw: unknown): ParsedReview {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const corrections: ParsedCorrection[] = [];
  for (const x of Array.isArray(r.corrections) ? r.corrections : []) {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const field = typeof o.field === "string" && FIELD_SET.has(o.field) ? (o.field as ReviewField) : null;
    const nv = s(o.new);
    if (!field || nv == null) continue;
    const plan = typeof o.plan === "string" && PLAN_SET.has(o.plan) ? (o.plan as PlanKind) : null;
    const major = typeof o.major === "string" && MAJOR_SET.has(o.major) ? (o.major as MajorArea) : null;
    if (field.startsWith("plan_") && !plan) continue;
    if (field.startsWith("program_") && !major) continue;
    const conf = typeof o.confidence === "string" && CONF_SET.has(o.confidence.toLowerCase()) ? (o.confidence.toLowerCase() as Confidence) : "low";
    corrections.push({ field, plan, major, old: s(o.old), new: nv, source_url: s(o.source_url, 2000), confidence: conf, reason: s(o.reason, 240) ?? "" });
    if (corrections.length >= 40) break;
  }
  const verified = [...new Set((Array.isArray(r.verified) ? r.verified : []).filter((f): f is ReviewField => typeof f === "string" && FIELD_SET.has(f)))];
  const unverified: ParsedReview["unverified"] = [];
  for (const x of Array.isArray(r.unverified) ? r.unverified : []) {
    const o: Record<string, unknown> = x && typeof x === "object" ? (x as Record<string, unknown>) : { field: x };
    if (typeof o.field === "string" && FIELD_SET.has(o.field) && !unverified.some((u) => u.field === o.field)) {
      unverified.push({ field: o.field as ReviewField, reason: s(o.reason, 160) ?? "" });
    }
  }
  return { corrections, verified, unverified };
}

// ───────────────────────────── applying ─────────────────────────────

function httpUrl(v: string | null): URL | null {
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") ? u : null;
  } catch {
    return null;
  }
}

function sourceLabel(u: URL): string {
  const label = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  return label.length > 70 ? `${label.slice(0, 69)}…` : label;
}

const PLAN_LABEL: Record<PlanKind, string> = { ED: "Early Decision", ED2: "Early Decision II", EA: "Early Action", REA: "Restrictive Early Action", RD: "Regular Decision", Rolling: "rolling admission", Priority: "priority" };

export function fieldKey(c: Pick<ParsedCorrection, "field" | "plan" | "major">): string {
  return c.field.startsWith("plan_") ? `${c.field}:${c.plan}` : c.field.startsWith("program_") ? `${c.field}:${c.major}` : c.field;
}

function fieldLabel(c: Pick<ParsedCorrection, "field" | "plan" | "major">): string {
  const major = c.major ? MAJOR_TEXT[c.major] : "";
  switch (c.field) {
    case "admit_rate": return "admit rate";
    case "sat_25": return "SAT 25th percentile";
    case "sat_75": return "SAT 75th percentile";
    case "act_25": return "ACT 25th percentile";
    case "act_75": return "ACT 75th percentile";
    case "test_policy": return "test policy";
    case "tuition_in_state": return "in-state tuition";
    case "tuition_out_of_state": return "out-of-state tuition";
    case "cost_of_attendance": return "cost of attendance";
    case "cost_of_attendance_basis": return "cost-of-attendance basis";
    case "plan_deadline": return `${c.plan} deadline`;
    case "plan_offered": return `${PLAN_LABEL[c.plan as PlanKind] ?? c.plan} plan`;
    case "program_offered": return `${major} program`;
    case "program_degree": return `${major} degree name`;
    case "program_how_to_enter": return `how students enter ${major}`;
  }
}

const UNVERIFIED_LABEL: Record<ReviewField, string> = {
  admit_rate: "admit rate", sat_25: "SAT range", sat_75: "SAT range", act_25: "ACT range", act_75: "ACT range",
  test_policy: "test policy", tuition_in_state: "tuition", tuition_out_of_state: "tuition", cost_of_attendance: "cost of attendance",
  cost_of_attendance_basis: "cost of attendance", plan_deadline: "deadlines", plan_offered: "application plans",
  program_offered: "program details", program_degree: "program details", program_how_to_enter: "program details",
};

function show(field: ReviewField, v: unknown): string {
  if (v == null) return "empty";
  if (field === "admit_rate" && typeof v === "number") return `${Math.round(v * 1000) / 10}%`;
  if ((field.startsWith("tuition") || field === "cost_of_attendance") && typeof v === "number") return `$${v.toLocaleString("en-US")}`;
  const t = String(v);
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}

type Parsed = { ok: true; value: unknown } | { ok: false; why: string };

function parseValue(c: ParsedCorrection): Parsed {
  const bad = (why: string): Parsed => ({ ok: false, why });
  const v = c.new;
  switch (c.field) {
    case "admit_rate": {
      const r = toRate(v);
      return r == null || r <= 0 ? bad("not a rate") : { ok: true, value: r };
    }
    case "sat_25": case "sat_75": {
      const n = toNumber(v);
      return n == null || n < 400 || n > 1600 ? bad("SAT out of range") : { ok: true, value: Math.round(n) };
    }
    case "act_25": case "act_75": {
      const n = toNumber(v);
      return n == null || n < 1 || n > 36 ? bad("ACT out of range") : { ok: true, value: Math.round(n) };
    }
    case "tuition_in_state": case "tuition_out_of_state": case "cost_of_attendance": {
      const n = toNumber(v);
      return n == null || n < 500 || n > 150_000 ? bad("amount out of range") : { ok: true, value: Math.round(n) };
    }
    case "test_policy": {
      const t = v.toLowerCase();
      const p = /blind|free/.test(t) ? "blind" : /optional|flexible/.test(t) ? "optional" : /consider/.test(t) ? "considered" : /requir/.test(t) ? "required" : null;
      return p && (TEST_POLICIES as readonly string[]).includes(p) ? { ok: true, value: p } : bad("unknown test policy");
    }
    case "cost_of_attendance_basis": {
      const t = v.toLowerCase().replace(/[\s-]+/g, "_");
      return t === "out_of_state" || t === "in_state" || t === "same" ? { ok: true, value: t } : bad("unknown basis");
    }
    case "plan_deadline": {
      const d = toDeadline(v);
      return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? { ok: true, value: d } : bad("deadline isn't a date");
    }
    case "plan_offered": case "program_offered": {
      const t = v.toLowerCase();
      return t === "true" || t === "false" ? { ok: true, value: t === "true" } : bad("not true/false");
    }
    case "program_degree": case "program_how_to_enter": {
      const t = s(v, c.field === "program_degree" ? 160 : 300);
      return t ? { ok: true, value: t } : bad("empty");
    }
  }
}

/** Large changes that need high confidence (mirrors the shared database's plausibility checks). */
function bigJump(field: ReviewField, from: unknown, to: unknown): boolean {
  if (typeof from !== "number" || typeof to !== "number") return false;
  if (field === "admit_rate") return Math.abs(to - from) > 0.15;
  if (field === "sat_25" || field === "sat_75") return Math.abs(to - from) > 150;
  if (field === "act_25" || field === "act_75") return Math.abs(to - from) > 5;
  if (field.startsWith("tuition") || field === "cost_of_attendance") return from > 0 && (to / from < 0.6 || to / from > 1.7);
  return false;
}

export interface ApplyResult {
  college: College;
  applied: ReviewChange[];
  skipped: (ReviewChange & { why: string })[];
}

/** Apply the reviewer's corrections conservatively (see the module comment). Pure: returns a new record. */
export function applyReview(record: College, review: ParsedReview, cycle: string): ApplyResult {
  const c: College = {
    ...record,
    data_notes: [...record.data_notes],
    sources: [...record.sources],
    ...(record.cds ? { cds: { ...record.cds } } : {}),
    ...(record.application ? { application: { ...record.application, plans: record.application.plans.map((p) => ({ ...p })) } } : {}),
    ...(record.programs ? { programs: record.programs.map((p) => ({ ...p })) } : {}),
  };
  const applied: ReviewChange[] = [];
  const skipped: (ReviewChange & { why: string })[] = [];
  const done = new Set<string>();
  const notes: string[] = [];

  const ensureApp = () => (c.application ??= { cycle, plans: [], test_policy_note: null, essays_note: null, fee: null });
  const syncOffers = () => {
    if (!c.cds || !c.application) return;
    const kinds = new Set(c.application.plans.map((p) => p.plan));
    c.cds.offers_ed = kinds.has("ED") || kinds.has("ED2");
    c.cds.offers_ea = kinds.has("EA") || kinds.has("REA");
  };
  const program = (major: MajorArea, create: boolean) => {
    let p = c.programs?.find((x) => x.major === major);
    if (!p && create) {
      p = { major, offered: true, degree: null, how_to_enter: null, notes: null };
      c.programs = [...(c.programs ?? []), p];
    }
    return p ?? null;
  };
  const current = (x: ParsedCorrection): unknown => {
    switch (x.field) {
      case "plan_deadline": return c.application?.plans.find((p) => p.plan === x.plan)?.deadline ?? null;
      case "plan_offered": return c.application ? c.application.plans.some((p) => p.plan === x.plan) : null;
      case "program_offered": return program(x.major!, false)?.offered ?? null;
      case "program_degree": return program(x.major!, false)?.degree ?? null;
      case "program_how_to_enter": return program(x.major!, false)?.how_to_enter ?? null;
      default: return (c as unknown as Record<string, unknown>)[x.field] ?? null;
    }
  };

  for (const x of review.corrections) {
    const key = fieldKey(x);
    const from = current(x);
    const change: ReviewChange = { field: key, old: from == null ? null : String(from), new: x.new, source_url: x.source_url ?? "", confidence: x.confidence, reason: x.reason };
    const skip = (why: string) => skipped.push({ ...change, why });
    if (done.has(key)) { skip("duplicate"); continue; }
    const url = httpUrl(x.source_url);
    if (!url) { skip("no source URL"); continue; }
    change.source_url = url.toString();
    if (x.confidence === "low") { skip("low confidence"); continue; }
    const parsed = parseValue(x);
    if (!parsed.ok) { skip(parsed.why); continue; }
    const to = parsed.value;
    if (from === to) { skip("already matches"); continue; }
    if (x.confidence !== "high" && bigJump(x.field, from, to)) { skip("large change without high confidence"); continue; }
    const removal = (x.field === "plan_offered" || x.field === "program_offered") && to === false;
    if (removal && x.confidence !== "high") { skip("removal needs high confidence"); continue; }
    // SAT/ACT bounds must stay ordered.
    if (x.field === "sat_25" && c.sat_75 != null && (to as number) > c.sat_75) { skip("above the 75th percentile"); continue; }
    if (x.field === "sat_75" && c.sat_25 != null && (to as number) < c.sat_25) { skip("below the 25th percentile"); continue; }
    if (x.field === "act_25" && c.act_75 != null && (to as number) > c.act_75) { skip("above the 75th percentile"); continue; }
    if (x.field === "act_75" && c.act_25 != null && (to as number) < c.act_25) { skip("below the 25th percentile"); continue; }

    switch (x.field) {
      case "plan_deadline": {
        const app = ensureApp();
        const p = app.plans.find((q) => q.plan === x.plan);
        if (p) p.deadline = to as string;
        else app.plans.push({ plan: x.plan!, deadline: to as string });
        syncOffers();
        break;
      }
      case "plan_offered": {
        const app = ensureApp();
        if (to) { if (!app.plans.some((q) => q.plan === x.plan)) app.plans.push({ plan: x.plan!, deadline: null }); }
        else app.plans = app.plans.filter((q) => q.plan !== x.plan);
        syncOffers();
        break;
      }
      case "program_offered": program(x.major!, true)!.offered = to as boolean; break;
      case "program_degree": program(x.major!, true)!.degree = to as string; break;
      case "program_how_to_enter": program(x.major!, true)!.how_to_enter = to as string; break;
      case "cost_of_attendance_basis": c.cost_of_attendance_basis = to as College["cost_of_attendance_basis"]; break;
      default: (c as unknown as Record<string, unknown>)[x.field] = to;
    }
    done.add(key);
    change.new = String(to);
    applied.push(change);
    const label = fieldLabel(x);
    const src = `(source: ${sourceLabel(url)})`;
    notes.push(
      removal ? `Reviewer removed the ${label}: not offered for this cycle ${src}.`
        : x.field === "plan_offered" ? `Reviewer added the ${label} ${src}.`
        : from == null ? `Reviewer added the ${label}: ${show(x.field, to)} ${src}.`
        : `Reviewer corrected the ${label} from ${show(x.field, from)} to ${show(x.field, to)} ${src}.`,
    );
    if (!c.sources.some((q) => q.url === change.source_url)) c.sources.push({ title: `Reviewer source: ${url.hostname.replace(/^www\./, "")}`, url: change.source_url });
  }

  const unverified = [...new Set(review.unverified.filter((u) => !done.has(u.field)).map((u) => UNVERIFIED_LABEL[u.field]))].slice(0, 5);
  if (unverified.length) notes.push(`A second AI model couldn't verify: ${unverified.join(", ")}.`);
  c.data_notes = [...c.data_notes, ...notes];
  c.sources = c.sources.slice(0, 16);
  return { college: c, applied, skipped };
}

// ───────────────────────────── models ─────────────────────────────

const normModel = (x: string) => x.toLowerCase().replace(/[\s_-]+/g, "");

/** Match "sol 6.1" / "Sol-6.1" / a slug against the account's models (slug first, then display name). */
export function resolveModel(wanted: string, models: { slug: string; display_name: string }[]): string | null {
  const w = normModel(wanted.trim());
  if (!w) return null;
  return models.find((m) => m.slug === wanted)?.slug
    ?? models.find((m) => normModel(m.slug) === w)?.slug
    ?? models.find((m) => normModel(m.display_name) === w)?.slug
    ?? null;
}

// ───────────────────────────── the call ─────────────────────────────

/**
 * Review one researched college. Resolves to the summary (with the corrected record in `after`);
 * throws on call/parse failure — callers keep the unreviewed record.
 */
export async function reviewCollege(record: College, ctx: ReviewContext, deps: ReviewDeps): Promise<ReviewSummary> {
  const t0 = Date.now();
  let model = deps.model?.trim() || undefined;
  if (model && deps.client.listModels) {
    let list: { slug: string; display_name: string }[] | null = null;
    try { list = await deps.client.listModels(); } catch { list = null; }
    if (list && list.length) {
      const slug = resolveModel(model, list);
      if (!slug) throw new AiError("unsupported", `Reviewer model “${model}” isn't available for this account (available: ${list.map((m) => m.slug).join(", ")}).`);
      model = slug;
    }
  }
  const res = await deps.client.call({
    instructions: reviewerInstructions(ctx.now ?? new Date()),
    input: reviewerInput(record, ctx),
    ...(model ? { model } : {}),
    ...(deps.effort ? { reasoning: deps.effort } : {}),
    tools: [submitReviewTool],
    tool_choice: { type: "function", name: REVIEW_TOOL_NAME },
    webSearch: true,
    signal: deps.signal,
  });
  const parsed = parseReview(argsOf(res));
  const { college, applied, skipped } = applyReview(record, parsed, ctx.cycle);
  const usage: AiUsage | null = res.usage ?? null;
  return {
    model: res.model || model || null,
    ms: Date.now() - t0,
    before: record,
    after: college,
    applied,
    skipped,
    verified: parsed.verified,
    unverified: parsed.unverified.map((u) => ({ field: u.field, reason: u.reason })),
    usage,
    error: null,
  };
}

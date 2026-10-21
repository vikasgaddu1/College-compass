/**
 * Is the second-model review worth it? Researcher-only vs researcher + reviewer on a fixed panel.
 *
 * One research run (the app's own src/ai/research.ts, review ON) records, per college, the record
 * as the researcher returned it (`before`) and after the reviewer's corrections (`after`) — a paired
 * comparison on the same research, so differences come from the reviewer alone. Both are scored
 * against federal College Scorecard figures from the shared Supabase database (live; falls back to
 * scripts/review-ground-truth.json), plus a few curated test policies. Deadlines/plans have no
 * automatic truth: both versions are printed side by side for a human spot-check.
 *
 *   npm run real-run -- login                      # once: sign in with ChatGPT (shared token store)
 *   npm run real-run -- exchange '<callback url>'
 *   npm run review-compare -- models               # what the account can use
 *   npm run review-compare -- run                  # live: ~2 Responses calls per college
 *   npm run review-compare -- score                # re-score the cached results, no calls
 *   npm run review-compare -- run --dry            # mocked client end to end (no sign-in, no network)
 *
 * Flags (or env): --researcher "luna 6" (CC_RESEARCHER_MODEL) --researcher-effort high
 * (CC_RESEARCHER_EFFORT) --reviewer "sol 6.1" (CC_REVIEWER_MODEL) --reviewer-effort medium
 * (CC_REVIEWER_EFFORT) --panel 10 (CC_PANEL) --concurrency 10 (CC_CONCURRENCY) --results <json>
 * --report <md> --truth live|snapshot. Tokens are never printed; results hold college facts only.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AiCallResult, AiClient, AiUsage, College, ResearchEvent, ReviewSummary, StudentProfile } from "../src/types";
import { FileStorage, MemoryStorage, STORE, installStorage } from "./store";

// ───────────────────────────── config ─────────────────────────────

type Effort = "low" | "medium" | "high";
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith("--") ? argv[0] : "run";
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1] : undefined;
}
const has = (name: string) => argv.includes(`--${name}`);
const effortOf = (v: string | undefined, d: Effort): Effort => (v === "low" || v === "medium" || v === "high" ? v : d);

const DRY = has("dry");
const RESULTS = flag("results") ?? process.env.CC_REVIEW_RESULTS ?? (DRY ? "cc-review-compare-dry-results.json" : "cc-review-compare-results.json");
const REPORT = flag("report") ?? process.env.CC_REVIEW_REPORT ?? RESULTS.replace(/results\.json$/, "report.md").replace(/\.json$/, ".md");

/** The fixed panel: diverse colleges with known-tricky facts (first 6 are already diverse). */
export const PANEL: { name: string; state: string; check: string }[] = [
  { name: "Georgia Institute of Technology", state: "GA", check: "public in-/out-of-state COA; residency-specific Early Action; direct admission to the major" },
  { name: "University of California, San Diego", state: "CA", check: "test-blind (UC); selective engineering/CS majors" },
  { name: "Worcester Polytechnic Institute", state: "MA", check: "ED I + ED II + EA; B.S. Robotics Engineering" },
  { name: "Purdue University", state: "IN", check: "reinstated SAT/ACT requirement; First-Year Engineering then transition to a major" },
  { name: "Harvey Mudd College", state: "CA", check: "small LAC; ED I + ED II; general engineering degree" },
  { name: "North Carolina A&T State University", state: "NC", check: "HBCU; in-state public for this NC student" },
  { name: "University of Pittsburgh", state: "PA", check: "rolling admission; public in-/out-of-state COA" },
  { name: "Massachusetts Institute of Technology", state: "MA", check: "reinstated test requirement; EA only, no ED" },
  { name: "Virginia Tech", state: "VA", check: "General Engineering first, then major placement; ED + EA" },
  { name: "California Institute of Technology", state: "CA", check: "ended test-blind moratorium; Restrictive Early Action" },
];

/** One fixed, non-identifying student: robotics / engineering / CS, Fall 2027 entry (only research sees it). */
const PROFILE: StudentProfile = {
  version: 1, home_state: "NC", grad_year: 2027, gpa_unweighted: 3.9, gpa_weighted: 4.5, class_rank_pct: null,
  sat: 1500, act: null, rigor: "most", ap_ib_count: 9, activities_strength: "state",
  majors: ["robotics_mechatronics", "engineering", "computer_science"], interests_text: "robotics, autonomous systems, embedded software",
  wanted_colleges: [], budget_per_year: null, income_band: "prefer_not", regions: [], max_distance_miles: null,
  size: "any", setting: "any", ownership: "any", plan: "ed_ok", first_gen: false,
  priorities: { academics_fit: 5, affordability: 3, outcomes: 4, odds: 3, location: 1 },
};
const CYCLE = "Fall 2027 entry";

// ───────────────────────────── types ─────────────────────────────

interface Truth {
  source: string;
  unitid: string | null;
  admit_rate: number | null;
  sat_25: number | null;
  sat_75: number | null;
  cost_of_attendance: number | null;
  cost_of_attendance_basis: string | null;
  test_policy: string | null;
  test_policy_source: string | null;
}

interface CallLog {
  role: "researcher" | "reviewer" | "other";
  /** Colleges the call was about. */
  labels: string[];
  start: number;
  end: number;
  ok: boolean;
  model: string | null;
  usage: AiUsage | null;
  error?: string;
}

interface CollegeResult {
  name: string;
  state: string;
  check: string;
  failed: string | null;
  review: ReviewSummary | null;
}

interface Results {
  version: 1;
  created_at: string;
  mode: "live" | "dry";
  config: {
    researcher: { requested: string; model: string | null; effort: Effort };
    reviewer: { requested: string; model: string | null; effort: Effort };
    concurrency: number;
    cycle: string;
    majors: string[];
  };
  truth_source: string;
  truth: Record<string, Truth>;
  colleges: CollegeResult[];
  calls: CallLog[];
  timing: { run_ms: number; research_phase_ms: number };
}

// ───────────────────────────── ground truth ─────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
function snapshotPath(): string {
  for (const p of [join(HERE, "scripts", "review-ground-truth.json"), join(HERE, "review-ground-truth.json"), "scripts/review-ground-truth.json"]) if (existsSync(p)) return p;
  throw new Error("scripts/review-ground-truth.json not found (run from college-compass-app/).");
}
interface Snapshot { fetched: string; colleges: Record<string, { unitid: string; scorecard: Record<string, number | string | null>; test_policy: { value: string; source: string } | null }> }
const snapshot = (): Snapshot => JSON.parse(readFileSync(snapshotPath(), "utf8"));

function truthFromSnapshot(name: string, snap: Snapshot): Truth | null {
  const c = snap.colleges[name];
  if (!c) return null;
  const n = (k: string) => (typeof c.scorecard[k] === "number" ? (c.scorecard[k] as number) : null);
  return {
    source: `snapshot ${snap.fetched}`, unitid: c.unitid,
    admit_rate: n("admit_rate"), sat_25: n("sat_25"), sat_75: n("sat_75"), cost_of_attendance: n("cost_of_attendance"),
    cost_of_attendance_basis: typeof c.scorecard.cost_of_attendance_basis === "string" ? c.scorecard.cost_of_attendance_basis : null,
    test_policy: c.test_policy?.value ?? null, test_policy_source: c.test_policy?.source ?? null,
  };
}

/** Live federal figures from the shared database (same lookup the app uses); snapshot per college otherwise. */
async function loadTruth(panel: typeof PANEL, mode: "live" | "snapshot"): Promise<{ source: string; truth: Record<string, Truth> }> {
  const snap = snapshot();
  const truth: Record<string, Truth> = {};
  let live = 0;
  if (mode === "live") {
    try {
      const { createSharedLookup, sharedConfig } = await import("../src/data/shared");
      const lookup = createSharedLookup(sharedConfig(), (...a) => globalThis.fetch(...a), 20000);
      const got = lookup ? await lookup.lookup(panel.map((p) => ({ name: p.name, state: p.state }))) : new Map();
      for (const p of panel) {
        const sc = got.get(p.name);
        const s = sc?.stats;
        if (!sc || !s) continue;
        const snapTp = snap.colleges[p.name]?.test_policy ?? null;
        truth[p.name] = {
          source: `live ${s.data_year ?? "College Scorecard"}`, unitid: sc.unitid,
          admit_rate: s.admit_rate, sat_25: s.sat_25, sat_75: s.sat_75, cost_of_attendance: s.cost_of_attendance, cost_of_attendance_basis: s.cost_of_attendance_basis,
          test_policy: snapTp?.value ?? null, test_policy_source: snapTp?.source ?? null,
        };
        live++;
      }
    } catch { /* fall back below */ }
  }
  for (const p of panel) {
    if (truth[p.name]) continue;
    const t = truthFromSnapshot(p.name, snap);
    if (t) truth[p.name] = t;
  }
  const source = live === panel.length ? "live shared database (College Scorecard)"
    : live ? `live shared database for ${live}/${panel.length}, checked-in snapshot (${snap.fetched}) for the rest`
    : `checked-in snapshot of the shared database (${snap.fetched})${mode === "live" ? " — live lookup unavailable" : ""}`;
  return { source, truth };
}

// ───────────────────────────── metered client ─────────────────────────────

const REVIEW_LINE = /^Review this research record for: (.+?)(?: \([A-Z]{2}\))?$/m;

function metered(client: AiClient & { listModels?(): Promise<{ slug: string; display_name: string }[]> }, tools: { research: string; review: string }, log: CallLog[]) {
  return {
    connection: () => client.connection(),
    ...(client.listModels ? { listModels: () => client.listModels!() } : {}),
    async call(o: Parameters<AiClient["call"]>[0]): Promise<AiCallResult> {
      const tool = o.tools?.[0]?.name;
      const role: CallLog["role"] = tool === tools.research ? "researcher" : tool === tools.review ? "reviewer" : "other";
      let labels: string[] = [];
      if (role === "researcher" && o.tag) {
        try { labels = (JSON.parse(decodeURIComponent(o.tag.split(":").slice(2).join(":"))) as { name: string }[]).map((t) => t.name); } catch { labels = []; }
      } else if (role === "reviewer") labels = [o.input[0]?.content.match(REVIEW_LINE)?.[1] ?? ""];
      const entry: CallLog = { role, labels, start: Date.now(), end: 0, ok: false, model: o.model ?? null, usage: null };
      log.push(entry);
      try {
        const r = await client.call(o);
        Object.assign(entry, { ok: true, model: r.model || entry.model, usage: r.usage ?? null });
        return r;
      } catch (e) {
        entry.error = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
        throw e;
      } finally {
        entry.end = Date.now();
      }
    },
  };
}

// ───────────────────────────── dry-run client ─────────────────────────────

/**
 * Deterministic stand-in for OpenAI: research records built from the ground truth with injected
 * errors, and a reviewer that fixes most of them, makes one change away from federal data (a "newer
 * CDS"), returns a low-confidence and an unsourced correction, and reports unverifiable fields.
 */
function dryClient(panel: typeof PANEL, truth: Record<string, Truth>, tools: { research: string; review: string }) {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const idx = (name: string) => Math.max(0, panel.findIndex((p) => p.name === name));
  const usage = (input: number, output: number, web: number): AiUsage => ({ input_tokens: input, output_tokens: output, reasoning_tokens: Math.round(output / 2), total_tokens: input + output, web_searches: web });
  function research(name: string): Record<string, unknown> {
    const i = idx(name);
    const p = panel[i]!;
    const t = truth[name];
    const pub = t?.cost_of_attendance_basis === "in_state";
    const tin = pub ? 12000 + i * 900 : 62000 + i * 900;
    const tout = pub ? tin + 24000 : tin;
    let admit = t?.admit_rate ?? 0.3;
    if (i % 3 === 0 && i !== 6) admit = Math.min(0.95, admit + 0.07); // i = 6: correct, then "corrected" to a newer-year figure
    let sat75 = t?.sat_75 ?? null;
    if (i % 4 === 1 && sat75 != null) sat75 = Math.min(1600, sat75 + 60);
    let coa = t?.cost_of_attendance != null ? (pub ? t.cost_of_attendance + (tout - tin) : t.cost_of_attendance) : null;
    let basis = pub ? "out_of_state" : "same";
    if (i % 5 === 2 && coa != null) { if (pub) basis = "in_state"; else coa = Math.round(coa * 1.15); }
    const policy = i % 5 === 3 ? (t?.test_policy === "optional" ? "required" : "optional") : t?.test_policy ?? "optional";
    const plans: Record<string, unknown>[] = [{ plan: "EA", deadline: "2026-11-01", notes: null }, { plan: "RD", deadline: "2027-01-05", notes: null }];
    if (i % 3 === 1) plans.unshift({ plan: "ED", deadline: "2026-11-15", notes: null });
    return {
      name: p.name, short: null, city: "", state: p.state, ownership: pub ? "public" : "private_nonprofit", locale: null, url: "https://example.edu",
      lat: null, lon: null, undergrad_size: null, admit_rate: i === 4 ? null : admit, sat_25: t?.sat_25 ?? null, sat_75: sat75, act_25: null, act_75: null,
      test_policy: policy, tuition_in_state: tin, tuition_out_of_state: tout, cost_of_attendance: coa, cost_of_attendance_basis: basis,
      avg_net_price: null, net_price_by_income: {}, grad_rate_6yr: null, retention_rate: null, median_earnings_10yr: null, program_share: [],
      hbcu: false, women_only: false, religious: false, cds: { cds_year: "2025-2026" },
      application: { cycle: CYCLE, plans, test_policy_note: null, essays_note: null, fee: null },
      programs: PROFILE.majors.map((m) => ({ major: m, offered: true, degree: "B.S.", how_to_enter: "Direct admit", notes: null })),
      scholarships: [], sources: [{ title: "CDS", url: "https://example.edu/cds.pdf" }], data_year: "2025-26 CDS", data_confidence: "high", data_notes: [],
    };
  }
  function review(record: Record<string, unknown>): Record<string, unknown> {
    const name = String(record.name);
    const i = idx(name);
    const t = truth[name];
    const src = `https://example.edu/${i}/official`;
    const fix = (field: string, nv: string, more: Record<string, unknown> = {}) => ({ field, plan: null, major: null, old: null, new: nv, source_url: src, confidence: "high", reason: "Official page.", ...more });
    const corrections: Record<string, unknown>[] = [];
    const admit = record.admit_rate as number | null;
    if (t?.admit_rate != null) {
      if (i === 6) corrections.push(fix("admit_rate", String(Math.round((t.admit_rate - 0.04) * 1000) / 1000), { confidence: "medium", reason: "Newer CDS 2025-2026 C1." }));
      else if (admit == null) corrections.push(fix("admit_rate", String(t.admit_rate), { confidence: "medium" }));
      else if (Math.abs(admit - t.admit_rate) > 0.02) corrections.push(fix("admit_rate", String(t.admit_rate)));
    }
    if (t?.sat_75 != null && record.sat_75 !== t.sat_75) corrections.push(fix("sat_75", String(t.sat_75)));
    if (record.ownership === "public" && record.cost_of_attendance_basis === "in_state" && i % 5 === 2) corrections.push(fix("cost_of_attendance_basis", "out_of_state"));
    if (t?.test_policy && record.test_policy !== t.test_policy) corrections.push(fix("test_policy", t.test_policy));
    const plans = ((record.application as { plans?: { plan: string; deadline: string | null }[] } | null)?.plans ?? []);
    if (plans.some((p) => p.plan === "ED" && p.deadline === "2026-11-15")) corrections.push(fix("plan_deadline", "2026-11-01", { plan: "ED" }));
    if (i % 2 === 0 && typeof record.sat_25 === "number") corrections.push(fix("sat_25", String((record.sat_25 as number) + 10), { confidence: "low" }));
    if (i === 7) corrections.push(fix("program_degree", "S.B. in Mechanical Engineering", { major: "engineering", source_url: null }));
    return {
      corrections,
      verified: ["sat_25", "tuition_in_state"],
      unverified: i % 2 ? [{ field: "plan_deadline", reason: "this cycle's dates not published" }] : [{ field: "program_how_to_enter", reason: "no catalog page found" }],
    };
  }
  const reqNames = (content: string) => [...content.matchAll(/^\d+\. (.+?)(?: \([A-Z]{2}\))?$/gm)].map((m) => m[1]!);
  return {
    connection: () => ({ kind: "api_key" as const }),
    listModels: async () => [{ slug: "luna-6", display_name: "Luna 6" }, { slug: "sol-6.1", display_name: "Sol 6.1" }, { slug: "gpt-5", display_name: "GPT-5" }],
    async call(o: Parameters<AiClient["call"]>[0]): Promise<AiCallResult> {
      const tool = o.tools?.[0]?.name;
      const content = o.input[0]?.content ?? "";
      if (tool === tools.review) {
        await sleep(20 + (content.length % 20));
        const json = content.match(/```json\n([\s\S]*?)\n```/)?.[1];
        const rec = json ? (JSON.parse(json) as Record<string, unknown>) : {};
        return { text: "", model: o.model ?? "dry", tool_calls: [{ name: tools.review, arguments: JSON.stringify(review(rec)) }], usage: usage(4200, 900, 3) };
      }
      const names = reqNames(content);
      await sleep(40 + 5 * names.length);
      return { text: "", model: o.model ?? "dry", tool_calls: [{ name: tools.research, arguments: JSON.stringify({ colleges: names.map(research) }) }], usage: usage(12500, 3100, 7) };
    },
  };
}

// ───────────────────────────── run ─────────────────────────────

async function run(): Promise<void> {
  installStorage(DRY ? new MemoryStorage() : new FileStorage(STORE));
  const { createResearch } = await import("../src/ai/research");
  const { createResearchCache } = await import("../src/ai/cache");
  const { REVIEW_TOOL_NAME, resolveModel } = await import("../src/ai/review");
  const { RESEARCH_TOOL_NAME } = await import("../src/ai/prompts");
  const { REVIEW_DEFAULTS } = await import("../src/ai/config");
  const tools = { research: RESEARCH_TOOL_NAME, review: REVIEW_TOOL_NAME };

  const n = Math.max(1, Math.min(PANEL.length, Number(flag("panel") ?? process.env.CC_PANEL ?? PANEL.length) || PANEL.length));
  const panel = PANEL.slice(0, n);
  const concurrency = Math.max(1, Math.min(12, Number(flag("concurrency") ?? process.env.CC_CONCURRENCY ?? n) || n));
  const wantResearcher = flag("researcher") ?? process.env.CC_RESEARCHER_MODEL ?? REVIEW_DEFAULTS.researcher.model;
  const wantReviewer = flag("reviewer") ?? process.env.CC_REVIEWER_MODEL ?? REVIEW_DEFAULTS.reviewer.model;
  const researcherEffort = effortOf(flag("researcher-effort") ?? process.env.CC_RESEARCHER_EFFORT, REVIEW_DEFAULTS.researcher.effort);
  const reviewerEffort = effortOf(flag("reviewer-effort") ?? process.env.CC_REVIEWER_EFFORT, REVIEW_DEFAULTS.reviewer.effort);

  let base: AiClient & { listModels?(): Promise<{ slug: string; display_name: string }[]> };
  let truthSource: string;
  let truth: Record<string, Truth>;
  if (DRY) {
    ({ source: truthSource, truth } = await loadTruth(panel, "snapshot"));
    base = dryClient(panel, truth, tools);
  } else {
    const { auth } = await import("../src/ai/auth");
    const { aiClient } = await import("../src/ai/client");
    const acct = auth.account();
    if (!acct) throw new Error("Not signed in. Run `npm run real-run -- login`, then `npm run real-run -- exchange '<callback url>'`.");
    console.log(`Signed in · plan usage: ${acct.plan_usage}`);
    base = aiClient;
    ({ source: truthSource, truth } = await loadTruth(panel, flag("truth") === "snapshot" ? "snapshot" : "live"));
  }
  const models = await base.listModels!();
  const researcherModel = resolveModel(wantResearcher, models);
  const reviewerModel = resolveModel(wantReviewer, models);
  if (!researcherModel || !reviewerModel) {
    console.error(`Model not available: ${!researcherModel ? `researcher "${wantResearcher}"` : ""}${!researcherModel && !reviewerModel ? " and " : ""}${!reviewerModel ? `reviewer "${wantReviewer}"` : ""}.`);
    console.error(`This account can use: ${models.map((m) => `${m.slug} (${m.display_name})`).join(", ") || "(none)"}`);
    console.error(`Pick with --researcher <slug> --reviewer <slug>.`);
    process.exit(2);
  }
  console.log(`Panel ${panel.length} · concurrency ${concurrency} · researcher ${researcherModel} (${researcherEffort}) · reviewer ${reviewerModel} (${reviewerEffort}) · truth: ${truthSource}${DRY ? " · DRY RUN (mocked client)" : ""}`);

  const calls: CallLog[] = [];
  const client = metered(base, tools, calls);
  localStorage.removeItem("cc2:review_compare_cache");
  const cache = createResearchCache({ key: "review_compare_cache" });
  const reviews = new Map<string, ReviewSummary>();
  const failed = new Map<string, string>();
  const t0 = Date.now();
  const sec = () => `${((Date.now() - t0) / 1000).toFixed(DRY ? 2 : 0)}s`;
  const onEvent = (e: ResearchEvent) => {
    if (e.type === "college_reviewed") {
      reviews.set(e.name, e.review);
      console.log(`[${sec()}] reviewed ${e.name}: ${e.review.error ? `FAILED (${e.review.error})` : `${e.review.applied.length} corrections, ${e.review.skipped.length} skipped, ${e.review.unverified.length} unverified`}`);
    } else if (e.type === "college_failed") {
      failed.set(e.name, e.error);
      console.log(`[${sec()}] research failed ${e.name}: ${e.error}`);
    } else if (e.type === "batch_started") console.log(`[${sec()}] researching ${e.names.join(", ")}`);
    else if (e.type === "error") console.log(`[${sec()}] ERROR ${e.code ?? ""} ${e.error}`);
  };
  try {
    await createResearch({ client, cache, shared: null, native: { begin() {}, end() {}, takeOrphans: async () => [] } }).run({
      profile: PROFILE,
      wanted: panel.map((p) => p.name),
      target_count: panel.length,
      concurrency,
      model: researcherModel,
      effort: { researcher: researcherEffort },
      review: { model: reviewerModel, effort: reviewerEffort },
      share_research: false,
      onEvent,
    });
  } catch (e) {
    console.error(`Research stopped: ${e instanceof Error ? e.message : String(e)} — saving what finished.`);
  }
  const runMs = Date.now() - t0;
  const researchEnd = Math.max(t0, ...calls.filter((c) => c.role === "researcher").map((c) => c.end));

  const results: Results = {
    version: 1,
    created_at: new Date().toISOString(),
    mode: DRY ? "dry" : "live",
    config: {
      researcher: { requested: wantResearcher, model: researcherModel, effort: researcherEffort },
      reviewer: { requested: wantReviewer, model: reviewerModel, effort: reviewerEffort },
      concurrency, cycle: CYCLE, majors: PROFILE.majors,
    },
    truth_source: truthSource,
    truth,
    colleges: panel.map((p) => ({ name: p.name, state: p.state, check: p.check, failed: failed.get(p.name) ?? (reviews.has(p.name) ? null : "no result"), review: reviews.get(p.name) ?? null })),
    calls,
    timing: { run_ms: runMs, research_phase_ms: researchEnd - t0 },
  };
  writeFileSync(RESULTS, JSON.stringify(results, null, 1));
  console.log(`Raw records cached: ${RESULTS} (re-score with: npm run review-compare -- score${RESULTS !== "cc-review-compare-results.json" ? ` --results ${RESULTS}` : ""})\n`);
  report(results);
}

async function score(): Promise<void> {
  if (!existsSync(RESULTS)) throw new Error(`No results at ${RESULTS}. Run \`npm run review-compare -- run\` first.`);
  const results = JSON.parse(readFileSync(RESULTS, "utf8")) as Results;
  if (flag("truth") === "live" || flag("truth") === "snapshot") {
    const panel = results.colleges.map((c) => ({ name: c.name, state: c.state, check: c.check }));
    const t = await loadTruth(panel, flag("truth") as "live" | "snapshot");
    results.truth = t.truth;
    results.truth_source = t.source;
  }
  report(results);
}

async function listModels(): Promise<void> {
  installStorage(new FileStorage(STORE));
  const { auth } = await import("../src/ai/auth");
  const { aiClient } = await import("../src/ai/client");
  const { REVIEW_DEFAULTS } = await import("../src/ai/config");
  const { resolveModel } = await import("../src/ai/review");
  if (!auth.account()) throw new Error("Not signed in. Run `npm run real-run -- login`, then `npm run real-run -- exchange '<callback url>'`.");
  const models = await aiClient.listModels();
  for (const m of models) console.log(`${m.slug.padEnd(28)} ${m.display_name}`);
  for (const role of ["researcher", "reviewer"] as const) {
    const want = REVIEW_DEFAULTS[role].model;
    console.log(`default ${role} "${want}" → ${resolveModel(want, models) ?? "NOT AVAILABLE (pass --" + role + " <slug>)"}`);
  }
}

// ───────────────────────────── scoring ─────────────────────────────

type CheckKey = "admit" | "sat25" | "sat75" | "coa" | "policy";
const CHECKS: { key: CheckKey; label: string }[] = [
  { key: "admit", label: "Admit rate (±2 pts)" },
  { key: "sat25", label: "SAT 25th (±30)" },
  { key: "sat75", label: "SAT 75th (±30)" },
  { key: "coa", label: "Cost of attendance (±10%)" },
  { key: "policy", label: "Test policy" },
];
/** Which check a corrected field affects (others — plans, programs, ACT — have no federal truth here). */
const FIELD_CHECK: Record<string, CheckKey> = {
  admit_rate: "admit", sat_25: "sat25", sat_75: "sat75", test_policy: "policy",
  cost_of_attendance: "coa", cost_of_attendance_basis: "coa", tuition_in_state: "coa", tuition_out_of_state: "coa",
};

interface Cell { value: number | string | null; truth: number | string | null; dist: number | null; ok: boolean | null; note?: string }

/** The record's cost of attendance on the federal basis (Scorecard publics: in-state tuition). */
function comparableCoa(c: College, t: Truth): { value: number | null; note?: string } {
  const coa = c.cost_of_attendance;
  if (coa == null) return { value: null };
  if (t.cost_of_attendance_basis !== "in_state") return { value: coa };
  const basis = c.cost_of_attendance_basis ?? null;
  if (basis === "in_state" || basis === "same") return { value: coa };
  if (basis === "out_of_state" && c.tuition_out_of_state != null && c.tuition_in_state != null) {
    return { value: coa - (c.tuition_out_of_state - c.tuition_in_state), note: "in-state equiv." };
  }
  return { value: coa, note: "basis unknown" };
}

function cell(c: College | null, t: Truth | undefined, key: CheckKey): Cell {
  const empty: Cell = { value: null, truth: null, dist: null, ok: null };
  if (!t) return empty;
  const num = (v: number | null, tv: number | null, tol: number, rel = false): Cell => {
    if (tv == null) return { ...empty, value: v };
    if (v == null) return { value: null, truth: tv, dist: null, ok: false, note: "missing" };
    const dist = rel ? Math.abs(v - tv) / tv : Math.abs(v - tv);
    return { value: v, truth: tv, dist, ok: dist <= tol + 1e-9 };
  };
  if (!c) return { ...empty, truth: null };
  switch (key) {
    case "admit": return num(c.admit_rate, t.admit_rate, 0.02);
    case "sat25": return num(c.sat_25, t.sat_25, 30);
    case "sat75": return num(c.sat_75, t.sat_75, 30);
    case "coa": {
      const v = comparableCoa(c, t);
      const out = num(v.value, t.cost_of_attendance, 0.1, true);
      return v.note ? { ...out, note: v.note } : out;
    }
    case "policy": {
      if (!t.test_policy) return { ...empty, value: c.test_policy };
      const v = c.test_policy === "unknown" ? null : c.test_policy;
      return v == null ? { value: null, truth: t.test_policy, dist: null, ok: false, note: "missing" } : { value: v, truth: t.test_policy, dist: v === t.test_policy ? 0 : 1, ok: v === t.test_policy };
    }
  }
}

/** closer / further / same for one check between the researcher's and the reviewed record. */
function direction(b: Cell, a: Cell): "closer" | "further" | "same" | "unscored" {
  if (a.truth == null) return "unscored";
  if (b.value === a.value) return "same";
  if (b.ok !== a.ok && a.ok != null && b.ok != null) return a.ok ? "closer" : "further";
  if (b.dist == null) return a.ok ? "closer" : "further"; // filled an empty value
  if (a.dist == null) return "further";
  return a.dist < b.dist ? "closer" : a.dist > b.dist ? "further" : "same";
}

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 1000) / 10}%`);
const money = (x: number | null) => (x == null ? "—" : `$${Math.round(x).toLocaleString("en-US")}`);
const secs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
function fmt(key: CheckKey, v: number | string | null): string {
  if (v == null) return "—";
  if (key === "admit") return pct(v as number);
  if (key === "coa") return money(v as number);
  return String(v);
}
const mark = (c: Cell) => (c.ok == null ? "" : c.ok ? " ✓" : " ✗");
const md = (s: string) => s.replace(/\|/g, "\\|");

function planMap(c: College | null): Map<string, string> {
  return new Map((c?.application?.plans ?? []).map((p) => [p.plan, p.deadline ?? "date?"]));
}

function sumUsage(calls: CallLog[], role: CallLog["role"]) {
  const out = { calls: 0, failed: 0, input: 0, output: 0, reasoning: 0, total: 0, web: 0, reported: 0, ms: 0 };
  for (const c of calls.filter((x) => x.role === role)) {
    out.calls++;
    if (!c.ok) out.failed++;
    out.ms += c.end - c.start;
    if (c.usage) {
      out.reported++;
      out.input += c.usage.input_tokens ?? 0;
      out.output += c.usage.output_tokens ?? 0;
      out.reasoning += c.usage.reasoning_tokens ?? 0;
      out.total += c.usage.total_tokens ?? (c.usage.input_tokens ?? 0) + (c.usage.output_tokens ?? 0);
      out.web += c.usage.web_searches;
    }
  }
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

function report(r: Results): void {
  const L: string[] = [];
  const cfg = r.config;
  L.push(`# Second-model review — comparison (${r.mode === "dry" ? "DRY RUN, mocked client" : "live"})`);
  L.push("");
  L.push(`${r.created_at.slice(0, 16).replace("T", " ")} UTC · ${r.colleges.length} colleges · ${cfg.cycle} · majors ${cfg.majors.join(", ")}`);
  L.push(`Researcher **${cfg.researcher.model}** (${cfg.researcher.effort}) → reviewer **${cfg.reviewer.model}** (${cfg.reviewer.effort}) · concurrency ${cfg.concurrency}`);
  L.push(`Ground truth: ${r.truth_source}. Federal figures lag the newest Common Data Set by 1–2 years; test policy truth is curated (only where well established).`);
  L.push("");

  const tot = { scored: 0, okB: 0, okA: 0, missB: 0, missA: 0 };
  const dirs = { closer: 0, further: 0, same: 0, unscored: 0 };
  const furtherList: string[] = [];
  let applied = 0, skipped = 0, unverified = 0, reviewFail = 0, planDiff = 0, reviewed = 0;
  const skipWhy = new Map<string, number>();
  const researchMs: number[] = [];
  const reviewMs: number[] = [];

  for (const c of r.colleges) {
    const t = r.truth[c.name];
    const rv = c.review;
    L.push(`## ${md(c.name)} (${c.state})`);
    L.push(`_Tricky: ${md(c.check)}_`);
    L.push("");
    if (!rv) { L.push(`Research failed: ${md(c.failed ?? "no result")}. Not scored.`, ""); continue; }
    reviewed++;
    if (rv.error) reviewFail++;
    const b = rv.before;
    const a = rv.after;
    const rCalls = r.calls.filter((x) => x.role === "researcher" && x.labels.includes(c.name));
    const vCalls = r.calls.filter((x) => x.role === "reviewer" && x.labels.includes(c.name));
    const rMs = rCalls.reduce((s, x) => s + x.end - x.start, 0);
    researchMs.push(rMs);
    reviewMs.push(rv.ms);

    L.push("| Check | Federal | Researcher | + Reviewer | Change |");
    L.push("|---|---|---|---|---|");
    const cells = new Map<CheckKey, { b: Cell; a: Cell; d: ReturnType<typeof direction> }>();
    for (const k of CHECKS) {
      const cb = cell(b, t, k.key);
      const ca = cell(a, t, k.key);
      const d = direction(cb, ca);
      cells.set(k.key, { b: cb, a: ca, d });
      if (ca.truth != null) {
        tot.scored++;
        if (cb.ok) tot.okB++;
        if (ca.ok) tot.okA++;
        if (cb.value == null) tot.missB++;
        if (ca.value == null) tot.missA++;
      }
      const note = (x: Cell) => (x.note && x.note !== "missing" ? ` (${x.note})` : "");
      L.push(`| ${k.label} | ${fmt(k.key, ca.truth ?? cb.truth)} | ${fmt(k.key, cb.value)}${mark(cb)}${note(cb)} | ${fmt(k.key, ca.value)}${mark(ca)}${note(ca)} | ${d === "same" || d === "unscored" ? (cb.value === ca.value ? "" : "changed (no truth)") : `**${d}**`} |`);
    }
    L.push("");

    for (const ch of rv.applied) {
      applied++;
      const key = FIELD_CHECK[ch.field.split(":")[0]!];
      const d = key ? cells.get(key)!.d : "unscored";
      dirs[d]++;
      if (d === "further") furtherList.push(`${c.name}: ${ch.field} ${ch.old ?? "—"} → ${ch.new} (${ch.confidence}; ${ch.source_url})`);
    }
    for (const s of rv.skipped) { skipped++; skipWhy.set(s.why, (skipWhy.get(s.why) ?? 0) + 1); }
    unverified += rv.unverified.length;
    if (rv.error) L.push(`**Review failed** (unreviewed record kept): ${md(rv.error)}`);
    L.push(`Reviewer: ${rv.applied.length} applied${rv.applied.length ? ` (${rv.applied.map((x) => `${x.field}: ${x.old ?? "—"} → ${x.new}`).join("; ")})` : ""}; ${rv.skipped.length} skipped${rv.skipped.length ? ` (${rv.skipped.map((x) => `${x.field}: ${x.why}`).join("; ")})` : ""}; couldn't verify: ${rv.unverified.map((u) => u.field).join(", ") || "nothing"}.`);
    L.push(`Time: research ${secs(rMs)} (${rCalls.length} call${rCalls.length === 1 ? "" : "s"}), review ${secs(rv.ms)} (${vCalls.length} call${vCalls.length === 1 ? "" : "s"}).`);
    L.push("");

    // Deadlines: no automatic truth — side by side for a human.
    const pb = planMap(b);
    const pa = planMap(a);
    const plans = [...new Set([...pb.keys(), ...pa.keys()])];
    const differs = plans.some((p) => pb.get(p) !== pa.get(p));
    if (differs) planDiff++;
    L.push(`Plans & deadlines (human spot-check)${differs ? " — **reviewer disagrees**" : ""}:`);
    L.push("");
    L.push("| Plan | Researcher | + Reviewer | |");
    L.push("|---|---|---|---|");
    for (const p of plans) L.push(`| ${p} | ${pb.get(p) ?? "not listed"} | ${pa.get(p) ?? "not listed"} | ${pb.get(p) !== pa.get(p) ? "⚠ differs" : ""} |`);
    if (!plans.length) L.push("| — | none listed | none listed | |");
    L.push("");
  }

  // ── totals ──
  const research = sumUsage(r.calls, "researcher");
  const review = sumUsage(r.calls, "reviewer");
  const addedMs = Math.max(0, r.timing.run_ms - r.timing.research_phase_ms);
  const timePct = r.timing.research_phase_ms ? Math.round((addedMs / r.timing.research_phase_ms) * 100) : 0;
  const tokPct = research.total ? Math.round((review.total / research.total) * 100) : null;
  L.push("## Totals");
  L.push("");
  L.push("| | Researcher only | + Reviewer |");
  L.push("|---|---|---|");
  L.push(`| Checks within tolerance (of ${tot.scored} with federal/curated truth) | ${tot.okB} | ${tot.okA} |`);
  L.push(`| Checks with no value | ${tot.missB} | ${tot.missA} |`);
  L.push(`| Wall clock | ${secs(r.timing.research_phase_ms)} | ${secs(r.timing.run_ms)} (+${secs(addedMs)}, +${timePct}%) |`);
  L.push(`| Median per college | research ${secs(median(researchMs))} | review +${secs(median(reviewMs))} |`);
  L.push(`| API calls (Responses) | ${research.calls}${research.failed ? ` (${research.failed} failed)` : ""} | +${review.calls}${review.failed ? ` (${review.failed} failed)` : ""} |`);
  if (research.reported || review.reported) {
    L.push(`| Tokens in / out (reasoning) | ${research.input.toLocaleString("en-US")} / ${research.output.toLocaleString("en-US")} (${research.reasoning.toLocaleString("en-US")}) | +${review.input.toLocaleString("en-US")} / +${review.output.toLocaleString("en-US")} (+${review.reasoning.toLocaleString("en-US")}) |`);
    L.push(`| Total tokens | ${research.total.toLocaleString("en-US")} | +${review.total.toLocaleString("en-US")}${tokPct != null ? ` (+${tokPct}%)` : ""} |`);
    L.push(`| Web searches | ${research.web} | +${review.web} |`);
  } else {
    L.push(`| Tokens | not reported by this route | not reported |`);
  }
  L.push("");
  L.push(`Corrections applied: **${applied}** — ${dirs.closer} moved a value closer to federal/curated truth, ${dirs.further} further, ${dirs.same} no measurable change, ${dirs.unscored} not checkable here (plans, programs, ACT).`);
  L.push(`Skipped by the conservative rules: ${skipped}${skipWhy.size ? ` (${[...skipWhy].map(([w, k]) => `${w} ${k}`).join(", ")})` : ""}. Fields the reviewer couldn't verify: ${unverified}. Failed reviews: ${reviewFail}/${reviewed}.`);
  L.push(`Colleges where the reviewer changed plans/deadlines (spot-check above): ${planDiff}/${reviewed}.`);
  if (furtherList.length) {
    L.push("");
    L.push("Moved away from federal data — check whether the reviewer's source is a newer year (then federal is just older):");
    for (const f of furtherList) L.push(`- ${md(f)}`);
  }
  L.push("");
  L.push(`**Recommendation:** ${recommend(tot, dirs, reviewFail, reviewed, timePct, tokPct)}`);

  const text = L.join("\n") + "\n";
  writeFileSync(REPORT, text);
  console.log(text);
  console.log(`Report written: ${REPORT}`);
}

function recommend(
  tot: { scored: number; okB: number; okA: number },
  dirs: { closer: number; further: number },
  fails: number,
  reviewed: number,
  timePct: number,
  tokPct: number | null,
): string {
  const cost = `+${timePct}% wall clock${tokPct != null ? `, +${tokPct}% tokens` : ""}`;
  if (!reviewed) return "Inconclusive — no college finished research.";
  if (fails === reviewed) return "Inconclusive — every review failed (see the errors above).";
  if (!tot.scored) return `Inconclusive — no federal ground truth matched; decide from the deadline spot-check (${cost}).`;
  const gain = tot.okA - tot.okB;
  if (dirs.further > dirs.closer) return `Don't turn it on: the reviewer moved ${dirs.further} figure(s) away from federal data and only ${dirs.closer} toward it (${tot.okB}→${tot.okA} of ${tot.scored} checks within tolerance; ${cost}).`;
  if (dirs.closer === 0) return `Not worth it on this evidence: no federally checkable figure improved (${tot.okB}→${tot.okA} of ${tot.scored}) for ${cost}. Look at the deadline spot-check before deciding.`;
  if (gain >= Math.max(1, Math.ceil(tot.scored * 0.05)) && dirs.further * 2 <= dirs.closer) {
    return `Worth turning on: checks within tolerance rose ${tot.okB}→${tot.okA} of ${tot.scored} (+${gain}); ${dirs.closer} correction(s) moved closer vs ${dirs.further} further; cost ${cost}. Confirm a few deadline changes by hand first.`;
  }
  return `Marginal: ${tot.okB}→${tot.okA} of ${tot.scored} checks within tolerance, ${dirs.closer} closer vs ${dirs.further} further, for ${cost}. Let the deadline spot-check decide.`;
}

// ───────────────────────────── main ─────────────────────────────

const main = cmd === "run" ? run
  : cmd === "score" ? score
  : cmd === "models" ? listModels
  : async () => { console.log("usage: review-compare run [--dry] [--panel n] [--concurrency n] [--researcher m] [--researcher-effort e] [--reviewer m] [--reviewer-effort e] | score [--truth live|snapshot] | models"); };
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });

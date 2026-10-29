/**
 * Research orchestration: plan (if needed) → research in parallel batches → resolve all.
 *
 * - Planner tops the student's own picks up to `target_count` (default 15).
 * - Batches of `batch_size` (default 1) colleges per agent call, `concurrency` (default 12) in flight.
 * - Per batch: one retry (for whatever is still missing), then split into single-college calls.
 * - Fresh cache hits (< 30 days, normalized name) are reused without a call.
 * - After a college is reported, its deadlines are checked against the college's own pages in the
 *   background (src/deadlines/verify.ts) and reported again as `college_checked`.
 * - Fatal errors (usage limit, sign-in, unsupported) stop everything: an `error` event is emitted and
 *   run() rejects. Aborting rejects with the AbortError. Per-college failures are reported as
 *   `college_failed` and run() still resolves with everything that succeeded.
 */
import { AiError, type AiCallResult, type AiClient, type College, type CollegeCandidate, type ResearchApi, type ResearchEvent, type ResearchOptions, type StudentProfile, type Tier } from "../types";
import { aiClient, parseResponsesText } from "./client";
import { beginResearchRun, endResearchRun, takeOrphanedResearch } from "../platform";
import { APP_VERSION, contributionPayload, createSharedLookup, installId, mergeShared, sharedResearchRecord, type SharedCollege, type SharedLookup } from "../data/shared";
import { researchCache as defaultCache, findFresh, fitsStudent, type ResearchCache } from "./cache";
import { applyChecks, checkCollegeDeadlines, needsDeadlineCheck } from "../deadlines/check";
import { stateCode } from "./geo";
import { extractJsonObject, namesMatch, normalizeCollege, normalizeName } from "./normalize";
import {
  PLANNER_TOOL_NAME, RESEARCH_TOOL_NAME, TIERS, entryTerm, plannerInput, plannerInstructions, proposeCollegesTool,
  researcherInput, researcherInstructions, submitResearchTool, type ResearchTarget,
} from "./prompts";

const FATAL: ReadonlySet<AiError["code"]> = new Set(["usage_limit", "reauth_required", "not_connected", "unsupported"]);

export function isAbort(e: unknown): boolean {
  return (e instanceof DOMException && e.name === "AbortError") || (e instanceof Error && e.name === "AbortError");
}
function isFatal(e: unknown): e is AiError {
  return e instanceof AiError && FATAL.has(e.code);
}
function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Simple counting semaphore. */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= max) return;
    const run = queue.shift();
    if (run) run();
  };
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function clampInt(v: number | undefined, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.min(hi, Math.max(lo, n));
}

class ResearchParseError extends Error {}

/** Arguments of the named tool call, else JSON found in the text. */
function toolArgs(res: { text: string; tool_calls: { name: string; arguments: string }[] }, tool: string): unknown {
  const call = res.tool_calls.find((c) => c.name === tool) ?? res.tool_calls.find((c) => c.name.endsWith(tool)) ?? res.tool_calls[0];
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
  throw new ResearchParseError("The model didn't return structured results.");
}

type Effort = "low" | "medium" | "high";

export interface ResearchDeps {
  client: AiClient;
  cache?: ResearchCache;
  now?: () => Date;
  /** Shared college data (federal Scorecard figures in Supabase). Null = off. Defaults to the app's project. */
  shared?: SharedLookup | null;
  /** iOS background tracking (defaults to the platform; no-ops on web). */
  native?: {
    begin(runId: string, expected: number): Promise<void> | void;
    end(runId: string): Promise<void> | void;
    takeOrphans(): Promise<{ tag: string; data: string }[]>;
  };
  /** Deadline proof check (src/deadlines/verify.ts); defaults to the app's HTTP. Null = off. */
  verify?: ((college: College, signal?: AbortSignal) => Promise<College>) | null;
}

const RUN_TAG = "research:";
/** Tag for one agent request: `research:<runId>:<targets JSON, URI-encoded>` (recoverable after an iOS relaunch). */
export function researchTag(runId: string, targets: ResearchTarget[]): string {
  return `${RUN_TAG}${runId}:${encodeURIComponent(JSON.stringify(targets.map((t) => ({ name: t.name, state: t.state }))))}`;
}
function targetsFromTag(tag: string): ResearchTarget[] | null {
  if (!tag.startsWith(RUN_TAG)) return null;
  const rest = tag.slice(RUN_TAG.length);
  const i = rest.indexOf(":");
  if (i < 0) return null;
  try {
    const v = JSON.parse(decodeURIComponent(rest.slice(i + 1)));
    return Array.isArray(v) ? v.filter((t) => t && typeof t.name === "string").map((t) => ({ name: t.name, state: typeof t.state === "string" ? t.state : null })) : null;
  } catch {
    return null;
  }
}
function newRunId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c && typeof c.randomUUID === "function" ? c.randomUUID() : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createResearch(deps: ResearchDeps): ResearchApi & {
  /** Exposed for tests / advanced callers: plan candidates without researching. */
  plan(profile: StudentProfile, existing: string[], count: number, model?: string, signal?: AbortSignal, onDelta?: (t: string) => void, effort?: Effort): Promise<CollegeCandidate[]>;
} {
  const cache = deps.cache ?? defaultCache;
  const now = deps.now ?? (() => new Date());
  const native = deps.native ?? { begin: beginResearchRun, end: endResearchRun, takeOrphans: takeOrphanedResearch };
  const shared = deps.shared === undefined ? createSharedLookup() : deps.shared;
  const verify = deps.verify === undefined ? checkCollegeDeadlines : deps.verify;

  async function plan(profile: StudentProfile, existing: string[], count: number, model?: string, signal?: AbortSignal, onDelta?: (t: string) => void, effort?: Effort): Promise<CollegeCandidate[]> {
    if (count <= 0) return [];
    const res = await deps.client.call({
      instructions: plannerInstructions(now()),
      input: plannerInput({ profile, existing, count }),
      model,
      ...(effort ? { reasoning: effort } : {}),
      tools: [proposeCollegesTool],
      tool_choice: { type: "function", name: PLANNER_TOOL_NAME },
      webSearch: true,
      onDelta,
      signal,
    });
    const args = toolArgs(res, PLANNER_TOOL_NAME) as { candidates?: unknown };
    const raw = Array.isArray(args?.candidates) ? args.candidates : Array.isArray(args) ? (args as unknown[]) : [];
    const out: CollegeCandidate[] = [];
    for (const r of raw) {
      const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim() : "";
      if (!name || name.length > 140) continue;
      if (existing.some((e) => namesMatch(e, name)) || out.some((c) => namesMatch(c.name, name))) continue;
      const tier = typeof o.expected_tier === "string" && (TIERS as readonly string[]).includes(o.expected_tier) ? (o.expected_tier as Tier) : null;
      out.push({
        name,
        state: stateCode(o.state),
        why: typeof o.why === "string" ? o.why.trim().slice(0, 240) : "",
        expected_tier: tier,
        user_added: false,
      });
      if (out.length >= count) break;
    }
    return out;
  }

  /** One agent call for a batch. Returns researched colleges per target + targets still missing. */
  async function researchBatch(targets: ResearchTarget[], profile: StudentProfile, model: string | undefined, signal: AbortSignal | undefined, effort?: Effort, tag?: string) {
    const res = await deps.client.call({
      instructions: researcherInstructions(now()),
      input: researcherInput(targets, profile),
      model,
      ...(effort ? { reasoning: effort } : {}),
      tools: [submitResearchTool],
      tool_choice: { type: "function", name: RESEARCH_TOOL_NAME },
      webSearch: true,
      signal,
      ...(tag ? { tag } : {}),
    });
    return mapResearch(res, targets, profile);
  }

  /** Match a researcher answer to the requested colleges and normalize them. */
  function mapResearch(res: AiCallResult, targets: ResearchTarget[], profile: StudentProfile) {
    const args = toolArgs(res, RESEARCH_TOOL_NAME) as { colleges?: unknown };
    const list: unknown[] = Array.isArray(args?.colleges) ? args.colleges : Array.isArray(args) ? (args as unknown[]) : args && typeof args === "object" && "name" in (args as object) ? [args] : [];
    const nameOf = (x: unknown) => (x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string" ? (x as { name: string }).name : "");
    // Pass 1: match by name. Pass 2: nicknames ("Georgia Tech") won't match official names — fall
    // back to position when the counts agree (or there is a single target).
    const used = new Set<number>();
    const pick: number[] = targets.map((t) => {
      const j = list.findIndex((x, k) => {
        if (used.has(k) || !namesMatch(t.name, nameOf(x))) return false;
        const st = stateCode((x as { state?: unknown })?.state);
        return !t.state || !st || st === t.state; // "Miami University (OH)" ≠ "University of Miami (FL)"
      });
      if (j >= 0) used.add(j);
      return j;
    });
    if (list.length === targets.length) {
      pick.forEach((j, i) => {
        if (j < 0 && !used.has(i)) { pick[i] = i; used.add(i); }
      });
    }
    const done: { target: ResearchTarget; college: College }[] = [];
    const missing: ResearchTarget[] = [];
    targets.forEach((t, i) => {
      const j = pick[i]!;
      const college = j >= 0 ? normalizeCollege(list[j], { requestedName: t.name, requestedState: t.state, cycle: `${entryTerm(profile)} entry`, now: now() }) : null;
      if (college) done.push({ target: t, college });
      else missing.push(t);
    });
    if (!done.length && targets.length) throw new ResearchParseError("The research results didn't match the requested colleges.");
    return { done, missing };
  }

  /** File away research responses iOS delivered after it had terminated the suspended app. */
  async function recoverOrphans(profile: StudentProfile): Promise<College[]> {
    let orphans: { tag: string; data: string }[] = [];
    try { orphans = await native.takeOrphans(); } catch { return []; }
    const out: College[] = [];
    for (const o of orphans) {
      const targets = targetsFromTag(o.tag);
      const res = targets?.length ? parseResponsesText(o.data) : null;
      if (!targets || !res) continue;
      try {
        for (const d of mapResearch(res, targets, profile).done) {
          try { cache.put(d.college, [d.target.name]); } catch { /* best-effort */ }
          out.push(d.college);
        }
      } catch { /* unusable answer: those colleges are simply researched again */ }
    }
    return out;
  }

  async function run(opts: ResearchOptions): Promise<College[]> {
    const { profile } = opts;
    const emit = (e: ResearchEvent) => {
      try { opts.onEvent(e); } catch { /* UI handler errors must not break research */ }
    };
    const target = clampInt(opts.target_count, 1, 40, 15);
    // Live timing (ChatGPT plan, web search, 6 colleges): 3 per agent 306 s, 2 per agent 303 s,
    // 1 per agent (6 agents) 176 s with the same sources and figures. Faster models / low effort
    // dropped or got wrong key figures (e.g. admit rate), so keep the model and research effort and
    // go wide: 1 college per agent, up to 12 agents at once (a default 12-college run is one wave).
    const batchSize = clampInt(opts.batch_size, 1, 5, 1);
    const concurrency = clampInt(opts.concurrency, 1, 12, 12);

    // Internal controller so a fatal error stops in-flight calls too.
    const ctrl = new AbortController();
    const outer = opts.signal;
    const onOuterAbort = () => ctrl.abort(outer?.reason);
    if (outer?.aborted) throw outer.reason ?? new DOMException("Aborted", "AbortError");
    outer?.addEventListener("abort", onOuterAbort, { once: true });
    const signal = ctrl.signal;
    let fatal: AiError | null = null;
    let endRun: (() => Promise<void> | void) | null = null;
    const fail = (e: AiError) => {
      if (!fatal) {
        fatal = e;
        emit({ type: "error", error: e.message, code: e.code });
        ctrl.abort(e);
      }
    };

    try {
      // 1) Candidates: the student's own picks first (deduped), then the planner's.
      const wanted: string[] = [];
      for (const w of opts.wanted.map((s) => String(s ?? "").replace(/\s+/g, " ").trim()).filter(Boolean)) {
        if (!wanted.some((x) => normalizeName(x) === normalizeName(w))) wanted.push(w);
      }
      const candidates: CollegeCandidate[] = wanted.map((name) => ({ name, state: null, why: "You added this college.", expected_tier: null, user_added: true }));
      if (wanted.length < target) {
        emit({ type: "planning" });
        try {
          const proposed = await plan(profile, wanted, target - wanted.length, opts.planner_model ?? opts.model, signal, (t) => emit({ type: "summary_delta", text: t }), opts.effort?.planner ?? "low");
          candidates.push(...proposed);
        } catch (e) {
          if (isAbort(e) && !fatal) throw e;
          if (isFatal(e)) { fail(e); throw e; }
          if (fatal) throw fatal;
          if (!wanted.length) {
            const err = e instanceof AiError ? e : new AiError("server", `Couldn't pick colleges: ${message(e)}`);
            fail(err);
            throw err;
          }
          // Planner failed but the student named colleges: research those.
        }
        if (!candidates.length) {
          const err = new AiError("server", "Couldn't come up with colleges for this profile. Try again, or add a few colleges you like.");
          fail(err);
          throw err;
        }
      }
      emit({ type: "planned", candidates });

      // 2) Cache reuse — first file away any research iOS finished while the app wasn't running.
      await recoverOrphans(profile);
      const results = new Map<CollegeCandidate, College>();
      const toResearch: CollegeCandidate[] = [];
      const nowMs = now().getTime();
      const cycle = `${entryTerm(profile)} entry`;
      const usable = (c: College | null) => (c && fitsStudent(c, profile.majors, cycle) ? c : null);

      // Deadline proof checks run in the background after a college is reported, so the list never
      // waits on a college website. The result replaces the college (`college_checked`) and stays on
      // this device: it is never contributed, and a shared record's own is dropped on read. Awaited
      // before `done`. `needsDeadlineCheck` skips plans this device already checked (a transient
      // failure is retried after a day), so cached colleges are covered too.
      const share = opts.share_research !== false && !!shared?.contribute;
      const pendingChecks: Promise<void>[] = [];
      const proofCheck = (cand: CollegeCandidate, college: College) => {
        if (!verify || !needsDeadlineCheck(college, now())) return;
        const task = async () => {
          let checked = college;
          try { checked = applyChecks(college, await verify(college, signal)); } catch { /* stays unchecked */ }
          if (checked !== college && !fatal && !signal.aborted) {
            results.set(cand, checked);
            try { cache.put(checked, [cand.name]); } catch { /* cache is best-effort */ }
            emit({ type: "college_checked", college: checked });
          }
        };
        pendingChecks.push(task().catch(() => {}));
      };

      for (const c of candidates) {
        const hit = usable(findFresh(opts.cache, c.name, nowMs)) ?? usable(cache.get(c.name));
        if (hit) {
          results.set(c, hit);
          emit({ type: "college_done", college: hit });
          proofCheck(c, hit); // only what is still unchecked, or a stale transient failure
        } else toResearch.push(c);
      }

      // 2b) Shared database: federal figures for everything we research, and verified research other
      // students already did for this cycle — those colleges need no ChatGPT call at all.
      let sharedMap = new Map<string, SharedCollege>();
      if (shared && toResearch.length) {
        try { sharedMap = await shared.lookup(toResearch.map((c) => ({ name: c.name, state: c.state })), signal); } catch { /* research proceeds */ }
      }
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");


      for (const c of [...toResearch]) {
        const facts = sharedMap.get(c.name);
        const rec = facts ? sharedResearchRecord(facts, cycle, profile.majors, now().getTime()) : null;
        if (!facts || !rec) continue;
        const normalized = normalizeCollege(rec.raw, { requestedName: c.name, requestedState: c.state, cycle, now: now() });
        if (!normalized) continue;
        const college = mergeShared(
          { ...normalized, researched_at: rec.researchedAt || normalized.researched_at, data_notes: [`Shared research verified by ${rec.verified} students' independent results (no personal data is shared).`, ...normalized.data_notes] },
          facts,
        );
        results.set(c, college);
        try { cache.put(college, [c.name]); } catch { /* cache is best-effort */ }
        emit({ type: "college_done", college });
        toResearch.splice(toResearch.indexOf(c), 1);
        proofCheck(c, college); // shared research is checked on this device like fresh research (a shared check is never trusted)
      }

      // 3) Parallel batches.
      const limit = createLimiter(concurrency);
      const runId = newRunId();
      const batches = chunk(toResearch, batchSize);
      if (batches.length) {
        endRun = () => native.end(runId);
        try { await native.begin(runId, batches.length); } catch { /* best-effort */ }
      }
      const record = async (cand: CollegeCandidate, researched: College) => {
        let facts = sharedMap.get(cand.name);
        // Planner/student names ("UNC Chapel Hill") may not match; research returns the official name.
        if (!facts && shared && researched.name && researched.name !== cand.name) {
          try { facts = (await shared.lookup([{ name: researched.name, state: researched.state || null }], signal)).get(researched.name); } catch { /* optional */ }
        }
        const college = facts ? mergeShared(researched, facts) : researched;
        // Give back: the researched facts only (before federal gap-filling), never profile, notes or check results.
        if (share) void shared!.contribute!(contributionPayload(researched, cycle, installId(), APP_VERSION));
        results.set(cand, college);
        try { cache.put(college, [cand.name]); } catch { /* cache is best-effort */ }
        emit({ type: "college_done", college });
        proofCheck(cand, college);
      };
      const byTarget = (t: ResearchTarget) => toResearch.find((c) => c.name === t.name)!;

      const batchTask = async (batch: CollegeCandidate[], no: number): Promise<ResearchTarget[]> => {
        if (fatal || signal.aborted) return [];
        emit({ type: "batch_started", batch: no, names: batch.map((c) => c.name) });
        let remaining: ResearchTarget[] = batch.map((c) => ({ name: c.name, state: c.state }));
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 2 && remaining.length; attempt++) {
          try {
            const r = await researchBatch(remaining, profile, opts.model, signal, opts.effort?.researcher, researchTag(runId, remaining));
            for (const d of r.done) await record(byTarget(d.target), d.college);
            remaining = r.missing;
          } catch (e) {
            if (fatal || isAbort(e)) return [];
            if (isFatal(e)) { fail(e); return []; }
            lastErr = e;
          }
        }
        if (!remaining.length) return [];
        if (remaining.length === 1 && batch.length === 1) {
          emit({ type: "college_failed", name: remaining[0]!.name, error: lastErr ? message(lastErr) : "No results were returned." });
          return [];
        }
        return remaining; // → split into single-college calls
      };

      const singleTask = async (t: ResearchTarget): Promise<void> => {
        if (fatal || signal.aborted) return;
        try {
          const r = await researchBatch([t], profile, opts.model, signal, opts.effort?.researcher, researchTag(runId, [t]));
          const d = r.done[0];
          if (d) await record(byTarget(t), d.college);
          else emit({ type: "college_failed", name: t.name, error: "No results were returned." });
        } catch (e) {
          if (fatal || isAbort(e)) return;
          if (isFatal(e)) return fail(e);
          emit({ type: "college_failed", name: t.name, error: message(e) });
        }
      };

      await Promise.all(
        batches.map((batch, no) =>
          limit(() => batchTask(batch, no))
            .then((left) => Promise.all(left.map((t) => limit(() => singleTask(t)))))
            .then(() => { if (!fatal && !signal.aborted) emit({ type: "batch_done", batch: no }); }),
        ),
      );

      if (fatal) throw fatal;
      if (outer?.aborted) throw outer.reason ?? new DOMException("Aborted", "AbortError");
      // Proof checks are bounded (≤ 8 s a page, 3 pages a college) and the colleges are already on the list.
      await Promise.all(pendingChecks);
      if (fatal) throw fatal;
      if (outer?.aborted) throw outer.reason ?? new DOMException("Aborted", "AbortError");
      const colleges = candidates.map((c) => results.get(c)).filter((c): c is College => !!c);
      // Same college reached via two names (e.g. a nickname and the official name) → keep one.
      const unique = colleges.filter((c, i) => colleges.findIndex((x) => x.id === c.id) === i);
      emit({ type: "done", colleges: unique });
      return unique;
    } finally {
      outer?.removeEventListener("abort", onOuterAbort);
      if (endRun) { try { await endRun(); } catch { /* best-effort */ } }
    }
  }

  async function researchOne(name: string, profile: StudentProfile, model?: string, signal?: AbortSignal): Promise<College> {
    const t: ResearchTarget = { name: name.replace(/\s+/g, " ").trim(), state: null };
    if (!t.name) throw new AiError("server", "Enter a college name.");
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await researchBatch([t], profile, model, signal);
        const d = r.done[0];
        if (d) {
          try { cache.put(d.college, [t.name]); } catch { /* best-effort */ }
          return d.college;
        }
      } catch (e) {
        if (isAbort(e) || isFatal(e)) throw e;
        lastErr = e;
      }
    }
    if (lastErr instanceof AiError) throw lastErr;
    throw new AiError("server", `Couldn't research ${t.name}${lastErr ? `: ${message(lastErr)}` : "."}`);
  }

  return { run, researchOne, plan };
}

/** App-wide singleton wired to the real AI client and on-device cache. */
export const research: ResearchApi = createResearch({ client: aiClient });

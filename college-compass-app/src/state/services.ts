/**
 * The ONE seam between the UI and the engine / AI modules built by other owners.
 * Screens and the store import from here only.
 *
 * Swap points (search for "SWAP"): when `src/engine/index.ts` and `src/ai/*` exist,
 * replace the stub imports with the real modules — nothing else changes.
 */
import type { College, RankedCollege, ResearchApi, ResearchOptions, StudentProfile } from "@/types";
import { AiError } from "@/types";
import { DEMO_COLLEGES } from "./fixtures";

import { rankColleges, buildBalancedList, summarizeListForAi, type BalancedListResult } from "@/engine";
import { auth } from "@/ai/auth";
import { aiClient, getDevApiKey, setDevApiKey, getPreferredModel, setPreferredModel } from "@/ai/client";
import { research as liveResearch } from "@/ai/research";
import { chatInstructions, deadlinesBrief } from "@/ai/prompts";
import { MANAGE_USAGE_URL } from "@/ai/config";

export { rankColleges, summarizeListForAi, auth, aiClient, chatInstructions, deadlinesBrief, MANAGE_USAGE_URL, setDevApiKey, getPreferredModel, setPreferredModel };
export type { BalancedListResult };

export function devKey(): string | null {
  return getDevApiKey();
}

/** Balanced picks per tier (engine spec + budget rule) plus every researched college that didn't make a bucket. */
export function balance(ranked: RankedCollege[], profile: StudentProfile): { picks: BalancedListResult; others: RankedCollege[] } {
  const built = buildBalancedList(ranked, undefined, profile);
  // Show every pick under its OWN tier. The engine may borrow a college from a neighboring
  // tier to fill a short bucket; listing a 1% school under "Reach" would mislabel its odds.
  const all = [...built.high_reach, ...built.reach, ...built.target, ...built.likely, ...built.safety];
  const regrouped = { high_reach: [] as RankedCollege[], reach: [] as RankedCollege[], target: [] as RankedCollege[], likely: [] as RankedCollege[], safety: [] as RankedCollege[] };
  for (const r of all) regrouped[r.odds.tier].push(r);
  const order = (a: RankedCollege, b: RankedCollege) => b.fit.total - a.fit.total || a.college.name.localeCompare(b.college.name);
  for (const k of Object.keys(regrouped) as (keyof typeof regrouped)[]) regrouped[k].sort(order);
  const picks: BalancedListResult = { ...built, ...regrouped, borrowed: [] };
  const used = new Set<RankedCollege>([...picks.high_reach, ...picks.reach, ...picks.target, ...picks.likely, ...picks.safety]);
  const others = ranked.filter((r) => !used.has(r));
  return { picks, others };
}

/** True when research / chat may call the AI layer (ChatGPT account or developer key). */
export function isConnected(): boolean {
  return !!auth.account() || !!devKey();
}

// ───────────────────────────── Demo research (offline, fixtures) ─────────────────────────────

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function findFixture(name: string): College | null {
  const n = norm(name);
  if (!n) return null;
  return (
    DEMO_COLLEGES.find((c) => norm(c.name) === n || norm(c.short) === n) ??
    DEMO_COLLEGES.find((c) => norm(c.name).includes(n) || n.includes(norm(c.short))) ??
    null
  );
}

/** A plausible, clearly-labelled placeholder for a college we have no fixture for. */
function placeholderCollege(name: string): College {
  const id = "demo-" + norm(name).replace(/\s+/g, "-");
  return {
    id,
    name,
    short: name.length > 22 ? name.slice(0, 21) + "…" : name,
    city: "Unknown",
    state: "--",
    region: "other",
    lat: null,
    lon: null,
    ownership: "private_nonprofit",
    locale: null,
    url: null,
    undergrad_size: null,
    admit_rate: null,
    sat_25: null,
    sat_75: null,
    act_25: null,
    act_75: null,
    test_policy: "unknown",
    tuition_in_state: null,
    tuition_out_of_state: null,
    cost_of_attendance: null,
    avg_net_price: null,
    net_price_by_income: { "0_30k": null, "30_48k": null, "48_75k": null, "75_110k": null, "110k_plus": null },
    grad_rate_6yr: null,
    retention_rate: null,
    median_earnings_10yr: null,
    program_share: {},
    hbcu: false,
    women_only: false,
    religious: false,
    data_year: "n/a",
    source: "ai_research",
    sources: [],
    researched_at: new Date().toISOString(),
    data_confidence: "low",
    data_notes: ["Demo mode has no data for this college. Sign in with ChatGPT to research it."],
  };
}

const demoResearch: ResearchApi = {
  async run(opts: ResearchOptions): Promise<College[]> {
    const { onEvent, signal } = opts;
    const batchSize = opts.batch_size ?? 3;
    const concurrency = opts.concurrency ?? 4;
    onEvent({ type: "planning" });
    await sleep(900, signal);
    const wantedFixtures = opts.wanted.map(findFixture).filter((c): c is College => !!c);
    const rest = DEMO_COLLEGES.filter((c) => !wantedFixtures.includes(c));
    const all = [...wantedFixtures, ...rest];
    onEvent({
      type: "planned",
      candidates: all.map((c) => ({ name: c.name, state: c.state, why: c.programs?.[0]?.notes ?? "Balanced pick for your profile", expected_tier: null, user_added: wantedFixtures.includes(c) })),
    });
    const batches: College[][] = [];
    for (let i = 0; i < all.length; i += batchSize) batches.push(all.slice(i, i + batchSize));
    const done: College[] = [];
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const idx = next++;
        const batch = batches[idx];
        onEvent({ type: "batch_started", batch: idx, names: batch.map((c) => c.name) });
        for (const c of batch) {
          await sleep(700 + Math.random() * 900, signal);
          onEvent({ type: "college_done", college: { ...c, researched_at: new Date().toISOString() } });
          done.push(c);
        }
        onEvent({ type: "batch_done", batch: idx });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
    onEvent({ type: "done", colleges: done });
    return done;
  },
  async researchOne(name: string, _profile: StudentProfile, _model?: string, signal?: AbortSignal): Promise<College> {
    await sleep(1200, signal);
    return findFixture(name) ?? placeholderCollege(name);
  },
};

/** Pick the research implementation for the current mode. */
export function researchApi(demo: boolean): ResearchApi {
  return demo ? demoResearch : liveResearch;
}

/** Friendly copy for an AiError or unknown failure. */
export function describeError(err: unknown): { title: string; detail: string; code?: AiError["code"] } {
  if (err instanceof DOMException && err.name === "AbortError") return { title: "Stopped", detail: "Research was cancelled." };
  if (err instanceof AiError) {
    switch (err.code) {
      case "usage_limit":
        return { title: "ChatGPT usage limit reached", detail: "Your plan's limit for now has been used. Check Manage usage or try again later.", code: err.code };
      case "reauth_required":
        return { title: "Please sign in again", detail: "Your ChatGPT session expired.", code: err.code };
      case "not_connected":
        return { title: "Not signed in", detail: "Sign in with ChatGPT to continue.", code: err.code };
      case "network":
        return { title: "No connection", detail: "Check your internet connection and try again.", code: err.code };
      case "unsupported":
        return { title: "Not available", detail: err.message, code: err.code };
      default:
        return { title: "Something went wrong", detail: err.message || "The AI service returned an error.", code: err.code };
    }
  }
  return { title: "Something went wrong", detail: err instanceof Error ? err.message : String(err) };
}

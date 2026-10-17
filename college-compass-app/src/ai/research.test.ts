import { beforeEach, describe, expect, it } from "vitest";
import { AiError, type AiCallResult, type AiClient, type ResearchEvent } from "../types";
import { createResearchCache } from "./cache";
import { PLANNER_TOOL_NAME, RESEARCH_TOOL_NAME } from "./prompts";
import { createLimiter, createResearch } from "./research";
import { baseProfile, fakeCollege, installMemoryStorage, rawCollege } from "./test-helpers";

type CallOpts = Parameters<AiClient["call"]>[0];
const NOW = new Date("2026-10-16T12:00:00Z");

/** Names requested in a researcher call (parsed back out of the prompt). */
function requested(o: CallOpts): string[] {
  const text = o.input[0]!.content;
  return [...text.matchAll(/^\d+\. (.+?)(?: \([A-Z]{2}\))?$/gm)].map((m) => m[1]!);
}

interface MockOpts {
  planned?: string[];
  delayMs?: number;
  /** Return a result (or throw) for a researcher call; default: research every requested name. */
  research?: (names: string[], callNo: number) => AiCallResult | Promise<AiCallResult>;
  planner?: () => AiCallResult | Promise<AiCallResult>;
}

function researchResult(names: string[]): AiCallResult {
  return { text: "", model: "m", tool_calls: [{ name: RESEARCH_TOOL_NAME, arguments: JSON.stringify({ colleges: names.map((n) => rawCollege(n)) }) }] };
}

function mockClient(o: MockOpts = {}) {
  const calls: CallOpts[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let researchCalls = 0;
  const client: AiClient = {
    connection: () => ({ kind: "api_key" }),
    async call(opts) {
      calls.push(opts);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((r) => setTimeout(r, o.delayMs ?? 5));
        if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException("Aborted", "AbortError");
        const tool = opts.tools?.[0]?.name;
        if (tool === PLANNER_TOOL_NAME) {
          if (o.planner) return await o.planner();
          const names = o.planned ?? [];
          return { text: "", model: "m", tool_calls: [{ name: PLANNER_TOOL_NAME, arguments: JSON.stringify({ candidates: names.map((n) => ({ name: n, state: "NC", why: "fit", expected_tier: "target" })) }) }] };
        }
        const names = requested(opts);
        const n = ++researchCalls;
        return o.research ? await o.research(names, n) : researchResult(names);
      } finally {
        inFlight--;
      }
    },
  };
  return { client, calls, stats: () => ({ maxInFlight, researchCalls }) };
}

function setup(m: ReturnType<typeof mockClient>) {
  const cache = createResearchCache({ key: "test_cache", now: () => NOW.getTime() });
  const r = createResearch({ client: m.client, cache, now: () => NOW });
  return { r, cache };
}

const names = (n: number, prefix = "College") => Array.from({ length: n }, (_, i) => `${prefix} ${String.fromCharCode(65 + i)}`);

beforeEach(() => {
  installMemoryStorage();
});

describe("createLimiter", () => {
  it("never runs more than `max` tasks at once", async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const out = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 2 + (i % 3)));
          active--;
          return i;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(out).toEqual([...Array(10).keys()]);
  });
});

describe("research.run", () => {
  it("plans when the student named too few, batches by 3 and respects concurrency", async () => {
    const m = mockClient({ planned: names(13, "Planned") });
    const { r } = setup(m);
    const events: ResearchEvent[] = [];
    const out = await r.run({ profile: baseProfile(), wanted: ["Duke University", "duke university", "Elon University"], onEvent: (e) => events.push(e), concurrency: 2, batch_size: 3 });

    const planner = m.calls.filter((c) => c.tools?.[0]?.name === PLANNER_TOOL_NAME);
    expect(planner).toHaveLength(1);
    expect(planner[0]!.input[0]!.content).toContain("Propose exactly 13 additional colleges");
    expect(planner[0]!.input[0]!.content).not.toContain("Should Not Appear"); // no name in prompts
    expect(out).toHaveLength(15);
    expect(out[0]!.name).toBe("Duke University"); // wanted first, deduped
    expect(out[1]!.name).toBe("Elon University");
    expect(m.stats().researchCalls).toBe(5);
    expect(m.stats().maxInFlight).toBeLessThanOrEqual(2);

    const research = m.calls.filter((c) => c.tools?.[0]?.name === RESEARCH_TOOL_NAME);
    for (const c of research) {
      expect(requested(c).length).toBeLessThanOrEqual(3);
      expect(c.webSearch).toBe(true);
      expect(c.tool_choice).toEqual({ type: "function", name: RESEARCH_TOOL_NAME });
    }
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("planning");
    expect(types).toContain("planned");
    expect(types.filter((t) => t === "college_done")).toHaveLength(15);
    expect(types.filter((t) => t === "batch_done")).toHaveLength(5);
    expect(types.at(-1)).toBe("done");
    const planned = events.find((e) => e.type === "planned") as Extract<ResearchEvent, { type: "planned" }>;
    expect(planned.candidates.filter((c) => c.user_added).map((c) => c.name)).toEqual(["Duke University", "Elon University"]);
  });

  it("planner runs at low effort; researchers keep the model's default effort (accuracy)", async () => {
    const m = mockClient({ planned: names(4, "Planned") });
    const { r } = setup(m);
    await r.run({ profile: baseProfile(), wanted: [], target_count: 4, onEvent: () => {} });
    const planner = m.calls.filter((c) => c.tools?.[0]?.name === PLANNER_TOOL_NAME);
    const research = m.calls.filter((c) => c.tools?.[0]?.name === RESEARCH_TOOL_NAME);
    expect(planner[0]!.reasoning).toBe("low");
    expect(research.length).toBeGreaterThan(0);
    for (const c of research) expect(c.reasoning).toBeUndefined();
  });

  it("skips the planner when enough colleges were named, and goes wide by default (1 per agent, up to 12 agents)", async () => {
    const m = mockClient({ delayMs: 15 });
    const { r } = setup(m);
    const out = await r.run({ profile: baseProfile(), wanted: names(18), target_count: 15, onEvent: () => {} });
    expect(m.calls.some((c) => c.tools?.[0]?.name === PLANNER_TOOL_NAME)).toBe(false);
    expect(out).toHaveLength(18);
    expect(m.stats().researchCalls).toBe(18);
    expect(m.stats().maxInFlight).toBe(12);
  });

  it("retries a failed batch once, then splits into single-college calls", async () => {
    const m = mockClient({
      research: (ns) => {
        if (ns.length > 1) throw new AiError("server", "boom");
        if (ns[0] === "College B") throw new AiError("server", "still broken");
        return researchResult(ns);
      },
    });
    const { r } = setup(m);
    const events: ResearchEvent[] = [];
    const out = await r.run({ profile: baseProfile(), wanted: names(3), target_count: 3, batch_size: 3, onEvent: (e) => events.push(e) });
    // 2 batch attempts + 3 singles
    expect(m.stats().researchCalls).toBe(5);
    expect(out.map((c) => c.name)).toEqual(["College A", "College C"]);
    expect(events).toContainEqual({ type: "college_failed", name: "College B", error: "still broken" });
    expect(events.filter((e) => e.type === "batch_done")).toHaveLength(1);
  });

  it("retries only the colleges missing from a partial answer", async () => {
    const m = mockClient({ research: (ns, n) => researchResult(n === 1 ? ns.slice(0, 2) : ns) });
    const { r } = setup(m);
    const out = await r.run({ profile: baseProfile(), wanted: ["Alpha University", "Beta College", "Gamma Institute"], target_count: 3, batch_size: 3, onEvent: () => {} });
    expect(out).toHaveLength(3);
    expect(m.stats().researchCalls).toBe(2);
    const second = m.calls.filter((c) => c.tools?.[0]?.name === RESEARCH_TOOL_NAME)[1]!;
    expect(requested(second)).toEqual(["Gamma Institute"]);
  });

  it("falls back to JSON in text when no tool call came back, and matches nicknames by position", async () => {
    const m = mockClient({
      research: () => ({ text: "```json\n" + JSON.stringify({ colleges: [rawCollege("Georgia Institute of Technology", "GA")] }) + "\n```", model: "m", tool_calls: [] }),
    });
    const { r } = setup(m);
    const out = await r.run({ profile: baseProfile(), wanted: ["Georgia Tech"], target_count: 1, onEvent: () => {} });
    expect(out[0]!.name).toBe("Georgia Institute of Technology");
  });

  it("reuses fresh cache entries (local cache and opts.cache) but not stale ones", async () => {
    const m = mockClient();
    const { r, cache } = setup(m);
    cache.put(fakeCollege("College A", "2026-10-01T00:00:00Z"), ["college a"]);
    cache.put(fakeCollege("College B", "2026-08-01T00:00:00Z")); // > 30 days → stale
    const events: ResearchEvent[] = [];
    const out = await r.run({
      profile: baseProfile(),
      wanted: names(3),
      target_count: 3,
      cache: [fakeCollege("College C", "2026-10-10T00:00:00Z")],
      onEvent: (e) => events.push(e),
    });
    expect(out.map((c) => c.name)).toEqual(["College A", "College B", "College C"]);
    const researched = m.calls.flatMap((c) => requested(c));
    expect(researched).toEqual(["College B"]);
    // Newly researched college is now cached under the typed name.
    expect(cache.get("college b")?.researched_at).toBe(NOW.toISOString());
  });

  it("aborts: rejects with AbortError and stops starting new calls", async () => {
    const m = mockClient({ delayMs: 20 });
    const { r } = setup(m);
    const ctrl = new AbortController();
    const p = r.run({ profile: baseProfile(), wanted: names(12), target_count: 12, concurrency: 2, signal: ctrl.signal, onEvent: () => {} });
    setTimeout(() => ctrl.abort(), 5);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((res) => setTimeout(res, 60));
    expect(m.stats().researchCalls).toBeLessThanOrEqual(2);
  });

  it("stops everything on a fatal error (usage limit) and emits an error event", async () => {
    const m = mockClient({ research: (_ns, n) => { if (n === 1) throw new AiError("usage_limit", "limit"); return researchResult(_ns); }, delayMs: 5 });
    const { r } = setup(m);
    const events: ResearchEvent[] = [];
    await expect(r.run({ profile: baseProfile(), wanted: names(12), target_count: 12, concurrency: 1, onEvent: (e) => events.push(e) })).rejects.toMatchObject({ code: "usage_limit" });
    expect(events).toContainEqual({ type: "error", error: "limit", code: "usage_limit" });
    expect(m.stats().researchCalls).toBe(1);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("continues with the student's own picks if the planner fails non-fatally", async () => {
    const m = mockClient({ planner: () => { throw new AiError("server", "planner down"); } });
    const { r } = setup(m);
    const out = await r.run({ profile: baseProfile(), wanted: ["Elon University"], onEvent: () => {} });
    expect(out.map((c) => c.name)).toEqual(["Elon University"]);
  });

  it("fails clearly when the planner fails and nothing was named", async () => {
    const m = mockClient({ planner: () => { throw new AiError("server", "planner down"); } });
    const { r } = setup(m);
    const events: ResearchEvent[] = [];
    await expect(r.run({ profile: baseProfile(), wanted: [], onEvent: (e) => events.push(e) })).rejects.toBeInstanceOf(AiError);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("drops planner duplicates of wanted colleges", async () => {
    const m = mockClient({ planned: ["Duke University", "Davidson College", "davidson college"] });
    const { r } = setup(m);
    const out = await r.run({ profile: baseProfile(), wanted: ["Duke"], target_count: 4, onEvent: () => {} });
    expect(out.map((c) => c.name)).toEqual(["Duke", "Davidson College"]);
  });
});

describe("research.researchOne", () => {
  it("researches one college with a retry and caches it", async () => {
    const m = mockClient({ research: (ns, n) => { if (n === 1) throw new AiError("server", "flaky"); return researchResult(ns); } });
    const { r, cache } = setup(m);
    const c = await r.researchOne("Clemson University", baseProfile());
    expect(c.name).toBe("Clemson University");
    expect(m.stats().researchCalls).toBe(2);
    expect(cache.get("Clemson University")).not.toBeNull();
  });

  it("rethrows fatal errors immediately", async () => {
    const m = mockClient({ research: () => { throw new AiError("reauth_required", "sign in"); } });
    const { r } = setup(m);
    await expect(r.researchOne("X", baseProfile())).rejects.toMatchObject({ code: "reauth_required" });
    expect(m.stats().researchCalls).toBe(1);
  });
});

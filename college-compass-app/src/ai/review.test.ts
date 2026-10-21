import { beforeEach, describe, expect, it } from "vitest";
import { AiError, type AiCallResult, type AiClient, type College, type ResearchEvent } from "../types";
import { createResearchCache } from "./cache";
import { parseResponsesText } from "./client";
import { normalizeCollege } from "./normalize";
import { RESEARCH_TOOL_NAME } from "./prompts";
import { createResearch } from "./research";
import { REVIEW_TOOL_NAME, applyReview, parseReview, resolveModel, reviewCollege, reviewerInput, type ParsedReview } from "./review";
import { baseProfile, installMemoryStorage, rawCollege, sseText } from "./test-helpers";

type CallOpts = Parameters<AiClient["call"]>[0];
const NOW = new Date("2026-10-16T12:00:00Z");
const ctx = { majors: ["robotics_mechatronics" as const, "computer_science" as const], cycle: "Fall 2027 entry", now: NOW };

function college(over: Record<string, unknown> = {}): College {
  return normalizeCollege(
    rawCollege("Test Tech", "GA", {
      admit_rate: 0.2,
      sat_25: 1300,
      sat_75: 1500,
      cost_of_attendance: 40000,
      cds: { cds_year: "2025-2026", offers_ed: true, offers_ea: true },
      application: { cycle: "Fall 2027 entry", plans: [{ plan: "ED", deadline: "2026-11-01" }, { plan: "EA", deadline: "2026-11-15" }, { plan: "RD", deadline: "2027-01-05" }], test_policy_note: null, essays_note: null, fee: null },
      programs: [{ major: "robotics_mechatronics", offered: true, degree: "B.S. Robotics", how_to_enter: "Direct admit", notes: "Great for this student who loves FIRST robotics" }],
      scholarships: [{ name: "Merit Award", amount: "$5k", note: "for GPA 3.9 students" }],
      data_notes: ["NOTE-SENTINEL from research"],
      ...over,
    }),
    { cycle: "Fall 2027 entry", now: NOW },
  )!;
}

const fix = (field: string, nv: string, more: Record<string, unknown> = {}) => ({
  field, plan: null, major: null, old: null, new: nv, source_url: "https://admissions.test.edu/facts", confidence: "high", reason: "Official page.", ...more,
});

beforeEach(() => {
  installMemoryStorage();
});

describe("reviewerInput", () => {
  it("sends only whitelisted college facts + cycle + majors (no profile, no free-text notes)", () => {
    const msg = reviewerInput(college(), ctx)[0]!.content;
    expect(msg).toContain("Review this research record for: Test Tech (GA)");
    expect(msg).toContain("Fall 2027 entry");
    expect(msg).toContain("robotics_mechatronics = robotics / mechatronics");
    expect(msg).toContain('"admit_rate": 0.2');
    expect(msg).toContain('"plan": "EA"');
    for (const leak of ["NOTE-SENTINEL", "FIRST robotics", "GPA 3.9", "Merit Award"]) expect(msg).not.toContain(leak);
  });
});

describe("parseReview", () => {
  it("drops malformed corrections and unknown fields", () => {
    const p = parseReview({
      corrections: [
        fix("admit_rate", "0.17"),
        fix("plan_deadline", "2026-11-01"), // no plan → dropped
        fix("program_degree", "B.S."), // no major → dropped
        fix("mascot", "Bee"),
        { field: "sat_25" }, // no new value
      ],
      verified: ["test_policy", "nope"],
      unverified: [{ field: "plan_deadline", reason: "not published" }, { field: "bogus", reason: "x" }],
    });
    expect(p.corrections.map((c) => c.field)).toEqual(["admit_rate"]);
    expect(p.verified).toEqual(["test_policy"]);
    expect(p.unverified).toEqual([{ field: "plan_deadline", reason: "not published" }]);
  });
});

describe("applyReview", () => {
  const apply = (corrections: unknown[], c = college(), extra: Partial<ParsedReview> = {}) =>
    applyReview(c, { ...parseReview({ corrections }), ...extra }, "Fall 2027 entry");

  it("applies sourced medium/high corrections, notes each change and cites the source", () => {
    const r = apply([
      fix("admit_rate", "0.171"),
      fix("plan_deadline", "2026-11-01", { plan: "EA", confidence: "medium" }),
      fix("test_policy", "required"),
      fix("program_how_to_enter", "First-year engineering, then competitive major placement", { major: "robotics_mechatronics" }),
    ]);
    expect(r.applied.map((a) => a.field)).toEqual(["admit_rate", "plan_deadline:EA", "test_policy", "program_how_to_enter:robotics_mechatronics"]);
    expect(r.college.admit_rate).toBe(0.171);
    expect(r.college.application!.plans.find((p) => p.plan === "EA")!.deadline).toBe("2026-11-01");
    expect(r.college.test_policy).toBe("required");
    expect(r.college.programs![0]!.how_to_enter).toMatch(/competitive/);
    expect(r.college.data_notes).toContain("Reviewer corrected the admit rate from 20% to 17.1% (source: admissions.test.edu/facts).");
    expect(r.college.data_notes).toContain("Reviewer corrected the EA deadline from 2026-11-15 to 2026-11-01 (source: admissions.test.edu/facts).");
    expect(r.college.sources.some((s) => s.url === "https://admissions.test.edu/facts")).toBe(true);
    // The input record is untouched.
    expect(college().admit_rate).toBe(0.2);
  });

  it("skips low confidence, missing/invalid source URLs, unparsable values and no-op changes", () => {
    const r = apply([
      fix("admit_rate", "0.15", { confidence: "low" }),
      fix("sat_25", "1310", { source_url: null }),
      fix("sat_75", "1490", { source_url: "javascript:alert(1)" }),
      fix("cost_of_attendance", "about forty grand"),
      fix("test_policy", "sometimes"),
      fix("plan_deadline", "mid November", { plan: "EA" }),
      fix("admit_rate", "null"),
      fix("sat_25", "1300"),
    ]);
    expect(r.applied).toEqual([]);
    expect(r.skipped.map((s) => s.why)).toEqual(["low confidence", "no source URL", "no source URL", "amount out of range", "unknown test policy", "deadline isn't a date", "not a rate", "already matches"]);
    expect(r.college.data_notes.some((n) => n.startsWith("Reviewer"))).toBe(false);
  });

  it("never erases a value without a replacement", () => {
    const p = parseReview({ corrections: [fix("admit_rate", ""), fix("program_degree", "  ", { major: "robotics_mechatronics" })] });
    expect(p.corrections).toEqual([]);
    const r = applyReview(college(), p, "Fall 2027 entry");
    expect(r.college.admit_rate).toBe(0.2);
    expect(r.college.programs![0]!.degree).toBe("B.S. Robotics");
  });

  it("requires high confidence for big jumps and for removing a plan", () => {
    const med = apply([
      fix("admit_rate", "0.5", { confidence: "medium" }),
      fix("cost_of_attendance", "90000", { confidence: "medium" }),
      fix("plan_offered", "false", { plan: "ED", confidence: "medium" }),
    ]);
    expect(med.applied).toEqual([]);
    expect(med.skipped.map((s) => s.why)).toEqual(["large change without high confidence", "large change without high confidence", "removal needs high confidence"]);

    const high = apply([fix("plan_offered", "false", { plan: "ED" }), fix("plan_deadline", "2027-01-01", { plan: "ED2" })]);
    expect(high.college.application!.plans.map((p) => p.plan)).toEqual(["EA", "RD", "ED2"]);
    expect(high.college.cds!.offers_ed).toBe(true); // ED2 still counts as early decision
    expect(high.college.data_notes).toContain("Reviewer removed the Early Decision plan: not offered for this cycle (source: admissions.test.edu/facts).");
    expect(high.college.data_notes).toContain("Reviewer added the ED2 deadline: 2027-01-01 (source: admissions.test.edu/facts).");
  });

  it("keeps SAT bounds ordered and fills empty values", () => {
    const r = apply([fix("sat_25", "1550"), fix("act_25", "31"), fix("act_75", "35")], college({ act_25: null, act_75: null }));
    expect(r.skipped[0]!.why).toBe("above the 75th percentile");
    expect([r.college.act_25, r.college.act_75]).toEqual([31, 35]);
    expect(r.college.data_notes).toContain("Reviewer added the ACT 25th percentile: 31 (source: admissions.test.edu/facts).");
  });

  it("notes what the reviewer couldn't verify", () => {
    const r = apply([], college(), { unverified: [{ field: "plan_deadline", reason: "x" }, { field: "sat_25", reason: "y" }, { field: "sat_75", reason: "y" }] });
    expect(r.college.data_notes.at(-1)).toBe("A second AI model couldn't verify: deadlines, SAT range.");
  });
});

describe("resolveModel", () => {
  const models = [{ slug: "luna-6", display_name: "Luna 6" }, { slug: "sol-6.1", display_name: "Sol 6.1" }];
  it("matches slugs and display names loosely, never invents", () => {
    expect(resolveModel("sol 6.1", models)).toBe("sol-6.1");
    expect(resolveModel("Luna 6", models)).toBe("luna-6");
    expect(resolveModel("luna-6", models)).toBe("luna-6");
    expect(resolveModel("sol 6", models)).toBeNull();
    expect(resolveModel("", models)).toBeNull();
  });
});

describe("reviewCollege", () => {
  it("forces the review tool with web search, resolves the model and reports usage", async () => {
    const calls: CallOpts[] = [];
    const client = {
      connection: () => ({ kind: "api_key" as const }),
      listModels: async () => [{ slug: "sol-6.1", display_name: "Sol 6.1" }],
      async call(o: CallOpts): Promise<AiCallResult> {
        calls.push(o);
        return { text: "", model: "sol-6.1", tool_calls: [{ name: REVIEW_TOOL_NAME, arguments: JSON.stringify({ corrections: [fix("admit_rate", "0.18")], verified: ["sat_25"], unverified: [] }) }], usage: { input_tokens: 900, output_tokens: 300, reasoning_tokens: 100, total_tokens: 1200, web_searches: 3 } };
      },
    };
    const out = await reviewCollege(college(), ctx, { client, model: "sol 6.1", effort: "medium" });
    expect(calls[0]!.model).toBe("sol-6.1");
    expect(calls[0]!.reasoning).toBe("medium");
    expect(calls[0]!.webSearch).toBe(true);
    expect(calls[0]!.tool_choice).toEqual({ type: "function", name: REVIEW_TOOL_NAME });
    expect(out.after.admit_rate).toBe(0.18);
    expect(out.before.admit_rate).toBe(0.2);
    expect(out.usage?.web_searches).toBe(3);
    expect(out.verified).toEqual(["sat_25"]);
  });

  it("rejects a reviewer model the account doesn't have (lists what is available)", async () => {
    const client = { connection: () => ({ kind: "api_key" as const }), listModels: async () => [{ slug: "gpt-x", display_name: "GPT X" }], call: async () => { throw new Error("no call expected"); } };
    await expect(reviewCollege(college(), ctx, { client, model: "sol 6.1" })).rejects.toThrow(/isn't available.*gpt-x/);
  });
});

describe("usage from the stream", () => {
  it("parses response.usage and counts web searches", () => {
    const data = sseText([
      { type: "response.completed", response: { model: "m", usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, output_tokens_details: { reasoning_tokens: 5 } }, output: [{ type: "web_search_call" }, { type: "web_search_call" }, { type: "message", content: [{ type: "output_text", text: "hi" }] }] } },
    ]);
    expect(parseResponsesText(data)!.usage).toEqual({ input_tokens: 10, output_tokens: 20, reasoning_tokens: 5, total_tokens: 30, web_searches: 2 });
    const none = sseText([{ type: "response.completed", response: { model: "m", output: [] } }]);
    expect(parseResponsesText(none)!.usage).toBeUndefined();
  });
});

// ───────────────────────────── research.run integration ─────────────────────────────

function requested(o: CallOpts): string[] {
  return [...o.input[0]!.content.matchAll(/^\d+\. (.+?)(?: \([A-Z]{2}\))?$/gm)].map((m) => m[1]!);
}

function mockClient(review: (o: CallOpts) => AiCallResult | Promise<AiCallResult>, delayMs = 5) {
  const calls: CallOpts[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const client: AiClient & { listModels(): Promise<{ slug: string; display_name: string }[]> } = {
    connection: () => ({ kind: "api_key" }),
    listModels: async () => [{ slug: "luna-6", display_name: "Luna 6" }, { slug: "sol-6.1", display_name: "Sol 6.1" }],
    async call(opts) {
      calls.push(opts);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((r) => setTimeout(r, delayMs));
        if (opts.tools?.[0]?.name === REVIEW_TOOL_NAME) return await review(opts);
        return { text: "", model: "luna-6", tool_calls: [{ name: RESEARCH_TOOL_NAME, arguments: JSON.stringify({ colleges: requested(opts).map((n) => rawCollege(n, "NC", { admit_rate: 0.4 })) }) }] };
      } finally {
        inFlight--;
      }
    },
  };
  return { client, calls, maxInFlight: () => maxInFlight };
}

const okReview = (): AiCallResult => ({ text: "", model: "sol-6.1", tool_calls: [{ name: REVIEW_TOOL_NAME, arguments: JSON.stringify({ corrections: [fix("admit_rate", "0.35")], verified: [], unverified: [] }) }] });
const names = (n: number) => Array.from({ length: n }, (_, i) => `College ${String.fromCharCode(65 + i)}`);

describe("research.run with review", () => {
  const profile = baseProfile({ sat: 1517, budget_per_year: 31337, interests_text: "zebrafish-sentinel" });
  const setup = (m: ReturnType<typeof mockClient>) => createResearch({ client: m.client, cache: createResearchCache({ key: "t_review" }), now: () => NOW, shared: null });

  it("is off by default: no reviewer calls", async () => {
    const m = mockClient(okReview);
    const out = await setup(m).run({ profile, wanted: names(2), target_count: 2, onEvent: () => {} });
    expect(m.calls.some((c) => c.tools?.[0]?.name === REVIEW_TOOL_NAME)).toBe(false);
    expect(out.every((c) => c.admit_rate === 0.4)).toBe(true);
  });

  it("reviews each college once with the configured model/effort, applies corrections, and never sends the profile", async () => {
    const m = mockClient(okReview);
    const events: ResearchEvent[] = [];
    const out = await setup(m).run({ profile, wanted: names(3), target_count: 3, review: { model: "sol 6.1", effort: "medium" }, onEvent: (e) => events.push(e) });
    const reviews = m.calls.filter((c) => c.tools?.[0]?.name === REVIEW_TOOL_NAME);
    expect(reviews).toHaveLength(3);
    for (const c of reviews) {
      expect(c.model).toBe("sol-6.1");
      expect(c.reasoning).toBe("medium");
      const text = c.instructions + c.input.map((x) => x.content).join("\n");
      for (const leak of ["Should Not Appear", "1517", "31337", "zebrafish-sentinel", "3.80", "Home state"]) expect(text).not.toContain(leak);
    }
    expect(out.map((c) => c.admit_rate)).toEqual([0.35, 0.35, 0.35]);
    expect(out[0]!.data_notes.some((n) => n.startsWith("Reviewer corrected the admit rate from 40% to 35%"))).toBe(true);
    const reviewed = events.filter((e): e is Extract<ResearchEvent, { type: "college_reviewed" }> => e.type === "college_reviewed");
    expect(reviewed).toHaveLength(3);
    expect(reviewed[0]!.review.before.admit_rate).toBe(0.4);
    expect(reviewed[0]!.review.applied).toHaveLength(1);
    // college_done follows the review, with the reviewed record.
    const types = events.map((e) => e.type);
    expect(types.indexOf("college_reviewed")).toBeLessThan(types.indexOf("college_done"));
    expect(types.filter((t) => t === "batch_done")).toHaveLength(3);
  });

  it("a failed review never fails the college (keeps the unreviewed record), even a usage limit", async () => {
    let n = 0;
    const m = mockClient(() => {
      n++;
      if (n === 1) throw new AiError("server", "reviewer down");
      if (n === 2) throw new AiError("usage_limit", "limit");
      return { text: "I think it's fine.", model: "sol-6.1", tool_calls: [] }; // unparsable
    });
    const events: ResearchEvent[] = [];
    const out = await setup(m).run({ profile, wanted: names(3), target_count: 3, concurrency: 1, review: { effort: "medium" }, onEvent: (e) => events.push(e) });
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.admit_rate === 0.4)).toBe(true);
    const errors = events.flatMap((e) => (e.type === "college_reviewed" ? [e.review.error] : []));
    expect(errors).toEqual(["reviewer down", "limit", "The reviewer didn't return structured results."]);
    expect(events.some((e) => e.type === "error" || e.type === "college_failed")).toBe(false);
  });

  it("an unavailable reviewer model is reported per college and research still completes", async () => {
    const m = mockClient(okReview);
    const events: ResearchEvent[] = [];
    const out = await setup(m).run({ profile, wanted: names(2), target_count: 2, review: { model: "nova 9" }, onEvent: (e) => events.push(e) });
    expect(out).toHaveLength(2);
    expect(m.calls.some((c) => c.tools?.[0]?.name === REVIEW_TOOL_NAME)).toBe(false);
    const e = events.find((x) => x.type === "college_reviewed") as Extract<ResearchEvent, { type: "college_reviewed" }>;
    expect(e.review.error).toMatch(/nova 9.*isn't available/);
  });

  it("reviews share the concurrency limit with research", async () => {
    const m = mockClient(okReview, 10);
    const out = await setup(m).run({ profile, wanted: names(6), target_count: 6, concurrency: 2, review: { effort: "medium" }, onEvent: () => {} });
    expect(out).toHaveLength(6);
    expect(m.calls).toHaveLength(12);
    expect(m.maxInFlight()).toBeLessThanOrEqual(2);
  });
});

import { describe, expect, it, vi } from "vitest";
import { contributionPayload, createSharedLookup, mergeShared, sharedResearchRecord, type SharedCollege } from "./shared";
import { fakeCollege } from "../ai/test-helpers";
import type { College } from "../types";

const withC = (name: string, over: Partial<College>): College => ({ ...fakeCollege(name, "2026-10-01T00:00:00Z"), ...over });

const ecu: SharedCollege = {
  unitid: "198464", name: "East Carolina University", city: "Greenville", state: "NC", lat: 35.6, lon: -77.4, locale: "city",
  url: "https://ecu.edu", undergrad_size: 22000, hbcu: false, women_only: false, religious: false,
  stats: {
    data_year: "College Scorecard", admit_rate: 0.88, sat_25: 1040, sat_75: 1190, act_25: 19, act_75: 23,
    tuition_in_state: 7239, tuition_out_of_state: 23516, cost_of_attendance: 23000, cost_of_attendance_basis: "in_state",
    avg_net_price: 14000, net_price_by_income: { "0_30k": 9000, "30_48k": 10500, "48_75k": 13000, "75_110k": 17000, "110k_plus": 19500 },
    grad_rate_6yr: 0.66, retention_rate: 0.83, median_earnings_10yr: 48000, program_share: { health: 0.2, nursing: 0.2 },
  },
  research: [],
  programs: [],
};

describe("mergeShared", () => {
  it("fills only what research left empty, cites Scorecard, and keeps researched values", () => {
    const researched = withC("East Carolina University", {
      admit_rate: 0.89, net_price_by_income: { "0_30k": null, "30_48k": null, "48_75k": null, "75_110k": null, "110k_plus": null },
      median_earnings_10yr: null, avg_net_price: null, data_notes: [], sources: [{ title: "CDS", url: "https://ecu.edu/cds" }],
    });
    const m = mergeShared(researched, ecu);
    expect(m.admit_rate).toBe(0.89); // researched wins
    expect(m.net_price_by_income["110k_plus"]).toBe(19500);
    expect(m.median_earnings_10yr).toBe(48000);
    expect(m.avg_net_price).toBe(14000);
    expect(m.sources.at(-1)!.url).toBe("https://collegescorecard.ed.gov/school/?198464");
    expect(m.data_notes.join(" ")).toMatch(/College Scorecard.*net price by family income/);
    expect(researched.net_price_by_income["110k_plus"]).toBeNull(); // input not mutated
  });

  it("flags a researched admit rate far from federal data", () => {
    const m = mergeShared(withC("Wake Forest University", { admit_rate: 0.51, data_notes: [] }), { ...ecu, stats: { ...ecu.stats!, admit_rate: 0.21 } });
    expect(m.admit_rate).toBe(0.51);
    expect(m.data_notes.join(" ")).toMatch(/differs from federal data \(21%/);
  });

  it("adds nothing when research already has everything", () => {
    const full = withC("East Carolina University", { data_notes: [], program_share: { biology: 0.1 } });
    const before = full.sources.length;
    const m = mergeShared({ ...full, url: "x", lat: 1, lon: 1, locale: "city", undergrad_size: 1 }, { ...ecu, stats: null });
    expect(m.sources.length).toBe(before);
  });
});

describe("createSharedLookup", () => {
  it("matches names via the RPC, then loads colleges with stats; keyed by the requested name", async () => {
    const calls: string[] = [];
    const doFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      expect((init?.headers as Record<string, string>).apikey).toBe("pk");
      if (String(url).endsWith("/rpc/match_colleges")) {
        expect(JSON.parse(String(init!.body))).toEqual({ names: ["ECU"], states: ["NC"] });
        return new Response(JSON.stringify([{ requested: "ECU", unitid: "198464", name: "East Carolina University", state: "NC", similarity: 1 }]));
      }
      return new Response(JSON.stringify([{ unitid: "198464", name: "East Carolina University", state: "NC", locale: "city", college_stats: [{ source: "scorecard", admit_rate: "0.88", net_price_by_income: { "110k_plus": 19500 } }] }]));
    });
    const l = createSharedLookup({ url: "https://x.supabase.co", key: "pk" }, doFetch as unknown as typeof fetch)!;
    const m = await l.lookup([{ name: "ECU", state: "NC" }]);
    expect(m.get("ECU")!.stats!.admit_rate).toBe(0.88);
    expect(calls[1]).toContain("unitid=in.(198464)");
  });

  it("never throws: network failure or timeout → empty map", async () => {
    const l = createSharedLookup({ url: "https://x", key: "k" }, (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)!;
    expect((await l.lookup([{ name: "A", state: null }])).size).toBe(0);
    const slow = createSharedLookup({ url: "https://x", key: "k" }, ((_u: unknown, init?: RequestInit) => new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("t", "AbortError"))))) as unknown as typeof fetch, 20)!;
    expect((await slow.lookup([{ name: "A", state: null }])).size).toBe(0);
  });
});

describe("shared research (the flywheel)", () => {
  const now = Date.parse("2026-10-20T00:00:00Z");
  const later = "2027-04-01T00:00:00Z";
  const withResearch: SharedCollege = {
    ...ecu,
    research: [{ cycle: "Fall 2027", data: { admit_rate: 0.89, test_policy: "optional", sources: [{ title: "CDS", url: "https://ecu.edu/cds" }] }, verified_count: 3, researched_at: "2026-10-01T00:00:00Z", stale_after: later }],
    programs: [{ major_area: "nursing", data: { major: "nursing", offered: true, degree: "BSN" }, verified_count: 2, stale_after: later }],
  };

  it("is a hit only when this cycle's research and every one of the student's majors are verified and fresh", () => {
    const hit = sharedResearchRecord(withResearch, "Fall 2027 entry", ["nursing", "undecided"], now)!;
    expect(hit.raw.admit_rate).toBe(0.89);
    expect(hit.raw.programs).toEqual([{ major: "nursing", offered: true, degree: "BSN" }]);
    expect(hit.verified).toBe(3);
    expect(sharedResearchRecord(withResearch, "Fall 2027", ["nursing", "biology"], now)).toBeNull(); // biology not researched yet
    expect(sharedResearchRecord(withResearch, "Fall 2028", ["nursing"], now)).toBeNull(); // other cycle
    expect(sharedResearchRecord(withResearch, "Fall 2027", ["nursing"], Date.parse("2027-05-01T00:00:00Z"))).toBeNull(); // stale
  });

  it("contributes college facts only — never notes, the profile, or program estimates", () => {
    const c = withC("East Carolina University", {
      data_notes: ["this NC student with a 3.8 GPA"], cds: { cds_year: "2025-26", notes: "for this student", ed_admit_rate: null },
      programs: [{ major: "nursing", offered: true, degree: "BSN", how_to_enter: "competitive", notes: null }],
    });
    const p = contributionPayload(c, "Fall 2027 entry", "11111111-1111-4111-8111-111111111111", "1.0.0");
    expect(p.cycle).toBe("Fall 2027");
    expect(JSON.stringify(p)).not.toMatch(/3\.8 GPA|for this student/);
    expect(Object.keys(p.college)).not.toEqual(expect.arrayContaining(["data_notes", "program_share", "id", "researched_at", "region"]));
    expect(p.programs).toEqual([{ major: "nursing", offered: true, degree: "BSN", how_to_enter: "competitive", notes: null }]);
  });

  it("keeps deadline proof-check results on the device: dropped on read, never contributed", () => {
    const page = "https://admissions.ecu.edu/deadlines";
    const check = { status: "verified", url: page, host: "admissions.ecu.edu", checkedAt: "2026-10-19T00:00:00.000Z" };
    const row: SharedCollege = {
      ...withResearch,
      research: [{ ...withResearch.research[0]!, data: { ...withResearch.research[0]!.data, application: { cycle: "Fall 2027 entry", plans: [{ plan: "EA", deadline: "2026-11-01", source_url: page, quote: "Early Action November 1", check }, { plan: "RD", deadline: "2027-01-15", check: { status: "verified" } }] } } }],
    };
    const hit = sharedResearchRecord(row, "Fall 2027 entry", ["nursing"], now)!;
    const plans = (hit.raw.application as { plans: Record<string, unknown>[] }).plans;
    expect(plans).toEqual([{ plan: "EA", deadline: "2026-11-01", source_url: page, quote: "Early Action November 1" }, { plan: "RD", deadline: "2027-01-15" }]);

    const c = withC("East Carolina University", {
      application: { cycle: "Fall 2027 entry", plans: [{ plan: "EA", deadline: "2026-11-01", source_url: page, quote: "Early Action November 1", check: { ...check, status: "verified" } }], test_policy_note: null, essays_note: null, fee: null },
    });
    const p = contributionPayload(c, "Fall 2027 entry", "11111111-1111-4111-8111-111111111111", "1.0.0");
    expect((p.college.application as { plans: Record<string, unknown>[] }).plans).toEqual([{ plan: "EA", deadline: "2026-11-01", source_url: page, quote: "Early Action November 1" }]);
    expect(JSON.stringify(p)).not.toContain("check");
    expect(c.application!.plans[0]!.check).toBeDefined(); // the local copy keeps its own result
  });

  it("contribute posts to the database function and never throws", async () => {
    const doFetch = vi.fn(async () => new Response("{}"));
    const l = createSharedLookup({ url: "https://x.supabase.co", key: "pk" }, doFetch as unknown as typeof fetch)!;
    await l.contribute!({ install_id: "i", app_version: "1", cycle: "Fall 2027", college: { name: "A" }, programs: [] });
    const [url, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/rest/v1/rpc/contribute_research");
    expect(JSON.parse(String(init.body)).payload.college.name).toBe("A");
    const bad = createSharedLookup({ url: "https://x", key: "k" }, (async () => { throw new Error("down"); }) as unknown as typeof fetch)!;
    await expect(bad.contribute!({ install_id: "i", app_version: "1", cycle: "Fall 2027", college: {}, programs: [] })).resolves.toBeUndefined();
  });
});

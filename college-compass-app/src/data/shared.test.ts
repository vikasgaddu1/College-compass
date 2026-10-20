import { describe, expect, it, vi } from "vitest";
import { createSharedLookup, mergeShared, type SharedCollege } from "./shared";
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

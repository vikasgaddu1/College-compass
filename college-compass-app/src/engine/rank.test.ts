import { describe, expect, it } from "vitest";
import { buildBalancedList, rankColleges, summarizeListForAi, TIER_ORDER } from "./rank";
import { baseProfile, blankCollege, duke, gaTech, ithaca, ncState, pitt } from "./test-fixtures";
import type { College, Region } from "../types";

const REGIONS: Region[] = ["new_england", "mid_atlantic", "south_atlantic", "midwest", "pacific"];
const STATES = ["MA", "PA", "NC", "OH", "CA"];

/** Deterministic synthetic pool spanning admit rates 4%–95%. */
function pool(n = 40): College[] {
  const out: College[] = [];
  for (let i = 0; i < n; i++) {
    const admit = 0.04 + (0.91 * i) / (n - 1);
    const mid = Math.round(1530 - admit * 500);
    const price = 12000 + ((i * 7919) % 45000);
    out.push(
      blankCollege({
        id: `c${i}`,
        name: `Test College ${String(i).padStart(2, "0")}`,
        short: `Test ${i}`,
        state: STATES[i % 5]!,
        region: REGIONS[i % 5]!,
        ownership: i % 3 === 0 ? "public" : "private_nonprofit",
        locale: (["city", "suburb", "town", "rural"] as const)[i % 4]!,
        undergrad_size: 2000 + i * 700,
        admit_rate: admit,
        sat_25: mid - 80,
        sat_75: mid + 80,
        test_policy: "optional",
        avg_net_price: price,
        net_price_by_income: { "0_30k": null, "30_48k": null, "48_75k": price, "75_110k": null, "110k_plus": null },
        grad_rate_6yr: 0.55 + (i % 9) * 0.04,
        median_earnings_10yr: 45000 + (i % 7) * 8000,
        program_share: { biology: 0.02 + (i % 5) * 0.03 },
        data_confidence: "medium",
        cds: { cds_year: "2025-26", avg_gpa: 3.3 + (1 - admit) * 0.6 },
      }),
    );
  }
  return out;
}

const profile = baseProfile({ majors: ["biology"], income_band: "48_75k", budget_per_year: 25000, home_state: "NC" });

describe("rankColleges", () => {
  it("is deterministic regardless of input order and sorts by fit then name", () => {
    const cs = pool();
    const a = rankColleges(cs, profile).map((r) => r.college.id);
    const b = rankColleges([...cs].reverse(), profile).map((r) => r.college.id);
    const shuffled = [...cs].sort((x, y) => ((Number(x.id.slice(1)) * 37) % 41) - ((Number(y.id.slice(1)) * 37) % 41));
    expect(b).toEqual(a);
    expect(rankColleges(shuffled, profile).map((r) => r.college.id)).toEqual(a);
    const ranked = rankColleges(cs, profile);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.fit.total).toBeGreaterThanOrEqual(ranked[i]!.fit.total);
    // Ties broken by name
    const twins = [blankCollege({ id: "2", name: "Beta College" }), blankCollege({ id: "1", name: "Alpha College" })];
    expect(rankColleges(twins, profile).map((r) => r.college.name)).toEqual(["Alpha College", "Beta College"]);
  });

  it("never drops wanted colleges and explains mismatches as watchouts", () => {
    const p = baseProfile({ wanted_colleges: ["Georgia Tech", "duke university"], regions: ["new_england"], budget_per_year: 15000, sat: null, act: null });
    const ranked = rankColleges([gaTech, duke, ncState, blankCollege()], p);
    expect(ranked.map((r) => r.college.id)).toEqual(expect.arrayContaining([gaTech.id, duke.id]));
    const gt = ranked.find((r) => r.college.id === gaTech.id)!;
    expect(gt.reasons[0]).toMatch(/your list/);
    expect(gt.watchouts).toContain("Test-required and you haven't listed a score");
    expect(gt.watchouts.length).toBeLessThanOrEqual(3);
    const dk = ranked.find((r) => r.college.id === duke.id)!;
    expect(dk.watchouts.some((w) => /Over your budget by about \$\d+k\/yr/.test(w) || /Very selective/.test(w))).toBe(true);
    for (const r of ranked) {
      expect(r.reasons.length).toBeGreaterThanOrEqual(2);
      expect(r.reasons.length).toBeLessThanOrEqual(4);
      expect(r.watchouts.length).toBeLessThanOrEqual(3);
    }
  });

  it("only claims programs the research found", () => {
    const r = rankColleges([pitt, ithaca], baseProfile({ majors: ["nursing"] }));
    const p = r.find((x) => x.college.id === pitt.id)!;
    expect(p.reasons.some((s) => s.includes("BSN"))).toBe(true);
    const i = r.find((x) => x.college.id === ithaca.id)!;
    expect(i.reasons.some((s) => /nursing/i.test(s))).toBe(false);
  });

  it("dedupes repeated research, keeping the newest", () => {
    const old = { ...ncState, researched_at: "2026-01-01T00:00:00Z", admit_rate: 0.5 };
    const r = rankColleges([old, ncState], profile);
    expect(r.length).toBe(1);
    expect(r[0]!.college.admit_rate).toBe(0.4);
  });
});

describe("buildBalancedList", () => {
  it("fills each tier with best-fit picks up to the spec", () => {
    const ranked = rankColleges(pool(60), profile);
    const list = buildBalancedList(ranked, undefined, profile);
    const spec = { high_reach: 2, reach: 4, target: 5, likely: 4, safety: 2 };
    for (const t of TIER_ORDER) {
      expect(list[t].length).toBe(spec[t]);
      // best-fit within the tier, unless borrowed
      const own = ranked.filter((r) => r.odds.tier === t);
      const picked = list[t].filter((r) => r.odds.tier === t).map((r) => r.college.id);
      expect(picked).toEqual(own.slice(0, picked.length).map((r) => r.college.id).filter((id) => picked.includes(id)));
    }
    const ids = TIER_ORDER.flatMap((t) => list[t].map((r) => r.college.id));
    expect(new Set(ids).size).toBe(ids.length);
    const affordableLikely = [...list.likely, ...list.safety].filter((r) => r.est_net_price != null && r.est_net_price <= 25000);
    expect(affordableLikely.length).toBeGreaterThanOrEqual(2);
  });

  it("borrows from neighbor tiers with a flag and reports gaps", () => {
    // Only selective schools → no safeties/likelies of their own
    const ranked = rankColleges(pool(40).slice(0, 12), profile);
    const list = buildBalancedList(ranked, { safety: 2, likely: 4 }, 25000);
    expect(list.safety.length + list.likely.length).toBeLessThan(6);
    expect(list.gaps.length).toBeGreaterThan(0);
    for (const b of list.borrowed) expect(b.from).not.toBe(b.to);
    // Small spec forces borrowing from target into likely when likely is short
    const mixed = rankColleges(pool(40), profile);
    const tight = buildBalancedList(mixed, { high_reach: 1, reach: 1, target: 1, likely: 30, safety: 1 });
    expect(tight.borrowed.some((b) => b.to === "likely")).toBe(true);
  });

  it("notes when no affordable likely/safety exists", () => {
    const pricey = pool(40).map((c) => ({ ...c, avg_net_price: 60000, net_price_by_income: { ...c.net_price_by_income, "48_75k": 60000 } }));
    const list = buildBalancedList(rankColleges(pricey, profile), undefined, 25000);
    expect(list.gaps.some((g) => /budget/.test(g))).toBe(true);
  });
});

describe("summarizeListForAi", () => {
  it("stays under 1,500 chars and is deterministic", () => {
    const ranked = rankColleges(pool(60), profile);
    const s = summarizeListForAi(ranked);
    expect(s.length).toBeLessThanOrEqual(1500);
    expect(s).toMatch(/more/);
    expect(summarizeListForAi([...ranked].reverse())).toBe(s);
    const small = summarizeListForAi(rankColleges([ncState, duke, pitt, ithaca, gaTech], profile));
    expect(small).toContain("NC State");
    expect(small.split("\n").length).toBe(6);
  });
});

describe("robustness", () => {
  it("survives partial / garbage AI output and sparse profiles without NaN", () => {
    const weird = [
      { ...blankCollege({ id: "w1", name: "Weird One" }), program_share: undefined, programs: [null], application: { plans: null }, cds: null },
      blankCollege({ id: "w2", name: "Weird Two", admit_rate: 45 as number, grad_rate_6yr: 2, avg_net_price: -5, undergrad_size: Number.NaN }),
      { ...ncState, net_price_by_income: null, sources: undefined },
    ] as unknown as College[];
    const sparse = { ...baseProfile(), majors: undefined, priorities: undefined, regions: undefined, wanted_colleges: undefined, rigor: "??" } as unknown as Parameters<typeof rankColleges>[1];
    for (const p of [sparse, baseProfile()]) {
      const r = rankColleges(weird, p);
      expect(r.length).toBe(3);
      for (const x of r) {
        for (const v of [x.odds.p, x.odds.low, x.odds.high, x.fit.total, x.fit.academics, x.fit.location]) expect(Number.isFinite(v)).toBe(true);
        expect(x.reasons.length).toBeGreaterThanOrEqual(2);
      }
      expect(r.find((x) => x.college.id === "w2")!.odds.factors[0]!.label).toMatch(/45%/);
      buildBalancedList(r, undefined, p);
      expect(summarizeListForAi(r).length).toBeGreaterThan(0);
    }
  });
});

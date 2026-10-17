import { describe, expect, it } from "vitest";
import { estimateOdds, tierFromP } from "./odds";
import { baseProfile, blankCollege, duke, gaTech, ithaca, ncState, pitt } from "./test-fixtures";
import type { OddsResult } from "../types";

function finite(o: OddsResult) {
  for (const v of [o.p, o.low, o.high]) {
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0.01);
    expect(v).toBeLessThanOrEqual(0.95);
  }
  expect(o.low).toBeLessThanOrEqual(o.p);
  expect(o.p).toBeLessThanOrEqual(o.high);
  for (const f of o.factors) expect(Number.isFinite(f.logit_delta)).toBe(true);
}

describe("estimateOdds", () => {
  it("is monotonic in SAT", () => {
    for (const c of [ncState, gaTech, pitt, duke]) {
      let prev = -1;
      for (let sat = 900; sat <= 1600; sat += 20) {
        const o = estimateOdds(c, baseProfile({ sat }));
        finite(o);
        expect(o.p).toBeGreaterThanOrEqual(prev);
        prev = o.p;
      }
    }
  });

  it("is monotonic in unweighted GPA (and weighted GPA where the school reports weighted)", () => {
    for (const c of [ncState, gaTech, pitt, ithaca]) {
      let prev = -1;
      for (let g = 2.0; g <= 4.0001; g += 0.05) {
        const o = estimateOdds(c, baseProfile({ gpa_unweighted: g, gpa_weighted: null }));
        expect(o.p).toBeGreaterThanOrEqual(prev);
        prev = o.p;
      }
    }
    let prev = -1;
    for (let w = 3.0; w <= 5.0; w += 0.1) {
      const o = estimateOdds(ncState, baseProfile({ gpa_weighted: w }));
      expect(o.p).toBeGreaterThanOrEqual(prev);
      prev = o.p;
    }
  });

  it("caps schools under 15% admit at 2.5× admit rate and calls them high reach", () => {
    const star = baseProfile({ sat: 1600, gpa_unweighted: 4.0, gpa_weighted: 4.8, rigor: "most", activities_strength: "national", plan: "ed_ok", first_gen: true });
    const o = estimateOdds(duke, star);
    expect(o.p).toBeLessThanOrEqual(0.15 + 1e-9);
    expect(o.high).toBeLessThanOrEqual(0.15 + 1e-9);
    expect(o.tier).toBe("high_reach");
    const weak = estimateOdds(duke, baseProfile({ sat: 1100, gpa_unweighted: 3.2 }));
    expect(weak.tier).toBe("high_reach");
    expect(weak.p).toBeLessThan(o.p);
  });

  it("applies ED only when the school offers it AND the student is willing", () => {
    const willing = estimateOdds(duke, baseProfile({ plan: "ed_ok", sat: 1500 }));
    const notWilling = estimateOdds(duke, baseProfile({ plan: "ea_only", sat: 1500 }));
    expect(willing.factors.some((f) => f.label.includes("Early Decision"))).toBe(true);
    expect(notWilling.factors.some((f) => f.label.includes("Early Decision"))).toBe(false);
    const edDelta = willing.factors.find((f) => f.label.includes("Early Decision"))!.logit_delta;
    expect(edDelta).toBeGreaterThan(0);
    expect(edDelta).toBeLessThanOrEqual(1.0);
    expect(willing.caveats.join(" ")).toMatch(/binding/i);

    // Willing, but the school has no ED
    const noEd = estimateOdds(ncState, baseProfile({ plan: "ed_ok" }));
    expect(noEd.factors.some((f) => f.label.includes("Early Decision"))).toBe(false);

    // ED found only in application.plans (no cds flag): still counts, default boost
    const planOnly = blankCollege({ ...pitt, cds: undefined, application: { cycle: "Fall 2027", plans: [{ plan: "ED2", deadline: "Jan 1" }], test_policy_note: null, essays_note: null, fee: null } });
    const a = estimateOdds(planOnly, baseProfile({ plan: "ed_ok" }));
    const b = estimateOdds(planOnly, baseProfile({ plan: "rd_only" }));
    expect(a.p).toBeGreaterThan(b.p);
  });

  it("favors in-state applicants at public schools", () => {
    const inState = estimateOdds(ncState, baseProfile({ home_state: "NC" }));
    const outState = estimateOdds(ncState, baseProfile({ home_state: "VA" }));
    expect(inState.p).toBeGreaterThan(outState.p);
    // Without researched residency rates: ±0.35 default
    const noRates = { ...pitt, cds: undefined };
    const i2 = estimateOdds(noRates, baseProfile({ home_state: "PA", majors: ["biology"] }));
    const o2 = estimateOdds(noRates, baseProfile({ home_state: "NC", majors: ["biology"] }));
    expect(i2.factors.find((f) => f.label.startsWith("You're in-state"))!.logit_delta).toBe(0.35);
    expect(o2.factors.find((f) => f.label.startsWith("You're out-of-state"))!.logit_delta).toBe(-0.35);
    // Private schools: no residency factor
    const d = estimateOdds(duke, baseProfile());
    expect(d.factors.some((f) => /in-state|out-of-state/.test(f.label))).toBe(false);
  });

  it("gives a finite, low-confidence answer for an all-null college", () => {
    const o = estimateOdds(blankCollege(), baseProfile());
    finite(o);
    expect(o.confidence).toBe("low");
    expect(o.caveats.length).toBeGreaterThan(0);
    const empty = estimateOdds(blankCollege(), baseProfile({ sat: null, act: null, gpa_unweighted: null, gpa_weighted: null, majors: [] }));
    finite(empty);
    // Garbage values from the model still can't produce NaN
    const junk = blankCollege({ admit_rate: Number.NaN, sat_25: Number.POSITIVE_INFINITY, sat_75: 1200, cds: { cds_year: "", avg_gpa: Number.NaN } });
    finite(estimateOdds(junk, baseProfile()));
  });

  it("handles test policy: required+no score penalized, optional+no score neutral but less confident", () => {
    const noScore = baseProfile({ sat: null, act: null });
    const req = estimateOdds(gaTech, noScore);
    expect(req.factors.some((f) => f.logit_delta <= -1.5)).toBe(true);
    expect(req.caveats.join(" ")).toMatch(/Test-required/);

    const withScore = estimateOdds(ncState, baseProfile({ sat: 1355 })); // ~median
    const without = estimateOdds(ncState, noScore);
    expect(Math.abs(withScore.p - without.p)).toBeLessThan(0.05);
    const rank = { low: 0, medium: 1, high: 2 } as const;
    expect(rank[without.confidence]).toBeLessThan(rank[withScore.confidence]);
    expect(without.high - without.low).toBeGreaterThan(withScore.high - withScore.low);
  });

  it("penalizes gated majors and gives first-gen a bump only at selective schools", () => {
    const eng = estimateOdds(ncState, baseProfile({ majors: ["engineering"] }));
    const bio = estimateOdds(ncState, baseProfile({ majors: ["biology"] }));
    expect(eng.p).toBeLessThan(bio.p);
    const nursing = estimateOdds(pitt, baseProfile({ majors: ["nursing"] }));
    expect(nursing.factors.some((f) => f.label.includes("limited-entry"))).toBe(true);

    const fgSel = estimateOdds(gaTech, baseProfile({ first_gen: true }));
    const nfgSel = estimateOdds(gaTech, baseProfile({ first_gen: false }));
    expect(fgSel.p).toBeGreaterThan(nfgSel.p);
    const fgOpen = estimateOdds(ithaca, baseProfile({ first_gen: true }));
    const nfgOpen = estimateOdds(ithaca, baseProfile({ first_gen: false }));
    expect(fgOpen.p).toBe(nfgOpen.p);
  });

  it("flags audition-based programs for performing arts", () => {
    const o = estimateOdds(ithaca, baseProfile({ majors: ["performing_arts"] }));
    expect(o.caveats.join(" ")).toMatch(/audition/i);
    expect(o.tier === "likely" || o.tier === "safety" || o.tier === "target").toBe(true);
  });

  it("maps p to SPEC tiers", () => {
    expect(tierFromP(0.9)).toBe("safety");
    expect(tierFromP(0.85)).toBe("safety");
    expect(tierFromP(0.7)).toBe("likely");
    expect(tierFromP(0.5)).toBe("target");
    expect(tierFromP(0.2)).toBe("reach");
    expect(tierFromP(0.1)).toBe("high_reach");
  });
});

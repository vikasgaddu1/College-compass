import { describe, expect, it } from "vitest";
import { academicsScore, majorScore, scoreFit, MAJOR_TO_SHARE_KEYS, locationScore } from "./fit";
import { estimateOdds } from "./odds";
import { estimateNetPrice } from "./price";
import { baseProfile, blankCollege, duke, gaTech, ithaca, ncState, pitt } from "./test-fixtures";
import type { College, MajorArea, StudentProfile } from "../types";

function fit(c: College, p: StudentProfile) {
  return scoreFit(c, p, estimateOdds(c, p), estimateNetPrice(c, p).value);
}

describe("scoreFit", () => {
  it("handles an all-null college with neutral, finite components", () => {
    const f = fit(blankCollege(), baseProfile());
    for (const v of Object.values(f)) expect(Number.isFinite(v)).toBe(true);
    expect(f.total).toBeGreaterThanOrEqual(0);
    expect(f.total).toBeLessThanOrEqual(100);
    expect(f.outcomes).toBe(0.5);
    expect(f.affordability).toBe(0.5);
    expect(f.academics).toBe(0.5);
  });

  it("maps every MajorArea except undecided to share keys", () => {
    const all: MajorArea[] = Object.keys(MAJOR_TO_SHARE_KEYS) as MajorArea[];
    expect(all.length).toBe(27);
  });

  it("scores non-STEM majors: nursing and performing arts", () => {
    const nursing = baseProfile({ majors: ["nursing"] });
    expect(majorScore(pitt, "nursing")).toBeGreaterThan(0.9); // program offered with BSN
    expect(academicsScore(pitt, nursing)).toBeGreaterThan(academicsScore(gaTech, nursing));
    const arts = baseProfile({ majors: ["performing_arts", "film_media"] });
    expect(academicsScore(ithaca, arts)).toBeGreaterThan(academicsScore(gaTech, arts));
    expect(fit(ithaca, arts).total).toBeGreaterThan(fit(gaTech, arts).total);
    // A program explicitly not offered scores low
    const noProgram = { ...ithaca, programs: [{ major: "nursing" as const, offered: false, degree: null, how_to_enter: null, notes: null }] };
    expect(majorScore(noProgram, "nursing")).toBeLessThan(0.2);
  });

  it("gives undecided students a base score plus a breadth bonus", () => {
    const u = baseProfile({ majors: ["undecided"] });
    expect(academicsScore(blankCollege(), u)).toBeCloseTo(0.6);
    expect(academicsScore(ithaca, u)).toBeGreaterThan(0.6);
    expect(academicsScore(ithaca, baseProfile({ majors: [] }))).toBe(academicsScore(ithaca, u));
  });

  it("uses equal weights when all priorities are zero", () => {
    const p = baseProfile({ priorities: { academics_fit: 0, affordability: 0, outcomes: 0, odds: 0, location: 0 } });
    const f = fit(ncState, p);
    const avg = (f.academics + f.affordability + f.outcomes + f.location + f.odds) / 5;
    expect(f.total).toBeCloseTo(avg * 100, 0);
  });

  it("rewards affordability vs budget and penalizes over-budget", () => {
    const p = baseProfile({ budget_per_year: 20000, income_band: "75_110k" });
    expect(fit(ncState, p).affordability).toBeGreaterThan(fit(duke, baseProfile({ budget_per_year: 20000, income_band: "110k_plus" })).affordability);
  });

  it("scores location preferences including distance from home", () => {
    const near = baseProfile({ max_distance_miles: 300, home_state: "NC" });
    expect(locationScore(ncState, near)).toBe(1);
    expect(locationScore(pitt, near)).toBeLessThan(1); // ~350+ mi from NC center
    const prefs = baseProfile({ regions: ["mid_atlantic"], size: "small", setting: "town", ownership: "private_nonprofit" });
    expect(locationScore(ithaca, prefs)).toBe(1);
    expect(locationScore(gaTech, prefs)).toBeLessThan(0.4);
    expect(locationScore(blankCollege(), baseProfile())).toBe(0.75);
  });
});

import { describe, expect, it } from "vitest";
import { actToSat, bestSat, schoolSatRange } from "./concordance";

describe("ACT → SAT concordance (2018 table)", () => {
  it("matches published spot values", () => {
    expect(actToSat(36)).toBe(1590);
    expect(actToSat(35)).toBe(1540);
    expect(actToSat(33)).toBe(1460);
    expect(actToSat(30)).toBe(1370);
    expect(actToSat(27)).toBe(1280);
    expect(actToSat(24)).toBe(1180);
    expect(actToSat(20)).toBe(1040);
    expect(actToSat(15)).toBe(850);
    expect(actToSat(9)).toBe(590);
  });

  it("covers 1–36, is non-decreasing, and rejects junk", () => {
    let prev = 0;
    for (let a = 1; a <= 36; a++) {
      const s = actToSat(a)!;
      expect(s).toBeGreaterThanOrEqual(400);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    expect(actToSat(0)).toBeNull();
    expect(actToSat(37)).toBeNull();
    expect(actToSat(null)).toBeNull();
    expect(actToSat(Number.NaN)).toBeNull();
    expect(actToSat(29.6)).toBe(1370);
  });

  it("bestSat takes the higher of SAT and concorded ACT", () => {
    expect(bestSat({ sat: 1400, act: 34 })).toBe(1500);
    expect(bestSat({ sat: 1520, act: 30 })).toBe(1520);
    expect(bestSat({ sat: null, act: 28 })).toBe(1310);
    expect(bestSat({ sat: 1300, act: null })).toBe(1300);
    expect(bestSat({ sat: null, act: null })).toBeNull();
    expect(bestSat({ sat: 2100, act: null })).toBeNull(); // old 2400-scale score
  });

  it("schoolSatRange falls back to the ACT range", () => {
    expect(schoolSatRange({ sat_25: 1300, sat_75: 1480, act_25: 30, act_75: 34 })).toEqual({ p25: 1300, p75: 1480, fromAct: false });
    expect(schoolSatRange({ sat_25: null, sat_75: null, act_25: 30, act_75: 34 })).toEqual({ p25: 1370, p75: 1500, fromAct: true });
    expect(schoolSatRange({ sat_25: null, sat_75: 1400, act_25: null, act_75: null })).toBeNull();
  });
});

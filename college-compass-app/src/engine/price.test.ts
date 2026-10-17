import { describe, expect, it } from "vitest";
import { estimateNetPrice } from "./price";
import { baseProfile, blankCollege, duke, ncState } from "./test-fixtures";

describe("estimateNetPrice", () => {
  it("uses the student's income band", () => {
    expect(estimateNetPrice(duke, baseProfile({ income_band: "48_75k" })).value).toBe(8000);
    expect(estimateNetPrice(ncState, baseProfile({ income_band: "75_110k", home_state: "NC" }))).toMatchObject({ value: 19000 });
  });

  it("adds the out-of-state tuition difference at publics", () => {
    const r = estimateNetPrice(ncState, baseProfile({ income_band: "75_110k", home_state: "VA" }));
    expect(r.value).toBe(19000 + (31900 - 9100));
    expect(r.note).toMatch(/out-of-state/);
    // Not at privates
    expect(estimateNetPrice(duke, baseProfile({ income_band: "75_110k", home_state: "VA" })).value).toBe(18000);
  });

  it("falls back: prefer_not → average; missing band → average; then sticker price; else null", () => {
    expect(estimateNetPrice(duke, baseProfile({ income_band: "prefer_not" })).value).toBe(28000);
    const noBand = { ...duke, net_price_by_income: { ...duke.net_price_by_income, "0_30k": null } };
    expect(estimateNetPrice(noBand, baseProfile({ income_band: "0_30k" })).value).toBe(28000);
    const sticker = blankCollege({ cost_of_attendance: 61000 });
    const s = estimateNetPrice(sticker, baseProfile());
    expect(s.value).toBe(61000);
    expect(s.note).toMatch(/sticker/i);
    const none = estimateNetPrice(blankCollege(), baseProfile());
    expect(none.value).toBeNull();
    expect(none.note.length).toBeGreaterThan(0);
    // missing net_price_by_income object entirely (bad AI output)
    const broken = blankCollege({ avg_net_price: 20000 });
    (broken as unknown as { net_price_by_income: undefined }).net_price_by_income = undefined;
    expect(estimateNetPrice(broken, baseProfile()).value).toBe(20000);
  });
});

describe("in-state student, published out-of-state budget (real-run regression)", () => {
  // East Carolina University as researched live: COA is the nonresident budget.
  const ecu = blankCollege({ name: "East Carolina University", state: "NC", ownership: "public", cost_of_attendance: 42850, tuition_in_state: 7789, tuition_out_of_state: 24555 });

  it("takes the tuition difference back off for an NC resident", () => {
    const r = estimateNetPrice(ecu, baseProfile({ home_state: "NC" }));
    expect(r.value).toBe(26100);
    expect(r.note).toMatch(/in-state estimate/);
  });

  it("leaves the out-of-state student at the published budget", () => {
    const r = estimateNetPrice(ecu, baseProfile({ home_state: "VA" }));
    expect(r.value).toBe(42900);
  });

  it("flags it when in-state tuition is unknown", () => {
    const unc = blankCollege({ state: "NC", ownership: "public", cost_of_attendance: 70264, tuition_in_state: null, tuition_out_of_state: 49602 });
    const r = estimateNetPrice(unc, baseProfile({ home_state: "NC" }));
    expect(r.value).toBe(70300);
    expect(r.note).toMatch(/looks out-of-state/);
  });

  it("does not touch a COA that already looks in-state", () => {
    const c = blankCollege({ state: "NC", ownership: "public", cost_of_attendance: 26000, tuition_in_state: 7789, tuition_out_of_state: 24555 });
    expect(estimateNetPrice(c, baseProfile({ home_state: "NC" })).value).toBe(26000);
  });
});

describe("explicit cost_of_attendance_basis (no threshold guessing)", () => {
  // Out-of-state budget with low living costs: below the $12k fallback margin.
  const cheap = { state: "NC", ownership: "public" as const, cost_of_attendance: 30000, tuition_in_state: 8000, tuition_out_of_state: 22000 };

  it("in-state student: removes the tuition difference when the basis says out_of_state", () => {
    const c = blankCollege({ ...cheap, cost_of_attendance_basis: "out_of_state" });
    expect(estimateNetPrice(c, baseProfile({ home_state: "NC" })).value).toBe(16000);
  });

  it("out-of-state student: does not add the difference twice when the basis says out_of_state", () => {
    const c = blankCollege({ ...cheap, cost_of_attendance_basis: "out_of_state" });
    expect(estimateNetPrice(c, baseProfile({ home_state: "VA" })).value).toBe(30000);
  });

  it("in_state basis: in-state student pays it as is, out-of-state adds the difference", () => {
    const c = blankCollege({ ...cheap, cost_of_attendance_basis: "in_state" });
    expect(estimateNetPrice(c, baseProfile({ home_state: "NC" })).value).toBe(30000);
    expect(estimateNetPrice(c, baseProfile({ home_state: "VA" })).value).toBe(44000);
  });
});

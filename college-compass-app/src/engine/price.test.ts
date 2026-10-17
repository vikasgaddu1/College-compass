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

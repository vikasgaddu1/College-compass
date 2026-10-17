import { describe, expect, it } from "vitest";
import { EXPECTED_RUN_MS, describeRemaining, formatElapsed } from "./ResearchStatus";

describe("formatElapsed", () => {
  it("formats m:ss and never goes negative", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9_999)).toBe("0:09");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(10 * 60_000 + 30_000)).toBe("10:30");
    expect(formatElapsed(-5_000)).toBe("0:00");
  });
});

describe("describeRemaining", () => {
  it("counts down from the ~4 minute expectation", () => {
    expect(describeRemaining(0)).toBe("about 4 min left");
    expect(describeRemaining(60_000)).toBe("about 3 min left");
    expect(describeRemaining(EXPECTED_RUN_MS - 70_000)).toBe("about 1 min left");
  });
  it("switches to 'less than a minute', then 'almost done' — never negative", () => {
    expect(describeRemaining(EXPECTED_RUN_MS - 30_000)).toBe("less than a minute left");
    expect(describeRemaining(EXPECTED_RUN_MS)).toBe("almost done…");
    expect(describeRemaining(EXPECTED_RUN_MS + 5 * 60_000)).toBe("almost done…");
  });
});

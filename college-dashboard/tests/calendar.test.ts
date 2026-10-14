import test from "node:test";
import assert from "node:assert/strict";
import { todayIso, daysUntil, dateUTC, parseCycleDates } from "../client/src/lib/calendar";

test("application dates use New York's calendar day near UTC midnight", () => {
  assert.equal(todayIso(new Date("2026-10-15T01:00:00Z")), "2026-10-14");
  assert.equal(todayIso(new Date("2026-10-15T05:00:00Z")), "2026-10-15");
});

test("past deadline differences stay negative rather than plotting after the start", () => {
  assert.equal(daysUntil("2026-10-07", "2026-10-14"), -7);
  assert.equal(daysUntil("2026-10-14", "2026-10-14"), 0);
  assert.equal(daysUntil("2026-11-01", "2026-10-14"), 18);
});

test("calendar differences cross daylight saving without fractional days", () => {
  assert.equal(daysUntil("2026-11-02", "2026-11-01"), 1);
  assert.equal(dateUTC("2026-11-01").toISOString(), "2026-11-01T00:00:00.000Z");
});

test("a multiround label keeps both WPI early-action dates", () => {
  assert.deepEqual(parseCycleDates("November 1, 2026 / January 5, 2027"), ["2026-11-01", "2027-01-05"]);
});

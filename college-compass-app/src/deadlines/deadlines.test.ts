import { describe, expect, it } from "vitest";
import type { College } from "@/types";
import { DEMO_COLLEGES } from "@/state/fixtures";
import {
  REMINDER_CAP,
  REMINDER_PREFIX,
  buildReminders,
  daysUntil,
  formatDay,
  formatRelative,
  groupByDate,
  hiddenPlansNote,
  mergeDeadlines,
  nextDeadlineSummary,
  parseDeadline,
  planFits,
  reminderId,
  reminderText,
  shiftDay,
  upcomingDeadlines,
  type Deadline,
} from "./deadlines";

// Oct 21, 2026, 14:30 local — the day the feature shipped.
const NOW = new Date(2026, 9, 21, 14, 30);

const mit = DEMO_COLLEGES.find((c) => c.short.includes("MIT"))!;
const duke = DEMO_COLLEGES.find((c) => c.name.includes("Duke"))!;
const gt = DEMO_COLLEGES.find((c) => c.name.includes("Georgia"))!;
const nyu = DEMO_COLLEGES.find((c) => c.name.includes("New York University"))!;

function college(id: string, name: string, plans: College["application"] extends infer A ? (A extends { plans: infer P } ? P : never) : never): College {
  return { ...mit, id, name, short: name, application: { cycle: "Fall 2027 entry", plans, test_policy_note: null, essays_note: null, fee: null } };
}

describe("parseDeadline", () => {
  it("accepts the formats research and the normalizer store", () => {
    expect(parseDeadline("2026-11-01", NOW)).toBe("2026-11-01");
    expect(parseDeadline("2026-11-1", NOW)).toBe("2026-11-01");
    expect(parseDeadline("2026-11-01T23:59:00Z", NOW)).toBe("2026-11-01");
    expect(parseDeadline("11/1/2026", NOW)).toBe("2026-11-01");
    expect(parseDeadline("1/15/27", NOW)).toBe("2027-01-15");
    expect(parseDeadline("Nov 1, 2026", NOW)).toBe("2026-11-01");
    expect(parseDeadline("Nov. 1 2026", NOW)).toBe("2026-11-01");
    expect(parseDeadline("November 1st, 2026", NOW)).toBe("2026-11-01");
    expect(parseDeadline("Sept 15, 2026", NOW)).toBe("2026-09-15");
    expect(parseDeadline("1 November 2026", NOW)).toBe("2026-11-01");
    expect(parseDeadline("  Jan 2, 2027  ", NOW)).toBe("2027-01-02");
  });

  it("resolves a missing year to the next occurrence, counting today", () => {
    expect(parseDeadline("Nov 1", NOW)).toBe("2026-11-01");
    expect(parseDeadline("Oct 21", NOW)).toBe("2026-10-21"); // today stays this year
    expect(parseDeadline("Oct 15", NOW)).toBe("2027-10-15"); // already passed → next year
    expect(parseDeadline("Jan 5", NOW)).toBe("2027-01-05");
  });

  it("rejects vague, empty and impossible values", () => {
    for (const v of [null, undefined, "", "   ", "Early November", "TBD", "rolling", "see website", "Mayo 5, 2026", "2026-13-01", "Feb 30, 2027", "Nov 1, 1999", "Nov 1, 2035", "11/01", "Nov"]) {
      expect(parseDeadline(v as string | null, NOW), String(v)).toBeNull();
    }
  });
});

describe("day arithmetic", () => {
  it("counts whole days and shifts across month and year ends", () => {
    expect(daysUntil("2026-11-01", NOW)).toBe(11);
    expect(daysUntil("2026-10-21", NOW)).toBe(0);
    expect(daysUntil("2026-10-20", NOW)).toBe(-1);
    expect(shiftDay("2026-11-01", -7)).toBe("2026-10-25");
    expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftDay("2026-11-01", -1)).toBe("2026-10-31"); // across the US DST change
  });

  it("formats days and relative distances plainly", () => {
    expect(formatDay("2026-11-01", NOW)).toBe("Nov 1");
    expect(formatDay("2027-01-05", NOW)).toBe("Jan 5, 2027");
    expect(formatRelative(0)).toBe("today");
    expect(formatRelative(1)).toBe("tomorrow");
    expect(formatRelative(11)).toBe("in 11 days");
    expect(formatRelative(21)).toBe("in 3 weeks");
    expect(formatRelative(76)).toBe("in 3 months");
  });
});

describe("planFits", () => {
  it("hides binding plans for EA-only students and all early plans for RD-only students", () => {
    expect(planFits("ED", "ed_ok")).toBe(true);
    expect(planFits("ED", "ea_only")).toBe(false);
    expect(planFits("ED2", "ea_only")).toBe(false);
    expect(planFits("EA", "ea_only")).toBe(true);
    expect(planFits("REA", "ea_only")).toBe(true);
    expect(planFits("EA", "rd_only")).toBe(false);
    expect(planFits("REA", "rd_only")).toBe(false);
    expect(planFits("RD", "rd_only")).toBe(true);
    expect(planFits("Priority", "rd_only")).toBe(true);
    expect(planFits("Rolling", "rd_only")).toBe(true);
  });

  it("explains what is hidden", () => {
    expect(hiddenPlansNote("ea_only", 0)).toBeNull();
    expect(hiddenPlansNote("ea_only", 1)).toMatch(/^1 deadline for Early Decision hidden/);
    expect(hiddenPlansNote("rd_only", 3)).toMatch(/^3 deadlines for early plans hidden/);
    expect(hiddenPlansNote("ed_ok", 3)).toBeNull();
  });
});

describe("upcomingDeadlines", () => {
  it("keeps today and later, drops past and dateless plans, and sorts by day", () => {
    const { items, researched } = upcomingDeadlines({ colleges: DEMO_COLLEGES, profile: { plan: "ed_ok" }, now: NOW });
    expect(researched).toBe(true);
    expect(items.every((d) => d.date >= "2026-10-21")).toBe(true);
    expect(items.some((d) => d.plan === "Rolling")).toBe(false);
    // Georgia Tech's EA1 (Oct 15) has passed; EA2 (Nov 1) is ahead.
    const gtItems = items.filter((d) => d.collegeId === gt.id);
    expect(gtItems.map((d) => [d.plan, d.date, d.notes])).toEqual([
      ["EA", "2026-11-01", "EA2 for non-residents"],
      ["RD", "2027-01-04", null],
    ]);
    for (let i = 1; i < items.length; i++) expect(items[i - 1]!.date <= items[i]!.date).toBe(true);
  });

  it("filters by the student's plan willingness, counts the hidden ones and can show all", () => {
    const ea = upcomingDeadlines({ colleges: DEMO_COLLEGES, profile: { plan: "ea_only" }, now: NOW });
    expect(ea.items.some((d) => d.plan === "ED" || d.plan === "ED2")).toBe(false);
    expect(ea.hidden).toBeGreaterThan(0);
    const all = upcomingDeadlines({ colleges: DEMO_COLLEGES, profile: { plan: "ea_only" }, now: NOW, showAll: true });
    expect(all.hidden).toBe(0);
    expect(all.items.length).toBe(ea.items.length + ea.hidden);
    const rd = upcomingDeadlines({ colleges: DEMO_COLLEGES, profile: { plan: "rd_only" }, now: NOW });
    expect(rd.items.every((d) => d.plan === "RD" || d.plan === "Priority")).toBe(true);
  });

  it("marks shortlisted colleges and puts them first within a day", () => {
    const { items } = upcomingDeadlines({ colleges: DEMO_COLLEGES, shortlist: [nyu.id], profile: { plan: "ed_ok" }, now: NOW });
    const nov1 = items.filter((d) => d.date === "2026-11-01");
    expect(nov1[0]!.collegeId).toBe(nyu.id);
    expect(nov1[0]!.starred).toBe(true);
    expect(nov1.filter((d) => d.starred)).toHaveLength(1);
  });

  it("ignores unparseable deadlines and unknown plans, and reports when nothing was researched", () => {
    const c = college("x1", "Example", [
      { plan: "EA", deadline: "Early November" },
      { plan: "RD", deadline: "2027-01-15" },
      { plan: "Bogus" as "RD", deadline: "2027-02-01" },
    ]);
    const r = upcomingDeadlines({ colleges: [c], profile: { plan: "ed_ok" }, now: NOW });
    expect(r.items.map((d) => d.plan)).toEqual(["RD"]);
    const none = upcomingDeadlines({ colleges: [{ ...mit, application: undefined }], now: NOW });
    expect(none.researched).toBe(false);
    expect(none.items).toEqual([]);
  });

  it("dedupes an identical college + plan + day", () => {
    const c = college("x2", "Twice", [
      { plan: "EA", deadline: "Nov 1, 2026" },
      { plan: "EA", deadline: "2026-11-01" },
    ]);
    expect(upcomingDeadlines({ colleges: [c], now: NOW }).items).toHaveLength(1);
  });
});

describe("groupByDate / nextDeadlineSummary", () => {
  it("groups consecutive items by day with the distance in days", () => {
    const { items } = upcomingDeadlines({ colleges: DEMO_COLLEGES, profile: { plan: "ed_ok" }, now: NOW });
    const groups = groupByDate(items, NOW);
    expect(groups[0]!.date).toBe("2026-11-01");
    expect(groups[0]!.daysUntil).toBe(11);
    expect(groups[0]!.items.length).toBeGreaterThan(3);
    expect(new Set(groups.map((g) => g.date)).size).toBe(groups.length);
  });

  it("summarises the next day for the banner", () => {
    const { items } = upcomingDeadlines({ colleges: [mit, duke], profile: { plan: "ed_ok" }, now: NOW });
    const s = nextDeadlineSummary(items, NOW)!;
    expect(s).toMatchObject({ when: "Nov 1 · in 11 days", what: "MIT · Early Action", count: 1, date: "2026-11-01" });
    const many = nextDeadlineSummary(upcomingDeadlines({ colleges: DEMO_COLLEGES, profile: { plan: "ed_ok" }, now: NOW }).items, NOW)!;
    expect(many.when).toBe("Nov 1 · in 11 days");
    expect(many.what).toMatch(/^\d+ colleges · \d+ plans$/);
    expect(nextDeadlineSummary([], NOW)).toBeNull();
  });
});

describe("reminders", () => {
  const d = (over: Partial<Deadline>): Deadline => ({ collegeId: "1", collegeName: "Duke University", short: "Duke", url: null, plan: "ED", planLabel: "Early Decision", date: "2026-11-01", notes: null, starred: false, ...over });

  it("writes plain titles for one college and for several on the same day", () => {
    const one = reminderText({ date: "2026-11-01", daysUntil: 11, items: [d({})] }, 7, NOW);
    expect(one.title).toBe("Duke · Early Decision due in 7 days — Nov 1");
    expect(one.body).toMatch(/Confirm the date/);
    const eve = reminderText({ date: "2026-11-01", daysUntil: 11, items: [d({})] }, 1, NOW);
    expect(eve.title).toBe("Duke · Early Decision due tomorrow — Nov 1");
    const items = [d({ collegeId: "a", short: "MIT", plan: "EA", planLabel: "Early Action" }), d({ collegeId: "b", short: "Purdue", plan: "EA", planLabel: "Early Action" }), d({ collegeId: "c", short: "Michigan", plan: "EA", planLabel: "Early Action" })];
    const many = reminderText({ date: "2026-11-01", daysUntil: 11, items }, 7, NOW);
    expect(many.title).toBe("3 Early Action deadlines in 7 days — Nov 1");
    expect(many.body).toBe("MIT, Purdue and Michigan. Confirm the dates on each college's site.");
    const mixed = reminderText({ date: "2026-11-01", daysUntil: 11, items: [items[0]!, d({ collegeId: "d" })] }, 1, NOW);
    expect(mixed.title).toBe("2 application deadlines tomorrow — Nov 1");
  });

  it("schedules 7 days and 1 day before at 9:00 local, with stable prefixed ids, skipping lead days already past", () => {
    const items = [d({}), d({ collegeId: "2", short: "MIT", plan: "EA", planLabel: "Early Action" }), d({ collegeId: "3", short: "Later", plan: "RD", planLabel: "Regular Decision", date: "2027-01-02" })];
    const r = buildReminders(items, NOW);
    expect(r.map((x) => x.id)).toEqual([reminderId("2026-11-01", 7), reminderId("2026-11-01", 1), reminderId("2027-01-02", 7), reminderId("2027-01-02", 1)]);
    expect(r[0]!.id).toBe(`${REMINDER_PREFIX}2026-11-01:7d`);
    expect(new Date(r[0]!.fireAt)).toEqual(new Date(2026, 9, 25, 9, 0, 0, 0));
    expect(new Date(r[1]!.fireAt)).toEqual(new Date(2026, 9, 31, 9, 0, 0, 0));
    expect(new Date(r[3]!.fireAt)).toEqual(new Date(2027, 0, 1, 9, 0, 0, 0));
    expect(r[0]!.title).toBe("2 application deadlines in 7 days — Nov 1");
    // Three days out: only the day-before reminder is still ahead.
    const soon = buildReminders([d({ date: "2026-10-24" })], NOW);
    expect(soon.map((x) => x.id)).toEqual([reminderId("2026-10-24", 1)]);
    // Tomorrow at 14:30: the 9:00 day-before moment has passed → nothing.
    expect(buildReminders([d({ date: "2026-10-22" })], NOW)).toEqual([]);
    // Tomorrow at 8:00: still fires at 9:00 today.
    expect(buildReminders([d({ date: "2026-10-22" })], new Date(2026, 9, 21, 8, 0))).toHaveLength(1);
  });

  it("caps at 60 (iOS keeps 64 pending; the research-ready one needs a slot), soonest first", () => {
    const items: Deadline[] = [];
    for (let i = 0; i < 80; i++) items.push(d({ collegeId: String(i), date: shiftDay("2026-11-10", i) }));
    const r = buildReminders(items, NOW);
    expect(r).toHaveLength(REMINDER_CAP);
    expect(REMINDER_CAP).toBeLessThanOrEqual(60);
    for (let i = 1; i < r.length; i++) expect(r[i - 1]!.fireAt).toBeLessThanOrEqual(r[i]!.fireAt);
    expect(r[0]!.id).toBe(reminderId("2026-11-10", 7));
    expect(r.every((x) => x.id.startsWith(REMINDER_PREFIX))).toBe(true);
  });

  it("merges lists: the same college + plan + day once, starred if any list starred it", () => {
    const a = [d({}), d({ collegeId: "2", short: "MIT", plan: "EA", planLabel: "Early Action" })];
    const b = [d({ starred: true }), d({ collegeId: "9", short: "Other", plan: "RD", planLabel: "Regular Decision", date: "2027-01-15" })];
    const merged = mergeDeadlines([a, b]);
    expect(merged).toHaveLength(3);
    expect(merged.find((x) => x.collegeId === "1")!.starred).toBe(true);
    expect(buildReminders(merged, NOW)).toHaveLength(4);
  });
});

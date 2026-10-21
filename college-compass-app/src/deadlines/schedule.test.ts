import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_COLLEGES } from "@/state/fixtures";
import type { ListMeta } from "@/state/lists";
import { REMINDER_PREFIX } from "./deadlines";

const platform = { supportsDeadlineReminders: vi.fn(() => true), scheduleDeadlineReminders: vi.fn(async (_prefix: string, reminders: unknown[]) => reminders.length) };
vi.mock("@/platform", () => ({
  supportsDeadlineReminders: () => platform.supportsDeadlineReminders(),
  scheduleDeadlineReminders: (p: string, r: unknown[]) => platform.scheduleDeadlineReminders(p, r),
}));

const { collectReminders, readListData, syncDeadlineReminders } = await import("./schedule");

const NOW = new Date(2026, 9, 21, 14, 30);
const meta = (id: string, remind?: boolean): ListMeta => ({ id, name: id, createdAt: "2026-10-01T00:00:00.000Z", remind });
const duke = DEMO_COLLEGES.find((c) => c.short === "Duke")!;
const mit = DEMO_COLLEGES.find((c) => c.short === "MIT")!;

beforeEach(() => {
  platform.supportsDeadlineReminders.mockReturnValue(true);
  platform.scheduleDeadlineReminders.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("collectReminders", () => {
  it("only lists with reminders on contribute, each filtered by its own plan willingness", () => {
    const read = (id: string) => (id === "a" ? { colleges: [duke, mit], shortlist: [], profile: { plan: "ea_only" as const } } : { colleges: [duke], shortlist: [], profile: { plan: "ed_ok" as const } });
    // List a: EA-only → MIT EA Nov 1 + RD dates; Duke's ED hidden. List b off.
    const a = collectReminders([meta("a", true), meta("b", false)], read, NOW);
    expect(a.map((r) => r.id)).toContain(`${REMINDER_PREFIX}2026-11-01:7d`);
    expect(a.some((r) => r.id.includes("2026-11-03"))).toBe(false);
    // Both on: Duke's ED Nov 3 comes from list b.
    const both = collectReminders([meta("a", true), meta("b", true)], read, NOW);
    expect(both.some((r) => r.id === `${REMINDER_PREFIX}2026-11-03:7d`)).toBe(true);
    expect(collectReminders([meta("a"), meta("b")], read, NOW)).toEqual([]);
  });

  it("dedupes the same college + plan + day across lists into one reminder", () => {
    const read = () => ({ colleges: [mit], shortlist: [], profile: { plan: "ed_ok" as const } });
    const r = collectReminders([meta("a", true), meta("b", true)], read, NOW);
    const nov1 = r.filter((x) => x.id.startsWith(`${REMINDER_PREFIX}2026-11-01:`));
    expect(nov1).toHaveLength(2); // 7d + 1d, once
    expect(nov1[0]!.title).toBe("MIT · Early Action due in 7 days — Nov 1");
  });
});

describe("syncDeadlineReminders", () => {
  it("hands the merged set to the platform under the deadline prefix, using the in-memory override for the active list", async () => {
    const n = await syncDeadlineReminders([meta("a", true)], { id: "a", data: { colleges: [duke], shortlist: [], profile: { plan: "ed_ok" } } }, NOW);
    expect(platform.scheduleDeadlineReminders).toHaveBeenCalledTimes(1);
    const [prefix, reminders] = platform.scheduleDeadlineReminders.mock.calls[0]! as [string, { id: string }[]];
    expect(prefix).toBe(REMINDER_PREFIX);
    expect(reminders.map((r) => r.id)).toEqual([`${REMINDER_PREFIX}2026-11-03:7d`, `${REMINDER_PREFIX}2026-11-03:1d`, `${REMINDER_PREFIX}2027-01-02:7d`, `${REMINDER_PREFIX}2027-01-02:1d`]);
    expect(n).toBe(4);
  });

  it("schedules an empty set (clearing) when no list wants reminders, and does nothing on the web", async () => {
    await syncDeadlineReminders([meta("a", false)], undefined, NOW);
    expect(platform.scheduleDeadlineReminders).toHaveBeenCalledWith(REMINDER_PREFIX, []);
    platform.scheduleDeadlineReminders.mockClear();
    platform.supportsDeadlineReminders.mockReturnValue(false);
    expect(await syncDeadlineReminders([meta("a", true)], undefined, NOW)).toBe(0);
    expect(platform.scheduleDeadlineReminders).not.toHaveBeenCalled();
  });

  it("readListData tolerates missing or malformed storage", () => {
    expect(readListData("nope")).toEqual({ colleges: [], shortlist: [], profile: null });
  });
});

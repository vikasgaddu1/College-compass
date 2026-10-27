// @vitest-environment jsdom
/** Deadlines: the List tab banner, the Deadlines screen (groups, willingness filter, empty states) and the reminders toggle. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { College } from "@/types";
import { DEMO_COLLEGES, DEMO_PROFILE } from "@/state/fixtures";
import { LISTS_KEY, listKey, type ListMeta, type ListsIndex } from "@/state/lists";
import { REMINDER_PREFIX } from "@/deadlines/deadlines";

const platform = {
  native: false,
  granted: true,
  requestNotificationPermission: vi.fn(async () => platform.granted),
  scheduleDeadlineReminders: vi.fn(async (_prefix: string, reminders: { id: string }[]) => reminders.length),
  shareCalendarFile: vi.fn(async (_ics: string, _name: string) => ({ completed: true })),
};
vi.mock("@/platform", () => ({
  isNative: () => platform.native,
  supportsDeadlineReminders: () => platform.native,
  supportsLeaveAndNotify: () => platform.native,
  supportsSelfServeSignIn: () => false,
  requestNotificationPermission: () => platform.requestNotificationPermission(),
  scheduleDeadlineReminders: (p: string, r: { id: string }[]) => platform.scheduleDeadlineReminders(p, r),
  clearDeadlineReminders: async () => {},
  pendingDeadlineReminders: async () => [],
  shareCalendarFile: (ics: string, name: string) => platform.shareCalendarFile(ics, name),
  sharePdf: async () => ({ completed: false }),
  notifyWhenResearchDone: async () => {},
  cancelResearchNotification: async () => {},
  beginResearchRun: async () => {},
  endResearchRun: async () => {},
  takeOrphanedResearch: async () => [],
  onAuthRedirect: () => () => {},
  onAuthBrowserFinished: () => () => {},
  openAuthUrl: async () => {},
  closeAuthBrowser: async () => {},
  httpFetch: (i: RequestInfo | URL, init?: RequestInit) => fetch(i, init),
  postForm: async () => ({ status: 0, json: null }),
  redirectUri: () => "http://localhost/callback.html",
  startLoopback: async () => { throw new Error("web"); },
  isAuthCallbackUrl: () => false,
  parseAuthCallback: () => null,
  NATIVE_SCHEME: "collegecompass",
  NATIVE_AUTH_CALLBACK: "collegecompass://auth/callback",
}));

const { App } = await import("@/app/App");

// Oct 21, 2026 — Nov 1 is 11 days away; Georgia Tech's Oct 15 EA1 has passed.
const NOW = new Date(2026, 9, 21, 14, 30);

const index = (): ListsIndex => JSON.parse(localStorage.getItem("cc2:" + LISTS_KEY) || "null");
const active = (): ListMeta => index().items.find((l) => l.id === index().active)!;

function seed(colleges: College[] = DEMO_COLLEGES, over: Partial<ListMeta> = {}, profile = DEMO_PROFILE) {
  const items: ListMeta[] = [{ id: "a", name: "Robotics · NC", createdAt: "2026-10-01T00:00:00.000Z", onboardingDone: true, researchedAt: "2026-10-02T00:00:00.000Z", ...over }];
  localStorage.setItem("cc2:" + LISTS_KEY, JSON.stringify({ v: 1, active: "a", items } satisfies ListsIndex));
  localStorage.setItem("cc2:" + listKey("a", "profile"), JSON.stringify(profile));
  localStorage.setItem("cc2:" + listKey("a", "colleges"), JSON.stringify(colleges));
}

beforeEach(() => {
  vi.setSystemTime(NOW); // Date only; timers stay real
  localStorage.clear();
  platform.native = false;
  platform.granted = true;
  platform.requestNotificationPermission.mockClear();
  platform.scheduleDeadlineReminders.mockClear();
  platform.shareCalendarFile.mockClear();
  window.location.hash = "#/list";
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any;
  Element.prototype.scrollTo = vi.fn() as any;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("List tab banner", () => {
  it("shows the next deadline day and opens the Deadlines screen", async () => {
    seed();
    render(<App />);
    const banner = await screen.findByRole("button", { name: /^Deadlines\. Next: Nov 1 · in 11 days, / });
    expect(banner.textContent).toContain("Next deadline");
    expect(banner.textContent).toContain("Nov 1 · in 11 days");
    // Demo profile is EA-only: the Nov 1 ED deadlines are not counted in the banner.
    expect(banner.getAttribute("aria-label")).toMatch(/, \d colleges · Early Action, Priority deadline$/);
    fireEvent.click(banner);
    await waitFor(() => expect(window.location.hash).toBe("#/deadlines"));
    expect(await screen.findByRole("heading", { name: "Deadlines", level: 1 })).toBeTruthy();
  });

  it("is absent when no deadline is ahead", async () => {
    const past = DEMO_COLLEGES.map((c) => ({ ...c, application: c.application && { ...c.application, plans: c.application.plans.map((p) => ({ ...p, deadline: p.deadline ? "Oct 1, 2026" : null })) } }));
    seed(past);
    render(<App />);
    await screen.findByText(DEMO_COLLEGES[0]!.name);
    expect(screen.queryByRole("button", { name: /^Deadlines\./ })).toBeNull();
  });
});

describe("Deadlines screen", () => {
  it("groups by day, marks starred colleges, shows notes and opens a college", async () => {
    seed();
    localStorage.setItem("cc2:" + listKey("a", "shortlist"), JSON.stringify(["166683"])); // MIT
    window.location.hash = "#/deadlines";
    render(<App />);
    expect(await screen.findByText("Robotics · NC · 19 upcoming")).toBeTruthy();
    const nov1 = within(screen.getByRole("region", { name: "Nov 1, in 11 days" }));
    expect(nov1.getByText("Sunday")).toBeTruthy();
    const mitRow = nov1.getByRole("button", { name: "Massachusetts Institute of Technology, Early Action, on your shortlist" });
    expect(mitRow).toBeTruthy();
    // Starred first within the day.
    expect(nov1.getAllByRole("button")[0]).toBe(mitRow);
    expect(nov1.getByRole("button", { name: /Georgia Institute of Technology, Early Action, EA2 for non-residents/ })).toBeTruthy();
    expect(nov1.getByRole("button", { name: /Arizona State University, Priority deadline, For merit scholarship consideration/ })).toBeTruthy();
    // ED deadlines hidden for an EA-only student; Duke's Nov 3 ED is not listed.
    expect(screen.queryByRole("region", { name: /^Nov 3/ })).toBeNull();
    expect(screen.getByText(/deadlines for Early Decision hidden/)).toBeTruthy();
    // "Confirm on the site" links.
    expect(nov1.getByRole("link", { name: "Confirm on MIT's website" }).getAttribute("href")).toBe("https://web.mit.edu");
    expect(screen.getByTestId("ai-notice-line").textContent).toContain("Deadlines come from AI-assisted research and may be out of date — verify each one with the college before you apply.");
    fireEvent.click(mitRow);
    await waitFor(() => expect(window.location.hash).toBe("#/college/166683"));
  });

  it("'Show all' reveals the plans the student said they'd skip", async () => {
    seed();
    window.location.hash = "#/deadlines";
    render(<App />);
    await screen.findByText("Robotics · NC · 19 upcoming");
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(await screen.findByText("Robotics · NC · 26 upcoming")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Nov 3, in 13 days" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Duke University, Early Decision" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show mine" }));
    expect(await screen.findByText("Robotics · NC · 19 upcoming")).toBeTruthy();
  });

  it("explains that reminders are iPhone-only on the web and exports a calendar file", async () => {
    seed();
    window.location.hash = "#/deadlines";
    render(<App />);
    await screen.findByText("Robotics · NC · 19 upcoming");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText("Available in the iPhone app")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add to Calendar/ }));
    await waitFor(() => expect(platform.shareCalendarFile).toHaveBeenCalledTimes(1));
    const [ics, name] = platform.shareCalendarFile.mock.calls[0]!;
    expect(name).toBe("College deadlines - Robotics · NC.ics");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(19);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261101");
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("has empty states for no research and for nothing ahead", async () => {
    seed([]);
    window.location.hash = "#/deadlines";
    render(<App />);
    expect(await screen.findByText("No deadlines yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Research colleges" })).toBeTruthy();
    cleanup();
    const noPlans = DEMO_COLLEGES.map((c) => ({ ...c, application: undefined }));
    seed(noPlans);
    render(<App />);
    expect(await screen.findByText("No deadlines found")).toBeTruthy();
    cleanup();
    const past = DEMO_COLLEGES.map((c) => ({ ...c, application: c.application && { ...c.application, plans: c.application.plans.map((p) => ({ ...p, deadline: p.deadline ? "2026-09-01" : null })) } }));
    seed(past);
    render(<App />);
    expect(await screen.findByText("Nothing coming up")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add to Calendar/ })).toHaveProperty("disabled", true);
  });
});

describe("Reminders toggle (iPhone)", () => {
  it("asks for permission, stores the setting with the list and schedules 7-day and 1-day reminders", async () => {
    platform.native = true;
    seed();
    window.location.hash = "#/deadlines";
    render(<App />);
    await screen.findByText("Robotics · NC · 19 upcoming");
    const sw = screen.getByRole("switch", { name: "Remind me before deadlines" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    // Launch sync: nothing is on, so the pending set is cleared.
    await waitFor(() => expect(platform.scheduleDeadlineReminders).toHaveBeenCalledWith(REMINDER_PREFIX, []));
    platform.scheduleDeadlineReminders.mockClear();

    fireEvent.click(sw);
    await waitFor(() => expect(platform.requestNotificationPermission).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByText("On for this list")).toBeTruthy();
    await waitFor(() => expect(active().remind).toBe(true));
    await waitFor(() => expect(platform.scheduleDeadlineReminders).toHaveBeenCalled(), { timeout: 3000 });
    const [prefix, reminders] = platform.scheduleDeadlineReminders.mock.calls.at(-1)! as [string, { id: string; title: string; fireAt: number }[]];
    expect(prefix).toBe(REMINDER_PREFIX);
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders.length).toBeLessThanOrEqual(60);
    expect(reminders[0]!.id).toBe(`${REMINDER_PREFIX}2026-11-01:7d`);
    expect(reminders[0]!.title).toMatch(/deadlines in 7 days — Nov 1$/);
    expect(new Date(reminders[0]!.fireAt).getHours()).toBe(9);
    expect(reminders[1]!.id).toBe(`${REMINDER_PREFIX}2026-11-01:1d`);
    // No ED reminders for an EA-only student.
    expect(reminders.some((r) => r.id.includes("2026-11-03"))).toBe(false);

    // Off again: the setting is cleared and the pending set emptied.
    platform.scheduleDeadlineReminders.mockClear();
    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
    await waitFor(() => expect(active().remind).toBe(false));
    await waitFor(() => expect(platform.scheduleDeadlineReminders).toHaveBeenCalledWith(REMINDER_PREFIX, []));
  });

  it("stays off and explains when notification permission is declined", async () => {
    platform.native = true;
    platform.granted = false;
    seed();
    window.location.hash = "#/deadlines";
    render(<App />);
    await screen.findByText("Robotics · NC · 19 upcoming");
    fireEvent.click(screen.getByRole("switch", { name: "Remind me before deadlines" }));
    expect(await screen.findByText(/Notifications are off for Tierwise/)).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Remind me before deadlines" }).getAttribute("aria-checked")).toBe("false");
    await waitFor(() => expect(active().remind).toBeFalsy());
  });

  it("re-schedules at launch for a list that already has reminders on", async () => {
    platform.native = true;
    seed(DEMO_COLLEGES, { remind: true });
    render(<App />);
    await screen.findByText(DEMO_COLLEGES[0]!.name);
    await waitFor(() => expect(platform.scheduleDeadlineReminders.mock.calls.some(([, r]) => r.length > 0)).toBe(true), { timeout: 3000 });
  });
});

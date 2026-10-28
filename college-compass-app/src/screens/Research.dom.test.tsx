// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { AiError, type ResearchOptions } from "@/types";
import { DEMO_COLLEGES, DEMO_PROFILE } from "@/state/fixtures";

const mocks = vi.hoisted(() => ({
  account: vi.fn<() => unknown>(() => ({ sub: "u1", name: "Avery", email: null, picture: null, plan_usage: true })),
  ensureFresh: vi.fn<(ms?: number) => Promise<void>>(async () => {}),
  signIn: vi.fn<(rt?: string) => Promise<void>>(async () => {}),
  lastError: vi.fn<() => string | null>(() => null),
  listeners: new Set<() => void>(),
  run: vi.fn<(o: ResearchOptions) => Promise<unknown[]>>(),
}));

vi.mock("@/state/services", async () => {
  const actual = await vi.importActual<typeof import("@/state/services")>("@/state/services");
  return {
    ...actual,
    auth: {
      configured: () => true,
      account: mocks.account,
      ensureFresh: mocks.ensureFresh,
      signIn: mocks.signIn,
      lastError: mocks.lastError,
      lastIssue: () => null,
      signOut() {},
      listModels: async () => [],
      subscribe(fn: () => void) {
        mocks.listeners.add(fn);
        return () => mocks.listeners.delete(fn);
      },
    },
    isConnected: () => !!mocks.account(),
    researchApi: () => ({ run: mocks.run, researchOne: async () => DEMO_COLLEGES[0] }),
  };
});

import { StoreProvider } from "@/state/store";
import { LISTS_KEY, listKey, type ListsIndex } from "@/state/lists";
import { Research } from "./Research";

/** Ids of the colleges stored for the active list (the flat `cc2:profile`/`cc2:prefs` seeded below are migrated into it). */
function storedCollegeIds(): string[] {
  const idx = JSON.parse(localStorage.getItem("cc2:" + LISTS_KEY) || "null") as ListsIndex | null;
  const raw = idx ? localStorage.getItem("cc2:" + listKey(idx.active, "colleges")) : null;
  return (JSON.parse(raw || "[]") as { id: string }[]).map((c) => c.id);
}

const emit = () => act(() => { for (const fn of mocks.listeners) fn(); });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("cc2:profile", JSON.stringify(DEMO_PROFILE));
  // The AI-assistance notice was acknowledged on this install; the "first run" suite below clears it.
  localStorage.setItem("cc2:prefs", JSON.stringify({ onboardingDone: true, aiNoticeAcceptedAt: "2026-10-01T00:00:00.000Z" }));
  window.location.hash = "#/research";
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any;
  Element.prototype.scrollTo = vi.fn() as any;
  mocks.account.mockReturnValue({ sub: "u1", name: "Avery", email: null, picture: null, plan_usage: true });
  mocks.ensureFresh.mockReset().mockResolvedValue(undefined);
  mocks.signIn.mockReset().mockResolvedValue(undefined);
  mocks.lastError.mockReturnValue(null);
  mocks.listeners.clear();
  mocks.run.mockReset().mockImplementation(() => new Promise(() => {})); // a run that never finishes
});
afterEach(() => cleanup());

const renderResearch = () =>
  render(
    <StoreProvider>
      <Research />
    </StoreProvider>,
  );

describe("Research sign-in gate", () => {
  it("renews the session for the whole run before starting", async () => {
    renderResearch();
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    expect(mocks.ensureFresh).toHaveBeenCalledWith(25 * 60_000);
    expect(screen.queryByText("Your ChatGPT session ended")).toBeNull();
  });

  it("shows the sign-in card instead of starting when the session can't be renewed", async () => {
    mocks.ensureFresh.mockRejectedValue(new AiError("reauth_required", "Your ChatGPT session ended. Please sign in again."));
    renderResearch();
    expect(await screen.findByText("Your ChatGPT session ended")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeTruthy();
    expect(screen.getByText("Research paused")).toBeTruthy();
    expect(mocks.run).not.toHaveBeenCalled();
    // No dead-end error banner.
    expect(screen.queryByText(/Research stopped/)).toBeNull();
    expect(screen.queryByText(/Research failed/)).toBeNull();
  });

  it("shows the never-signed-in card when there is no account", async () => {
    mocks.account.mockReturnValue(null);
    renderResearch();
    expect(await screen.findByText("Sign in with ChatGPT")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeTruthy();
    expect(mocks.run).not.toHaveBeenCalled();
    // The store's own foreground renewal (no args) may run; Research's 25-minute renewal must not.
    expect(mocks.ensureFresh).not.toHaveBeenCalledWith(25 * 60_000);
  });

  it("swaps the error banner for the card when a run ends with reauth_required, then resumes after sign-in without losing colleges", async () => {
    const first = DEMO_COLLEGES[0];
    mocks.run.mockImplementationOnce(async (o) => {
      o.onEvent({ type: "planned", candidates: [{ name: first.name, state: first.state, why: "", expected_tier: null, user_added: false }] });
      o.onEvent({ type: "college_done", college: first });
      o.onEvent({ type: "error", error: "Your ChatGPT session ended. Please sign in again.", code: "reauth_required" });
      throw new AiError("reauth_required", "Your ChatGPT session ended. Please sign in again.");
    });
    renderResearch();
    expect(await screen.findByText("Your ChatGPT session ended")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeTruthy();
    expect(screen.queryByText(/Research stopped/)).toBeNull();
    // The college researched before the session ended is still on screen and in the store.
    expect(screen.getByText(first.name)).toBeTruthy();
    // Saved to storage by an effect after the render, so wait for it (slower CI machines).
    await waitFor(() => expect(storedCollegeIds()).toContain(first.id));

    // Signed in again (the auth module notifies subscribers): research resumes by itself.
    mocks.run.mockImplementationOnce(() => new Promise(() => {}));
    emit();
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Your ChatGPT session ended")).toBeNull();
    expect(screen.getByText(first.name)).toBeTruthy();
    const opts = mocks.run.mock.calls[1]![0];
    expect(opts.cache?.map((c) => c.id)).toContain(first.id);
    // Saved to storage by an effect after the render, so wait for it (slower CI machines).
    await waitFor(() => expect(storedCollegeIds()).toContain(first.id));
  });

  it("does not resume on a failed sign-in attempt", async () => {
    mocks.ensureFresh.mockRejectedValue(new AiError("reauth_required", "ended"));
    renderResearch();
    expect(await screen.findByText("Your ChatGPT session ended")).toBeTruthy();
    mocks.lastError.mockReturnValue("Sign-in was cancelled.");
    emit();
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.run).not.toHaveBeenCalled();
    expect(screen.getByText("Your ChatGPT session ended")).toBeTruthy();
  });
});

describe("Research review fixes", () => {
  it("does not start a run if the screen is left while the session is renewing", async () => {
    let finish!: () => void;
    mocks.ensureFresh.mockImplementation((ms?: number) => (ms === 25 * 60_000 ? new Promise<void>((r) => { finish = r; }) : Promise.resolve()));
    const view = renderResearch();
    await waitFor(() => expect(mocks.ensureFresh).toHaveBeenCalledWith(25 * 60_000));
    view.unmount();
    await act(async () => { finish(); });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("remembers to resume only once sign-in actually starts, and forgets on leaving", async () => {
    mocks.ensureFresh.mockRejectedValue(new AiError("reauth_required", "Your ChatGPT session ended. Please sign in again."));
    const view = renderResearch();
    const button = await screen.findByRole("button", { name: "Continue with ChatGPT" });
    expect(sessionStorage.getItem("cc2:research_resume")).toBeNull();
    await act(async () => { button.click(); });
    expect(mocks.signIn).toHaveBeenCalledWith("/research");
    expect(sessionStorage.getItem("cc2:research_resume")).toBe("1");
    view.unmount(); // "Not now" / navigating away in the same page
    expect(sessionStorage.getItem("cc2:research_resume")).toBeNull();
  });
});

describe("Cancel", () => {
  it("stops the run, ignores late results, and never leaves the student stuck", async () => {
    let opts!: ResearchOptions;
    mocks.run.mockImplementation((o) => {
      opts = o;
      o.onEvent({ type: "planned", candidates: [{ name: "Duke University", state: "NC", why: "", expected_tier: null, user_added: false }, { name: "Rice University", state: "TX", why: "", expected_tier: null, user_added: false }] });
      o.onEvent({ type: "batch_started", batch: 0, names: ["Duke University", "Rice University"] });
      return new Promise((_, reject) => o.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    });
    const { container } = renderResearch();
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(container.querySelector(".cc-spinner")).not.toBeNull();

    await act(async () => { cancel.click(); });
    expect(opts.signal?.aborted).toBe(true);
    expect(await screen.findByText("Research stopped")).toBeTruthy();
    // No "still working" spinners once stopped.
    expect(container.querySelector(".cc-spinner")).toBeNull();
    expect(screen.getByText(/stopped$/, { selector: "span" })).toBeTruthy();

    // A response that was already on its way is ignored.
    await act(async () => { opts.onEvent({ type: "college_done", college: DEMO_COLLEGES[0]! }); });
    expect(screen.getByText("Research stopped")).toBeTruthy();
    expect(screen.queryByText(DEMO_COLLEGES[0]!.name)).toBeNull();

    // Ways out: back to the list (enabled even with nothing researched), try again, change answers.
    const back = screen.getByRole("button", { name: "Back to my list" }) as HTMLButtonElement;
    expect(back.disabled).toBe(false);
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change my answers" })).toBeTruthy();
    await act(async () => { back.click(); });
    expect(window.location.hash).toBe("#/list");
  });

  it("Try again starts one run at a time while the session renews", async () => {
    mocks.run.mockImplementation((o) => new Promise((_, reject) => o.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
    renderResearch();
    await act(async () => { (await screen.findByRole("button", { name: "Cancel" })).click(); });
    expect(mocks.run).toHaveBeenCalledTimes(1);

    let renew!: () => void;
    mocks.ensureFresh.mockImplementation(() => new Promise<void>((r) => { renew = r; }));
    const again = screen.getByRole("button", { name: /Try again/ }) as HTMLButtonElement;
    await act(async () => { again.click(); });
    const busy = screen.getByRole("button", { name: /Starting/ }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    await act(async () => { busy.click(); busy.click(); });
    await act(async () => { renew(); });
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Research stopped")).toBeNull();
  });
});

describe("AI-assistance notice (first research run on this install)", () => {
  const firstRun = () => localStorage.setItem("cc2:prefs", JSON.stringify({ onboardingDone: true }));
  const accepted = () => (JSON.parse(localStorage.getItem("cc2:prefs") || "{}") as { aiNoticeAcceptedAt?: string }).aiNoticeAcceptedAt;

  it("shows 'Before you start' with the full notice and runs nothing until it's accepted", async () => {
    firstRun();
    renderResearch();
    const sheet = await screen.findByRole("dialog", { name: "Before you start" });
    expect(sheet.textContent).toContain("About Tierwise.");
    expect(sheet.textContent).toContain("AI can make mistakes.");
    expect(sheet.textContent).toContain("not affiliated with or endorsed by any college or university, the College Board, ACT, or the Common Application.");
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.ensureFresh).not.toHaveBeenCalledWith(25 * 60_000);
    // No research chrome behind the sheet.
    expect(screen.queryByText("Picking colleges for you")).toBeNull();
    expect(screen.getByText("Let's research colleges")).toBeTruthy();

    await act(async () => { screen.getByRole("button", { name: "I understand" }).click(); });
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "Before you start" })).toBeNull();
    expect(accepted()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("is shown once per install: a later visit starts research straight away", async () => {
    firstRun();
    const view = renderResearch();
    await act(async () => { (await screen.findByRole("button", { name: "I understand" })).click(); });
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    view.unmount();

    renderResearch();
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog", { name: "Before you start" })).toBeNull();
  });

  it("'Not now' starts nothing, records nothing and goes back to the list", async () => {
    firstRun();
    renderResearch();
    const sheet = await screen.findByRole("dialog", { name: "Before you start" });
    await act(async () => { sheet.querySelector<HTMLButtonElement>("button.cc-btn-quiet")!.click(); });
    expect(window.location.hash).toBe("#/list");
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.run).not.toHaveBeenCalled();
    expect(accepted()).toBeUndefined();
  });

  it("comes before the sign-in gate, so a signed-out student sees the notice first and the card after accepting", async () => {
    firstRun();
    mocks.account.mockReturnValue(null);
    renderResearch();
    await screen.findByRole("dialog", { name: "Before you start" });
    expect(screen.queryByText("Sign in with ChatGPT")).toBeNull();
    await act(async () => { screen.getByRole("button", { name: "I understand" }).click(); });
    expect(await screen.findByText("Sign in with ChatGPT")).toBeTruthy();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("the short line sits under finished results", async () => {
    mocks.run.mockImplementationOnce(async (o) => {
      o.onEvent({ type: "planned", candidates: [{ name: DEMO_COLLEGES[0]!.name, state: DEMO_COLLEGES[0]!.state, why: "", expected_tier: null, user_added: false }] });
      o.onEvent({ type: "college_done", college: DEMO_COLLEGES[0]! });
      o.onEvent({ type: "done", colleges: [DEMO_COLLEGES[0]!] });
      return [DEMO_COLLEGES[0]!];
    });
    renderResearch();
    expect(await screen.findByText("Research complete")).toBeTruthy();
    const line = screen.getByTestId("ai-notice-line");
    expect(line.textContent).toContain("AI-assisted estimates — verify with each college. Not an admission decision.");
    // The "i" opens the full text.
    await act(async () => { screen.getByRole("button", { name: "Learn more: About Tierwise" }).click(); });
    expect((await screen.findByRole("dialog", { name: "About Tierwise" })).textContent).toContain("AI can make mistakes.");
  });
});

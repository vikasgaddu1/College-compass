// @vitest-environment jsdom
/**
 * Counselor visibility: the Counselors tab, the shared availability hook (one directory request per
 * session) and the contextual prompts — college page, deadlines, research done, Ask. Every prompt
 * shows only when the directory lists someone, never in the demo, and stays hidden for 30 days once
 * dismissed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AiMessage, College, ResearchOptions } from "@/types";
import { DEMO_COLLEGES, DEMO_PROFILE } from "@/state/fixtures";
import { LISTS_KEY, listKey, type ListMeta, type ListsIndex } from "@/state/lists";
import { NS } from "@/lib/storage";
import { toCounselor, type Counselor, type DirectoryApi } from "@/data/counselors";
import { setCounselorDirectoryForMatches, summarizeMatches } from "@/data/counselorMatches";

const mocks = vi.hoisted(() => ({
  account: vi.fn<() => unknown>(() => null),
  run: vi.fn<(o: ResearchOptions) => Promise<unknown[]>>(),
  call: vi.fn(async () => ({ text: "Here is an answer." })),
}));

vi.mock("@/state/services", async () => {
  const actual = await vi.importActual<typeof import("@/state/services")>("@/state/services");
  return {
    ...actual,
    auth: {
      configured: () => true,
      account: mocks.account,
      ensureFresh: async () => {},
      signIn: async () => {},
      lastError: () => null,
      lastIssue: () => null,
      signOut() {},
      listModels: async () => [],
      subscribe: () => () => {},
    },
    isConnected: () => !!mocks.account(),
    researchApi: () => ({ run: mocks.run, researchOne: async () => DEMO_COLLEGES[0] }),
    aiClient: { call: mocks.call },
  };
});

const { App } = await import("@/app/App");
const { rankColleges } = await import("@/state/services");
const { askWantsCounselor, collegePromptText, deadlinePromptText, promptDismissKey, researchPromptText } = await import("./CounselorPrompt");

const SAMPLE: Counselor[] = [
  toCounselor({ id: "c1", name: "Priya Raman", title: "Independent counselor", city: "Raleigh", states: ["NC"], specialties: ["stem", "engineering", "essays"], modes: ["virtual", "in_person"] })!,
  toCounselor({ id: "c2", name: "Marcus Lee", title: "Essay coach", states: ["US"], specialties: ["essays", "arts"], modes: ["virtual"] })!,
  toCounselor({ id: "c3", name: "Cher", states: ["NC", "VA"], specialties: ["general"], modes: ["in_person"], city: "Durham" })!,
];
const GENERAL_ONLY: Counselor[] = [toCounselor({ id: "c3", name: "Cher", states: ["NC"], specialties: ["general"], modes: ["in_person"] })!];

function mockApi(rows: Counselor[] = SAMPLE) {
  const list = vi.fn<DirectoryApi["list"]>(async () => rows);
  const report = vi.fn<DirectoryApi["report"]>(async () => {});
  setCounselorDirectoryForMatches({ list, report });
  return { list, report };
}

// Oct 26, 2026: the demo list's Nov 1 Early Action deadlines are 6 days away.
const NOW = new Date(2026, 9, 26, 10, 0);
const DAY = 86_400_000;

function seed(colleges: College[] = DEMO_COLLEGES, over: Partial<ListMeta> = {}, chat: AiMessage[] = []) {
  const items: ListMeta[] = [{ id: "a", name: "My list", createdAt: "2026-10-01T00:00:00.000Z", onboardingDone: true, researchedAt: "2026-10-02T00:00:00.000Z", ...over }];
  localStorage.setItem("cc2:" + LISTS_KEY, JSON.stringify({ v: 1, active: "a", items } satisfies ListsIndex));
  localStorage.setItem("cc2:" + listKey("a", "profile"), JSON.stringify(DEMO_PROFILE));
  if (colleges.length) localStorage.setItem("cc2:" + listKey("a", "colleges"), JSON.stringify(colleges));
  if (chat.length) localStorage.setItem("cc2:" + listKey("a", "chat"), JSON.stringify(chat));
}

function setHash(h: string) {
  window.location.hash = h;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

const GT = DEMO_COLLEGES.find((c) => c.short === "Georgia Tech")!;
const prompt = () => screen.queryByRole("group", { name: "Get expert help" });
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  setCounselorDirectoryForMatches(null);
  mocks.account.mockReturnValue(null);
  mocks.run.mockReset().mockImplementation(() => new Promise(() => {}));
  mocks.call.mockClear();
  window.location.hash = "#/list";
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any;
  Element.prototype.scrollTo = vi.fn() as any;
  window.visualViewport = null as any;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Counselors tab", () => {
  it("is the middle of five tabs, opens the directory as a top-level screen and highlights", async () => {
    mockApi();
    seed();
    render(<App />);
    await screen.findByText(GT.name);
    const nav = within(screen.getByRole("navigation", { name: "Main" }));
    expect(nav.getAllByRole("button").map((b) => b.textContent)).toEqual(["List", "Shortlist", "Counselors", "Ask", "Settings"]);
    fireEvent.click(nav.getByRole("button", { name: "Counselors" }));
    await waitFor(() => expect(window.location.hash).toBe("#/counselors"));
    expect(await screen.findByRole("heading", { name: "Get expert help", level: 1 })).toBeTruthy();
    expect(screen.getByText(/Counselors pay to be listed/)).toBeTruthy();
    // A tab screen: no Back button, the tab bar stays and marks this tab.
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Counselors" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-current")).toBeNull();
  });

  it("Settings still has its row", async () => {
    seed();
    window.location.hash = "#/settings";
    render(<App />);
    expect(await screen.findByRole("button", { name: /Get expert help/ })).toBeTruthy();
  });
});

describe("Availability hook", () => {
  it("asks the directory once per session (state only), and every prompt shares the answer", async () => {
    const { list } = mockApi();
    seed();
    render(<App />);
    // List nudge
    expect(await screen.findByRole("region", { name: "Get expert help" })).toBeTruthy();
    // College page
    setHash(`#/college/${GT.id}`);
    await screen.findByText(GT.name, { selector: "h2" });
    expect(await screen.findByRole("group", { name: "Get expert help" })).toBeTruthy();
    // Deadlines
    setHash("#/deadlines");
    await screen.findByRole("heading", { name: "Deadlines", level: 1 });
    expect(await screen.findByRole("group", { name: "Get expert help" })).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(1);
    const [state, specialties] = list.mock.calls[0]!;
    expect(state).toBe("NC");
    expect(specialties).toEqual([]);
  });

  it("summarizes a state's listings against the student's specialties", () => {
    const m = summarizeMatches(SAMPLE, "NC", ["stem", "arts"]);
    expect(m).toMatchObject({ count: 3, matching: 2, interest: "stem", interestLabel: "STEM", local: 2 });
    expect(summarizeMatches(GENERAL_ONLY, "NC", ["stem"])).toMatchObject({ count: 1, matching: 0, interest: null });
    // No home state: only counselors who work virtually count.
    expect(summarizeMatches(SAMPLE, null, [])).toMatchObject({ count: 2, local: 0 });
    expect(summarizeMatches([], "NC", ["stem"]).count).toBe(0);
  });
});

describe("College page prompt", () => {
  const open = async () => {
    window.location.hash = `#/college/${GT.id}`;
    render(<App />);
    await screen.findByText(GT.name, { selector: "h2" });
  };

  it("names the college, the count and the matching interest; tapping preselects that specialty", async () => {
    mockApi();
    seed();
    await open();
    const p = await screen.findByRole("group", { name: "Get expert help" });
    expect(p.textContent).toContain("Applying to Georgia Tech? 3 counselors in North Carolina help with STEM applications.");
    // Sits below the odds card, above the notes.
    const odds = screen.getByText("Estimated odds");
    const notes = screen.getByText("Your notes");
    expect(odds.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(p.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(p).getByRole("button", { name: /Applying to Georgia Tech/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/counselors?specialty=stem"));
    await screen.findByRole("heading", { name: "Get expert help", level: 1 });
    expect(screen.getByRole("button", { name: "STEM" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Arts & performing" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("falls back to a general line when nobody lists the student's interests", async () => {
    mockApi(GENERAL_ONLY);
    seed();
    await open();
    expect((await screen.findByRole("group", { name: "Get expert help" })).textContent).toContain("Applying to Georgia Tech? 1 counselor in North Carolina can help with your application.");
  });

  it("is absent when the directory lists nobody, in the demo, and with shared data off", async () => {
    mockApi([]);
    seed();
    await open();
    await settle();
    expect(prompt()).toBeNull();
    cleanup();

    mockApi();
    localStorage.clear();
    seed(DEMO_COLLEGES, { demo: true });
    await open();
    await settle();
    expect(prompt()).toBeNull();
    cleanup();

    setCounselorDirectoryForMatches(null);
    localStorage.clear();
    seed();
    await open();
    await settle();
    expect(prompt()).toBeNull();
  });

  it("× hides this kind of prompt for 30 days on this phone", async () => {
    mockApi();
    seed();
    await open();
    const p = await screen.findByRole("group", { name: "Get expert help" });
    fireEvent.click(within(p).getByRole("button", { name: "Dismiss for 30 days" }));
    expect(prompt()).toBeNull();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(NS + promptDismissKey("college"))!)).toBe(NOW.getTime()));
    cleanup();

    render(<App />);
    await screen.findByText(GT.name, { selector: "h2" });
    await settle();
    expect(prompt()).toBeNull();
    cleanup();

    // Other kinds are unaffected: the deadlines line still shows.
    window.location.hash = "#/deadlines";
    render(<App />);
    expect(await screen.findByRole("group", { name: "Get expert help" })).toBeTruthy();
    cleanup();

    // 31 days later it comes back.
    localStorage.setItem(NS + promptDismissKey("college"), JSON.stringify(NOW.getTime() - 31 * DAY));
    window.location.hash = `#/college/${GT.id}`;
    render(<App />);
    expect(await screen.findByRole("group", { name: "Get expert help" })).toBeTruthy();
  });
});

describe("Deadlines prompt", () => {
  it("shows under Reminders when the next deadline is within 14 days", async () => {
    mockApi();
    seed();
    window.location.hash = "#/deadlines";
    render(<App />);
    const p = await screen.findByRole("group", { name: "Get expert help" });
    // Nov 1 carries Early Action and Early Decision deadlines for several colleges.
    expect(p.textContent).toMatch(/^\d deadlines in 6 days — want someone to look over your applications\?$/);
    const reminders = screen.getByText("Add to Calendar");
    expect(reminders.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(p).getByRole("button", { name: /deadlines in 6 days/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/counselors"));
  });

  it("stays quiet when the next deadline is further out, or in the demo", async () => {
    mockApi();
    seed();
    vi.setSystemTime(new Date(2026, 8, 20, 10, 0)); // Sep 20: Georgia Tech's Oct 15 EA1 is 25 days away
    window.location.hash = "#/deadlines";
    render(<App />);
    await screen.findByRole("heading", { name: "Deadlines", level: 1 });
    await settle();
    expect(prompt()).toBeNull();
    cleanup();

    vi.setSystemTime(NOW);
    localStorage.clear();
    seed(DEMO_COLLEGES, { demo: true });
    render(<App />);
    await screen.findByRole("heading", { name: "Deadlines", level: 1 });
    await settle();
    expect(prompt()).toBeNull();
  });

  it("copy", () => {
    expect(deadlinePromptText(["Early Decision"], 0)).toBe("Early Decision deadline today — want someone to look over your application?");
    expect(deadlinePromptText(["Early Decision"], 1)).toBe("Early Decision deadline tomorrow — want someone to look over your application?");
    expect(deadlinePromptText(["Early Action"], 9)).toBe("Early Action deadline in 9 days — want someone to look over your application?");
    expect(deadlinePromptText(["Early Action", "Early Decision"], 6, 3)).toBe("3 deadlines in 6 days — want someone to look over your applications?");
  });
});

describe("Research done prompt", () => {
  const finish = (colleges: College[]) =>
    mocks.run.mockImplementation(async (o) => {
      o.onEvent({ type: "planned", candidates: colleges.map((c) => ({ name: c.name, state: c.state, why: "", expected_tier: null, user_added: false })) });
      for (const c of colleges) o.onEvent({ type: "college_done", college: c });
      o.onEvent({ type: "done", colleges });
      return colleges;
    });

  it("after a reach-heavy run: counts the reaches; nothing while research runs", async () => {
    mocks.account.mockReturnValue({ sub: "u1", name: "Avery", email: null, picture: null, plan_usage: true });
    mockApi();
    seed([]);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mocks.run.mockImplementation(async (o) => {
      o.onEvent({ type: "planned", candidates: DEMO_COLLEGES.map((c) => ({ name: c.name, state: c.state, why: "", expected_tier: null, user_added: false })) });
      for (const c of DEMO_COLLEGES) o.onEvent({ type: "college_done", college: c });
      await gate;
      o.onEvent({ type: "done", colleges: DEMO_COLLEGES });
      return DEMO_COLLEGES;
    });
    window.location.hash = "#/research";
    render(<App />);
    await screen.findByText(DEMO_COLLEGES[0]!.name);
    await settle();
    expect(prompt()).toBeNull(); // still researching
    await act(async () => { release(); });
    expect(await screen.findByText("Research complete")).toBeTruthy();
    const p = await screen.findByRole("group", { name: "Get expert help" });
    const reaches = rankColleges(DEMO_COLLEGES, DEMO_PROFILE).filter((r) => r.odds.tier === "reach" || r.odds.tier === "high_reach").length;
    expect(reaches).toBeGreaterThanOrEqual(3);
    expect(p.textContent).toContain(`${reaches} of your ${DEMO_COLLEGES.length} are reaches. A counselor can help you decide where to apply early.`);
  });

  it("is absent for a balanced list without Early Decision, and in the demo", async () => {
    mocks.account.mockReturnValue({ sub: "u1", name: "Avery", email: null, picture: null, plan_usage: true });
    mockApi();
    seed([]);
    const easy = rankColleges(DEMO_COLLEGES, DEMO_PROFILE)
      .filter((r) => r.odds.tier === "safety" || r.odds.tier === "likely" || r.odds.tier === "target")
      .map((r) => ({ ...r.college, application: r.college.application ? { ...r.college.application, plans: r.college.application.plans.filter((p) => p.plan !== "ED" && p.plan !== "ED2") } : r.college.application }));
    expect(easy.length).toBeGreaterThan(0);
    finish(easy);
    window.location.hash = "#/research";
    render(<App />);
    expect(await screen.findByText("Research complete")).toBeTruthy();
    await settle();
    expect(prompt()).toBeNull();
    cleanup();

    localStorage.clear();
    seed([], { demo: true });
    finish(DEMO_COLLEGES);
    render(<App />);
    expect(await screen.findByText("Research complete")).toBeTruthy();
    await settle();
    expect(prompt()).toBeNull();
  });

  it("copy", () => {
    expect(researchPromptText(4, 12, false)).toBe("4 of your 12 are reaches. A counselor can help you decide where to apply early.");
    expect(researchPromptText(1, 12, true)).toBe("Some of your colleges offer Early Decision. A counselor can help you decide whether to apply early.");
    expect(researchPromptText(2, 12, false)).toBeNull();
  });
});

describe("Ask chip", () => {
  const signedIn = () => mocks.account.mockReturnValue({ sub: "u1", name: "Avery", email: null, picture: null, plan_usage: true });

  it("appears under an answer to an essay question (with the essays chip preselected on tap), never inside the answer", async () => {
    signedIn();
    mockApi();
    seed(DEMO_COLLEGES, {}, [{ role: "user", content: "How do I start my personal essay?" }, { role: "assistant", content: "Start with a moment, not a résumé." }]);
    window.location.hash = "#/ask";
    render(<App />);
    await screen.findByText("Start with a moment, not a résumé.");
    const p = await screen.findByRole("group", { name: "Get expert help" });
    expect(within(p).getByRole("button", { name: /Prefer to talk to a person\? See counselors/ })).toBeTruthy();
    expect(screen.getByText("Start with a moment, not a résumé.").textContent).not.toMatch(/counselor/i);
    // After the conversation, not inside it.
    const list = screen.getByRole("list");
    expect(list.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(p).getByRole("button", { name: /Prefer to talk to a person/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/counselors?specialty=essays"));
    await screen.findByRole("heading", { name: "Get expert help", level: 1 });
    expect(screen.getByRole("button", { name: "Essays" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("appears for early-decision / strategy / which-should-I questions, not for others", async () => {
    signedIn();
    mockApi();
    seed(DEMO_COLLEGES, {}, [{ role: "user", content: "Which of these should I apply early to?" }, { role: "assistant", content: "Georgia Tech EA is non-binding." }]);
    window.location.hash = "#/ask";
    render(<App />);
    await screen.findByText("Georgia Tech EA is non-binding.");
    expect(await screen.findByRole("group", { name: "Get expert help" })).toBeTruthy();
    cleanup();

    localStorage.clear();
    seed(DEMO_COLLEGES, {}, [{ role: "user", content: "Compare my top two targets" }, { role: "assistant", content: "Purdue vs NC State…" }]);
    render(<App />);
    await screen.findByText("Purdue vs NC State…");
    await settle();
    expect(prompt()).toBeNull();
  });

  it("is absent in the demo, when the directory is empty, and while an answer streams", async () => {
    signedIn();
    mockApi();
    seed(DEMO_COLLEGES, { demo: true }, [{ role: "user", content: "Help with my essay" }, { role: "assistant", content: "Demo answer." }]);
    window.location.hash = "#/ask";
    render(<App />);
    await screen.findByText("Demo answer.");
    await settle();
    expect(prompt()).toBeNull();
    cleanup();

    mockApi([]);
    localStorage.clear();
    seed(DEMO_COLLEGES, {}, [{ role: "user", content: "Help with my essay" }, { role: "assistant", content: "Real answer." }]);
    render(<App />);
    await screen.findByText("Real answer.");
    await settle();
    expect(prompt()).toBeNull();
    cleanup();

    // Streaming: the chip waits for the answer to finish.
    mockApi();
    localStorage.clear();
    seed(DEMO_COLLEGES, {}, []);
    let finishCall!: () => void;
    mocks.call.mockImplementationOnce(() => new Promise((r) => { finishCall = () => r({ text: "Done answer." }); }));
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "Who should write my recommendation letters?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Thinking…");
    expect(prompt()).toBeNull();
    await act(async () => { finishCall(); });
    await screen.findByText("Done answer.");
    expect(await screen.findByRole("group", { name: "Get expert help" })).toBeTruthy();
  });

  it("keyword match", () => {
    expect(askWantsCounselor("How do I write my essay?")).toEqual({ match: true, specialty: "essays" });
    expect(askWantsCounselor("Should I apply ED to Duke?")).toEqual({ match: true, specialty: null });
    expect(askWantsCounselor("Who should write my letters of recommendation?")).toEqual({ match: true, specialty: null });
    expect(askWantsCounselor("Which one should I choose?")).toEqual({ match: true, specialty: null });
    expect(askWantsCounselor("What's missing from my list?")).toEqual({ match: false, specialty: null });
    expect(askWantsCounselor("Where will I likely get the most merit aid?")).toEqual({ match: false, specialty: null });
  });
});

describe("Copy never implies a recommendation", () => {
  it("states counts and facts only", () => {
    const line = collegePromptText("Duke", { count: 2, matching: 1, interestLabel: "engineering", stateName: "North Carolina" });
    expect(line).toBe("Applying to Duke? 2 counselors in North Carolina help with engineering applications.");
    expect(collegePromptText("Duke", { count: 1, matching: 1, interestLabel: "STEM", stateName: "North Carolina" })).toBe("Applying to Duke? 1 counselor in North Carolina helps with STEM applications.");
    expect(collegePromptText("Duke", { count: 2, matching: 0, interestLabel: null, stateName: null })).toBe("Applying to Duke? 2 counselors can help with your application.");
    for (const t of [line, deadlinePromptText(["Early Action"], 3), researchPromptText(3, 10, true)!]) expect(t).not.toMatch(/recommend|best|top-rated|we suggest/i);
  });
});

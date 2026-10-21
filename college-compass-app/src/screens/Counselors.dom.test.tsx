// @vitest-environment jsdom
/** Counselor directory: filters from the profile, card actions, report flow, states and entry points. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEMO_COLLEGES, DEMO_PROFILE } from "@/state/fixtures";
import { LISTS_KEY, listKey, type ListMeta, type ListsIndex } from "@/state/lists";
import { NS } from "@/lib/storage";
import { StoreProvider } from "@/state/store";
import { toCounselor, type Counselor, type DirectoryApi } from "@/data/counselors";
import { COUNSELORS_NUDGE_KEY } from "@/components/CounselorsNudge";
import { Counselors } from "./Counselors";
import { App } from "@/app/App";

const SAMPLE: Counselor[] = [
  toCounselor({ id: "c1", name: "Priya Raman", title: "Independent counselor", city: "Raleigh", states: ["NC"], specialties: ["stem", "engineering", "essays"], modes: ["virtual", "in_person"], credentials: "IECA professional member; former MIT admissions reader", bio: "I help STEM-minded students tell their story.\n".repeat(8), website: "priyacollege.com", phone: "(919) 555-0100", email: "priya@example.com" })!,
  toCounselor({ id: "c2", name: "Marcus Lee", title: "Essay coach", states: ["US"], specialties: ["essays", "arts"], modes: ["virtual"], bio: "Short bio.", website: "javascript:alert(1)", phone: "call me", email: "nope" })!,
  toCounselor({ id: "c3", name: "Cher", photo_url: "https://cdn.example.com/cher.jpg", states: ["NC", "VA"], specialties: ["general"], modes: ["in_person"], city: "Durham" })!,
];

function mockApi(rows: Counselor[] | (() => Promise<Counselor[]>) = SAMPLE) {
  const list = vi.fn<DirectoryApi["list"]>(async () => (typeof rows === "function" ? rows() : rows));
  const report = vi.fn<DirectoryApi["report"]>(async () => {});
  return { api: { list, report } as DirectoryApi, list, report };
}

function seedProfile(profile = DEMO_PROFILE) {
  localStorage.setItem("cc2:profile", JSON.stringify(profile));
  localStorage.setItem("cc2:prefs", JSON.stringify({ onboardingDone: true }));
}

function seedList(colleges = DEMO_COLLEGES, demo = false) {
  const items: ListMeta[] = [{ id: "a", name: "My list", createdAt: "2026-10-01T00:00:00.000Z", onboardingDone: true, researchedAt: "2026-10-02T00:00:00.000Z", demo }];
  localStorage.setItem("cc2:" + LISTS_KEY, JSON.stringify({ v: 1, active: "a", items } satisfies ListsIndex));
  localStorage.setItem("cc2:" + listKey("a", "profile"), JSON.stringify(DEMO_PROFILE));
  if (colleges.length) localStorage.setItem("cc2:" + listKey("a", "colleges"), JSON.stringify(colleges));
}

const mount = (api: DirectoryApi | null) =>
  render(
    <StoreProvider>
      <Counselors api={api} />
    </StoreProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "#/counselors";
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any;
  Element.prototype.scrollTo = vi.fn() as any;
});
afterEach(() => cleanup());

describe("Counselors directory", () => {
  it("defaults the filters to the student's home state and majors, and shows the intro", async () => {
    seedProfile(); // NC, computer_science + film_media → stem + arts
    const { api, list } = mockApi();
    mount(api);
    expect(screen.getByText(/Counselors pay to be listed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Where: North Carolina" })).toBeTruthy();
    await waitFor(() => expect(list).toHaveBeenCalled());
    const [state, specialties] = list.mock.calls[0]!;
    expect(state).toBe("NC");
    expect([...specialties].sort()).toEqual(["arts", "stem"]);
    expect(screen.getByRole("button", { name: "STEM" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Arts & performing" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("false");
    expect(await screen.findByText("Priya Raman")).toBeTruthy();
  });

  it("without a profile: anywhere + all specialties", async () => {
    const { api, list } = mockApi();
    mount(api);
    expect(screen.getByRole("button", { name: "Where: Virtual – anywhere" })).toBeTruthy();
    await waitFor(() => expect(list).toHaveBeenCalledWith(null, [], expect.anything()));
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("changing the state and specialty chips refetches; 'All' clears specialties", async () => {
    seedProfile();
    const { api, list } = mockApi();
    mount(api);
    await screen.findByText("Priya Raman");
    fireEvent.click(screen.getByRole("button", { name: "Where: North Carolina" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Where" }));
    fireEvent.change(sheet.getByLabelText("Search states"), { target: { value: "virg" } });
    fireEvent.click(sheet.getByRole("button", { name: "Virginia" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("VA", expect.anything(), expect.anything()));
    expect(screen.getByRole("button", { name: "Where: Virginia" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("VA", [], expect.anything()));
    fireEvent.click(screen.getByRole("button", { name: "Essays" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("VA", ["essays"], expect.anything()));

    fireEvent.click(screen.getByRole("button", { name: "Where: Virginia" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Where" })).getByRole("button", { name: "Virtual – anywhere" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(null, ["essays"], expect.anything()));
  });

  it("'Virtual – anywhere' shows only counselors who work virtually", async () => {
    const inPersonOnly = toCounselor({ id: "c9", name: "Dana Fox", title: "Counselor", city: "Durham", states: ["NC"], specialties: ["general"], modes: ["in_person"], bio: "In person only." })!;
    seedProfile(); // starts on North Carolina
    const { api } = mockApi([...SAMPLE, inPersonOnly]);
    mount(api);
    expect(await screen.findByRole("article", { name: "Dana Fox" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Where: / }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Where" })).getByRole("button", { name: "Virtual – anywhere" }));
    expect(await screen.findByRole("article", { name: "Marcus Lee" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("article", { name: "Dana Fox" })).toBeNull());
  });

  it("cards: paid label, initials or photo, sanitized contact links, expandable bio", async () => {
    seedProfile(); // home state NC, so in-person counselors are shown too
    const { api } = mockApi();
    mount(api);
    const priya = within(await screen.findByRole("article", { name: "Priya Raman" }));
    expect(priya.getByText("Paid listing")).toBeTruthy();
    expect(priya.getByText("Independent counselor · Raleigh")).toBeTruthy();
    expect(priya.getByText("PR")).toBeTruthy(); // initials fallback
    expect(priya.getByText("IECA professional member; former MIT admissions reader")).toBeTruthy();
    const site = priya.getByRole("link", { name: "Visit website" });
    expect(site.getAttribute("href")).toBe("https://priyacollege.com/");
    expect(site.getAttribute("target")).toBe("_blank");
    expect(site.getAttribute("rel")).toContain("noopener");
    expect(priya.getByRole("link", { name: "Call" }).getAttribute("href")).toBe("tel:9195550100");
    expect(priya.getByRole("link", { name: "Email" }).getAttribute("href")).toBe("mailto:priya@example.com");
    expect(priya.getByText("STEM")).toBeTruthy();
    // long bio collapses
    const more = priya.getByRole("button", { name: "Read more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(priya.getByRole("button", { name: "Show less" })).toBeTruthy();

    // Bad values from the API never become links.
    const marcus = within(screen.getByRole("article", { name: "Marcus Lee" }));
    expect(marcus.queryByRole("link")).toBeNull();
    expect(marcus.getByText("Essay coach · Virtual")).toBeTruthy();
    expect(marcus.getByText("Students anywhere (virtual)")).toBeTruthy();
    expect(marcus.queryByRole("button", { name: "Read more" })).toBeNull();

    const cher = within(screen.getByRole("article", { name: "Cher" }));
    expect((screen.getByRole("article", { name: "Cher" }).querySelector("img") as HTMLImageElement).src).toBe("https://cdn.example.com/cher.jpg");
    expect(cher.getByText("North Carolina, Virginia")).toBeTruthy();
  });

  it("report flow: pick a reason, optional detail, RPC called, thank-you state", async () => {
    const { api, report } = mockApi();
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: "Report Priya Raman" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Report listing" }));
    expect(sheet.getByText(/Reports are anonymous/)).toBeTruthy();
    const send = sheet.getByRole("button", { name: "Send report" });
    expect(send).toHaveProperty("disabled", true);
    fireEvent.click(sheet.getByRole("radio", { name: "Misleading claims or credentials" }));
    fireEvent.change(sheet.getByLabelText("Details (optional)"), { target: { value: "Promises admission" } });
    expect(send).toHaveProperty("disabled", false);
    fireEvent.click(send);
    await waitFor(() => expect(report).toHaveBeenCalledWith("c1", "misleading", "Promises admission"));
    expect(await sheet.findByText("Thanks for letting us know")).toBeTruthy();
    fireEvent.click(sheet.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("report failure shows an error and keeps the form", async () => {
    const { api, report } = mockApi();
    report.mockRejectedValueOnce("offline");
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: "Report Marcus Lee" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Report listing" }));
    fireEvent.click(sheet.getByRole("radio", { name: "Something else" }));
    fireEvent.click(sheet.getByRole("button", { name: "Send report" }));
    expect(await sheet.findByText(/You're offline/)).toBeTruthy();
    expect(sheet.getByRole("button", { name: "Send report" })).toBeTruthy();
  });

  it("empty state names the state and offers virtual counselors", async () => {
    seedProfile();
    const { api, list } = mockApi([]);
    mount(api);
    expect(await screen.findByText("No counselors listed for NC yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show virtual counselors" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(null, expect.anything(), expect.anything()));
    expect(await screen.findByText("No counselors listed yet")).toBeTruthy();
  });

  it("offline and unavailable states, with retry", async () => {
    const { api, list } = mockApi();
    list.mockRejectedValueOnce("offline");
    mount(api);
    expect(await screen.findByText(/You're offline/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Priya Raman")).toBeTruthy();
    cleanup();

    const broken = mockApi();
    broken.list.mockRejectedValue("unavailable");
    mount(broken.api);
    expect(await screen.findByText(/isn't available right now/)).toBeTruthy();
  });

  it("shows unavailable when shared data is off (no API)", async () => {
    mount(null);
    expect(await screen.findByText(/isn't available right now/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("never shows a sign-up, subscribe or 'list your practice' link in the app", async () => {
    const { api } = mockApi();
    mount(api);
    await screen.findByText("Priya Raman");
    expect(document.body.textContent).not.toMatch(/list your practice|subscribe|\$29|sign up/i);
    for (const a of Array.from(document.querySelectorAll("a"))) expect(a.getAttribute("href")).not.toMatch(/counselors\//);
  });
});

describe("Entry points", () => {
  it("Settings → 'Get expert help' navigates to #/counselors", async () => {
    seedList();
    window.location.hash = "#/settings";
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Get expert help/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/counselors"));
    expect(await screen.findByText(/Counselors pay to be listed/)).toBeTruthy();
  });

  it("List tab: dismissible card below the colleges, remembered in localStorage; not in demo or empty lists", async () => {
    seedList();
    window.location.hash = "#/list";
    render(<App />);
    await screen.findByText(DEMO_COLLEGES[0]!.name);
    const card = screen.getByRole("region", { name: "Get expert help" });
    // Below the colleges: the card comes after the last college card in document order.
    const lastCollege = screen.getAllByText(/University|Institute|College/).pop()!;
    expect(lastCollege.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("region", { name: "Get expert help" })).toBeNull();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(NS + COUNSELORS_NUDGE_KEY)!)).toBe(true));
    cleanup();

    // Dismissed stays dismissed.
    render(<App />);
    await screen.findByText(DEMO_COLLEGES[0]!.name);
    expect(screen.queryByRole("region", { name: "Get expert help" })).toBeNull();
    cleanup();
    localStorage.removeItem(NS + COUNSELORS_NUDGE_KEY);

    // Demo list: hidden.
    localStorage.clear();
    seedList(DEMO_COLLEGES, true);
    render(<App />);
    await screen.findByText(DEMO_COLLEGES[0]!.name);
    expect(screen.queryByRole("region", { name: "Get expert help" })).toBeNull();
    cleanup();

    // Empty list: hidden.
    localStorage.clear();
    seedList([]);
    render(<App />);
    await screen.findByText(/Sign in to research colleges/);
    expect(screen.queryByRole("region", { name: "Get expert help" })).toBeNull();
  });

  it("the list card's link opens the directory", async () => {
    seedList();
    window.location.hash = "#/list";
    render(<App />);
    await screen.findByText(DEMO_COLLEGES[0]!.name);
    fireEvent.click(within(screen.getByRole("region", { name: "Get expert help" })).getByRole("button", { name: "Get expert help" }));
    await waitFor(() => expect(window.location.hash).toBe("#/counselors"));
    expect(await screen.findByRole("heading", { name: "Get expert help", level: 1 })).toBeTruthy();
  });

  it("Share sheet: 'Find one near you' closes the sheet and opens the directory", async () => {
    seedList();
    window.location.hash = "#/list";
    render(<App />);
    await screen.findByText(DEMO_COLLEGES[0]!.name);
    fireEvent.click(screen.getByRole("button", { name: "Share this list as a PDF" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Share this list" }));
    expect(sheet.getByText(/Need a counselor\?/)).toBeTruthy();
    fireEvent.click(sheet.getByRole("button", { name: "Find one near you" }));
    await waitFor(() => expect(window.location.hash).toBe("#/counselors"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Share this list" })).toBeNull());
  });
});

// @vitest-environment jsdom
/** Multiple lists: create (fresh / with the current answers), switch, delete, cancel a new one, demo. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { College } from "@/types";
import { DEMO_COLLEGES, DEMO_PROFILE } from "@/state/fixtures";
import { LISTS_KEY, listKey, type ListMeta, type ListsIndex } from "@/state/lists";
import { App } from "./App";

const MIT = DEMO_COLLEGES[0]!;
const DUKE = DEMO_COLLEGES[1]!;

function setHash(h: string) {
  window.location.hash = h;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
const index = (): ListsIndex => JSON.parse(localStorage.getItem("cc2:" + LISTS_KEY) || "null");
const active = (): ListMeta => index().items.find((l) => l.id === index().active)!;
const stored = (id: string, part: "profile" | "colleges" | "shortlist" | "notes" | "chat") => localStorage.getItem("cc2:" + listKey(id, part));

function seed(lists: { id: string; name: string; colleges?: College[]; profile?: boolean; done?: boolean }[], activeId = lists[0]!.id) {
  const items: ListMeta[] = lists.map((l) => ({ id: l.id, name: l.name, createdAt: "2026-10-01T00:00:00.000Z", onboardingDone: l.done ?? true, researchedAt: l.colleges?.length ? "2026-10-02T00:00:00.000Z" : null }));
  localStorage.setItem("cc2:" + LISTS_KEY, JSON.stringify({ v: 1, active: activeId, items } satisfies ListsIndex));
  for (const l of lists) {
    if (l.profile !== false) localStorage.setItem("cc2:" + listKey(l.id, "profile"), JSON.stringify(DEMO_PROFILE));
    if (l.colleges) localStorage.setItem("cc2:" + listKey(l.id, "colleges"), JSON.stringify(l.colleges));
  }
}

const openLists = async () => {
  fireEvent.click(screen.getByRole("button", { name: /your lists/ }));
  return within(await screen.findByRole("dialog", { name: "Your lists" }));
};

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "#/list";
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any;
  Element.prototype.scrollTo = vi.fn() as any;
});
afterEach(() => cleanup());

describe("Lists", () => {
  it("creates a fresh list and starts the questions from the beginning with no answers", async () => {
    seed([{ id: "a", name: "My list", colleges: [MIT] }]);
    render(<App />);
    expect(await screen.findByText(MIT.name)).toBeTruthy();
    const sheet = await openLists();
    fireEvent.click(sheet.getByRole("button", { name: "New list" }));
    const fresh = within(await screen.findByRole("dialog", { name: "New list" }));
    // The current list has answers, so copying them is the default; pick a clean start instead.
    expect(fresh.getByRole("radio", { name: /Start with answers from My list/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(fresh.getByRole("radio", { name: /Start fresh/ }));
    fireEvent.click(fresh.getByRole("button", { name: "Create list" }));

    await waitFor(() => expect(window.location.hash).toBe("#/onboarding/1"));
    expect(await screen.findByText("Where's home?")).toBeTruthy();
    expect(screen.getByText("Choose a state")).toBeTruthy(); // empty profile
    await waitFor(() => {
      expect(index().items.map((l) => l.name)).toEqual(["My list", "List 2"]);
      expect(active().name).toBe("List 2");
      expect(active().onboardingDone).toBeFalsy();
    });
    expect(stored(active().id, "profile")).toBeNull();
    // The first list is untouched.
    expect(JSON.parse(stored("a", "colleges")!)).toHaveLength(1);
  });

  it("'start with answers from' prefills the questions from the current list", async () => {
    seed([{ id: "a", name: "My list", colleges: [MIT] }]);
    render(<App />);
    await screen.findByText(MIT.name);
    const sheet = await openLists();
    fireEvent.click(sheet.getByRole("button", { name: "New list" }));
    const fresh = within(await screen.findByRole("dialog", { name: "New list" }));
    fireEvent.change(fresh.getByRole("textbox"), { target: { value: "Film · NYC" } });
    fireEvent.click(fresh.getByRole("button", { name: "Create list" }));

    await waitFor(() => expect(window.location.hash).toBe("#/onboarding/1"));
    expect(await screen.findByText("Where's home?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "North Carolina" })).toBeTruthy(); // copied home state
    expect(screen.queryByText("Choose a state")).toBeNull();
    await waitFor(() => expect(active().name).toBe("Film · NYC"));
    expect(active().named).toBe(true);
    expect(JSON.parse(stored(active().id, "profile")!).home_state).toBe("NC");
    expect(stored(active().id, "colleges")).toBeNull(); // only the answers are copied
  });

  it("switching shows the other list's colleges", async () => {
    seed([
      { id: "a", name: "Robotics · New England", colleges: [MIT] },
      { id: "b", name: "Business · NC", colleges: [DUKE] },
    ]);
    render(<App />);
    expect(await screen.findByText(MIT.name)).toBeTruthy();
    expect(screen.queryByText(DUKE.name)).toBeNull();
    const sheet = await openLists();
    expect(sheet.getByRole("radio", { name: /Robotics · New England/ }).getAttribute("aria-checked")).toBe("true");
    expect(sheet.getAllByText(/^1 college · researched Oct \d+$/)).toHaveLength(2);
    fireEvent.click(sheet.getByRole("radio", { name: /Business · NC/ }));
    expect(await screen.findByText(DUKE.name)).toBeTruthy();
    expect(screen.queryByText(MIT.name)).toBeNull();
    expect(screen.getAllByText("Business · NC").length).toBeGreaterThan(0);
    await waitFor(() => expect(index().active).toBe("b"));
  });

  it("deleting the active list removes its data and switches to another", async () => {
    seed([
      { id: "a", name: "First", colleges: [MIT] },
      { id: "b", name: "Second", colleges: [DUKE] },
    ]);
    render(<App />);
    await screen.findByText(MIT.name);
    const sheet = await openLists();
    fireEvent.click(sheet.getByRole("button", { name: "Options for First" }));
    const menu = within(await screen.findByRole("dialog", { name: "First" }));
    fireEvent.click(menu.getByRole("button", { name: "Delete" }));
    const confirm = within(await screen.findByRole("dialog", { name: "Delete First?" }));
    fireEvent.click(confirm.getByRole("button", { name: "Delete list" }));

    expect(await screen.findByText(DUKE.name)).toBeTruthy();
    await waitFor(() => {
      expect(index().items.map((l) => l.id)).toEqual(["b"]);
      expect(index().active).toBe("b");
    });
    expect(stored("a", "colleges")).toBeNull();
    expect(stored("a", "profile")).toBeNull();
  });

  it("deleting the last list leaves an empty 'My list'", async () => {
    seed([{ id: "a", name: "Only one", colleges: [MIT] }]);
    render(<App />);
    await screen.findByText(MIT.name);
    const sheet = await openLists();
    fireEvent.click(sheet.getByRole("button", { name: "Options for Only one" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Only one" })).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Delete Only one?" })).getByRole("button", { name: "Delete list" }));
    expect(await screen.findByText("Let's build your list")).toBeTruthy();
    await waitFor(() => expect(index().items.map((l) => l.name)).toEqual(["My list"]));
    expect(active().id).not.toBe("a");
  });

  it("cancelling an unfinished new list returns to the previous one", async () => {
    seed([{ id: "a", name: "My list", colleges: [MIT] }]);
    render(<App />);
    await screen.findByText(MIT.name);
    const sheet = await openLists();
    fireEvent.click(sheet.getByRole("button", { name: "New list" }));
    const fresh = within(await screen.findByRole("dialog", { name: "New list" }));
    fireEvent.click(fresh.getByRole("radio", { name: /Start fresh/ }));
    fireEvent.click(fresh.getByRole("button", { name: "Create list" }));
    expect(await screen.findByText("Where's home?")).toBeTruthy();
    await waitFor(() => expect(index().items).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const confirm = within(await screen.findByRole("dialog", { name: "Cancel List 2?" }));
    expect(confirm.getByText(/you go back to My list/)).toBeTruthy();
    fireEvent.click(confirm.getByRole("button", { name: "Cancel new list" }));

    await waitFor(() => expect(window.location.hash).toBe("#/list"));
    expect(await screen.findByText(MIT.name)).toBeTruthy();
    await waitFor(() => {
      expect(index().items.map((l) => l.id)).toEqual(["a"]);
      expect(index().active).toBe("a");
    });
  });

  it("the first list is auto-named from the answers when the questions finish; a typed name is kept", async () => {
    seed([{ id: "a", name: "Typed name" }]);
    index(); // sanity: seeded
    localStorage.setItem("cc2:" + LISTS_KEY, JSON.stringify({ ...index(), items: index().items.map((l) => ({ ...l, onboardingDone: false, named: true })) }));
    setHash("#/onboarding/17");
    render(<App />);
    expect(await screen.findByText("Colleges you already like?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Find my colleges" }));
    await waitFor(() => expect(active().onboardingDone).toBe(true));
    expect(active().name).toBe("Typed name");
    cleanup();

    localStorage.clear();
    seed([{ id: "b", name: "My list" }]);
    localStorage.setItem("cc2:" + LISTS_KEY, JSON.stringify({ ...index(), items: index().items.map((l) => ({ ...l, onboardingDone: false })) }));
    setHash("#/onboarding/17");
    render(<App />);
    expect(await screen.findByText("Colleges you already like?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Find my colleges" }));
    // DEMO_PROFILE: computer science, three regions starting with South Atlantic.
    await waitFor(() => expect(active().name).toBe("Comp sci · South Atlantic +2"));
  });

  it("demo mode is its own temporary list and leaves the real lists alone", async () => {
    seed([{ id: "a", name: "Robotics · New England", colleges: [MIT] }]);
    const before = { profile: stored("a", "profile"), colleges: stored("a", "colleges") };
    setHash("#/");
    render(<App />);
    fireEvent.click(await screen.findByText("Try demo"));
    await waitFor(() => expect(screen.getAllByText("Demo").length).toBeGreaterThan(0));
    expect(screen.getByText("Duke University")).toBeTruthy();
    await waitFor(() => {
      expect(index().items.map((l) => l.name)).toEqual(["Robotics · New England", "Demo"]);
      expect(active().demo).toBe(true);
    });
    expect(stored("a", "profile")).toBe(before.profile);
    expect(stored("a", "colleges")).toBe(before.colleges);
    const demoId = active().id;

    setHash("#/settings");
    fireEvent.click(await screen.findByRole("button", { name: /Exit demo/ }));
    await waitFor(() => {
      expect(index().items.map((l) => l.id)).toEqual(["a"]);
      expect(index().active).toBe("a");
    });
    expect(stored(demoId, "colleges")).toBeNull();
    expect(stored("a", "colleges")).toBe(before.colleges);
  });

  it("Settings offers rename, the lists sheet, new list and delete", async () => {
    seed([{ id: "a", name: "My list", colleges: [MIT] }]);
    setHash("#/settings");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /List name/ }));
    const rename = within(await screen.findByRole("dialog", { name: "Rename list" }));
    fireEvent.change(rename.getByRole("textbox", { name: "List name" }), { target: { value: "Senior year" } });
    fireEvent.click(rename.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(active().name).toBe("Senior year"));
    expect(screen.getByText("Senior year")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Your lists/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New list" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete this list" })).toBeTruthy();
  });
});

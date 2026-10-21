// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEMO_COLLEGES, DEMO_PROFILE } from "@/state/fixtures";

vi.mock("@/state/services", async () => {
  const actual = await vi.importActual<typeof import("@/state/services")>("@/state/services");
  return {
    ...actual,
    auth: {
      configured: () => true,
      account: () => null,
      ensureFresh: async () => {},
      signIn: async () => {},
      lastError: () => null,
      lastIssue: () => null,
      signOut() {},
      listModels: async () => [],
      subscribe() {
        return () => {};
      },
    },
    isConnected: () => false,
  };
});

import { StoreProvider, useStore } from "@/state/store";
import { CollegeCard } from "./CollegeCard";
import { notePreview } from "./NoteSheet";
import { CollegeDetail } from "@/screens/CollegeDetail";
import { Shortlist } from "@/screens/Shortlist";
import { LISTS_KEY, listKey } from "@/state/lists";

const MIT = DEMO_COLLEGES[0];
const LIST = "l1";
const k = (part: "profile" | "colleges" | "shortlist" | "notes") => "cc2:" + listKey(LIST, part);
const storedNotes = () => JSON.parse(localStorage.getItem(k("notes")) ?? "{}") as Record<string, string>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("cc2:" + LISTS_KEY, JSON.stringify({ v: 1, active: LIST, items: [{ id: LIST, name: "Demo", createdAt: "2026-10-20T00:00:00.000Z", named: true, demo: true, onboardingDone: true }] }));
  localStorage.setItem(k("profile"), JSON.stringify(DEMO_PROFILE));
  localStorage.setItem(k("colleges"), JSON.stringify(DEMO_COLLEGES));
  window.location.hash = "#/list";
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any;
  Element.prototype.scrollTo = vi.fn() as any;
  Element.prototype.scrollIntoView = vi.fn() as any;
});
afterEach(() => cleanup());

function Card({ compact }: { compact?: boolean }) {
  const { byId, isSaved, toggleSaved } = useStore();
  const item = byId.get(MIT.id)!;
  return <CollegeCard item={item} compact={compact} saved={isSaved(MIT.id)} onToggleSave={() => toggleSaved(MIT.id)} />;
}
const renderCard = (compact?: boolean) =>
  render(
    <StoreProvider>
      <Card compact={compact} />
    </StoreProvider>,
  );

/** Type `text` one character at a time, waiting past the sheet's 30 ms focus timer between keys. */
async function typeSlowly(el: HTMLTextAreaElement, text: string) {
  for (const ch of text) {
    fireEvent.change(el, { target: { value: el.value + ch } });
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe("notePreview", () => {
  it("takes the first non-empty line and collapses whitespace", () => {
    expect(notePreview("\n\n  Visit  Oct 14 \nemail Ms. Lee")).toBe("Visit Oct 14");
    expect(notePreview(undefined)).toBe("");
    expect(notePreview("   ")).toBe("");
  });
});

describe("College card notes", () => {
  it("shows a one-line preview when the college has a note", () => {
    localStorage.setItem(k("notes"), JSON.stringify({ [MIT.id]: "Visit Oct 14 — ask about 6-3\nEmail Ms. Lee" }));
    renderCard();
    const preview = screen.getByRole("button", { name: `Notes for ${MIT.short}: Visit Oct 14 — ask about 6-3` });
    expect(preview.textContent).toBe("Visit Oct 14 — ask about 6-3");
    expect(screen.queryByRole("button", { name: `Add a note for ${MIT.short}` })).toBeNull();
  });

  it("keeps the preview but hides the empty-state button on compact cards", () => {
    renderCard(true);
    expect(screen.queryByRole("button", { name: `Add a note for ${MIT.short}` })).toBeNull();
    cleanup();
    localStorage.setItem(k("notes"), JSON.stringify({ [MIT.id]: "Gut feeling: yes" }));
    renderCard(true);
    expect(screen.getByRole("button", { name: `Notes for ${MIT.short}: Gut feeling: yes` })).toBeTruthy();
  });

  it("'Add a note' opens the sheet; typing autosaves and keeps the sheet open and focused", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: `Add a note for ${MIT.short}` }));
    const sheet = screen.getByRole("dialog", { name: `Notes · ${MIT.short}` });
    const box = within(sheet).getByRole("textbox", { name: `Notes for ${MIT.short}` }) as HTMLTextAreaElement;
    expect(box.placeholder).toBe("Visit dates, people to email, gut feeling…");
    await waitFor(() => expect(document.activeElement).toBe(box));

    for (const ch of "Tour 10/3") {
      fireEvent.change(box, { target: { value: box.value + ch } });
      await new Promise((r) => setTimeout(r, 40));
      expect(screen.getByRole("dialog", { name: `Notes · ${MIT.short}` })).toBeTruthy();
      expect(document.activeElement).toBe(box);
    }
    expect(box.value).toBe("Tour 10/3");
    await waitFor(() => expect(storedNotes()[MIT.id]).toBe("Tour 10/3"));

    // Done closes the sheet; the card now previews the note instead of offering "Add a note".
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: `Notes for ${MIT.short}: Tour 10/3` })).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Add a note for ${MIT.short}` })).toBeNull();
  });

  it("tapping the preview reopens the sheet with the note; clearing it removes the note", async () => {
    localStorage.setItem(k("notes"), JSON.stringify({ [MIT.id]: "Email coach" }));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: `Notes for ${MIT.short}: Email coach` }));
    const box = screen.getByRole("textbox", { name: `Notes for ${MIT.short}` }) as HTMLTextAreaElement;
    expect(box.value).toBe("Email coach");
    await typeSlowly(box, "!");
    await waitFor(() => expect(storedNotes()[MIT.id]).toBe("Email coach!"));
    fireEvent.change(box, { target: { value: "" } });
    await waitFor(() => expect(storedNotes()[MIT.id]).toBeUndefined());
  });

  it("'Open <college> page' deep-links to the notes box", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: `Add a note for ${MIT.short}` }));
    fireEvent.click(screen.getByRole("button", { name: `Open ${MIT.short} page` }));
    expect(window.location.hash).toBe(`#/college/${encodeURIComponent(MIT.id)}?notes=1`);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("College page notes", () => {
  const renderDetail = () =>
    render(
      <StoreProvider>
        <CollegeDetail id={MIT.id} />
      </StoreProvider>,
    );

  it("shows 'Your notes' near the top, before 'You vs. them'", () => {
    renderDetail();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    const notesAt = headings.indexOf("Your notes");
    expect(notesAt).toBeGreaterThanOrEqual(0);
    expect(notesAt).toBeLessThan(headings.indexOf("You vs. them"));
    expect(notesAt).toBeLessThan(headings.indexOf("Programs for you"));
    expect(document.getElementById("notes")).toBeTruthy();
  });

  it("the ?notes=1 deep link scrolls to and focuses the notes box", async () => {
    window.location.hash = `#/college/${encodeURIComponent(MIT.id)}?notes=1`;
    renderDetail();
    const box = screen.getByRole("textbox", { name: "Your notes" }) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "Counselor says apply EA" } });
    await waitFor(() => expect(storedNotes()[MIT.id]).toBe("Counselor says apply EA"));
  });

  it("does not steal focus without the deep link", async () => {
    renderDetail();
    const box = screen.getByRole("textbox", { name: "Your notes" });
    await new Promise((r) => setTimeout(r, 120));
    expect(document.activeElement).not.toBe(box);
  });
});

describe("Shortlist notes", () => {
  it("tapping the note line opens the quick-note sheet instead of navigating away", async () => {
    localStorage.setItem(k("shortlist"), JSON.stringify([MIT.id]));
    window.location.hash = "#/shortlist";
    render(
      <StoreProvider>
        <Shortlist />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: `Add a note for ${MIT.short}` }));
    expect(window.location.hash).toBe("#/shortlist");
    const box = screen.getByRole("textbox", { name: `Notes for ${MIT.short}` }) as HTMLTextAreaElement;
    await typeSlowly(box, "Mom likes it");
    await waitFor(() => expect(storedNotes()[MIT.id]).toBe("Mom likes it"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: `Notes for ${MIT.short}: Mom likes it` })).toBeTruthy();
  });
});

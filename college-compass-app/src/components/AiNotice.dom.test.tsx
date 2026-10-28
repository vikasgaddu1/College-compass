// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "@/app/App";
import { AI_NOTICE_CHAT, AI_NOTICE_FULL, AI_NOTICE_SHORT, AI_NOTICE_TITLE } from "@/legal/notice";

function setHash(h: string) {
  window.location.hash = h;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

const line = () => screen.getByTestId("ai-notice-line");

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "#/";
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any;
  Element.prototype.scrollTo = vi.fn() as any;
});
afterEach(() => cleanup());

/** Demo mode: sample colleges, no sign-in, so every screen with AI-derived figures renders. */
async function enterDemo() {
  render(<App />);
  fireEvent.click(screen.getByText("Try demo"));
  await waitFor(() => expect(screen.getAllByText("Demo").length).toBeGreaterThan(0));
}

describe("AI-assistance short line", () => {
  it("wording", () => {
    expect(AI_NOTICE_TITLE).toBe("About Tierwise");
    expect(AI_NOTICE_SHORT).toBe("AI-assisted estimates — verify with each college. Not an admission decision.");
    expect(AI_NOTICE_FULL).toContain("the College Board, ACT, or the Common Application.");
  });

  it("sits at the bottom of the List tab, below the colleges, and opens the full notice", async () => {
    await enterDemo();
    const l = line();
    expect(l.textContent).toContain(AI_NOTICE_SHORT);
    // Below every college card.
    const cards = document.querySelectorAll("article.cc-card");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[cards.length - 1]!.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(l).getByRole("button", { name: `Learn more: ${AI_NOTICE_TITLE}` }));
    const sheet = await screen.findByRole("dialog", { name: AI_NOTICE_TITLE });
    expect(sheet.textContent).toContain(AI_NOTICE_FULL);
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: AI_NOTICE_TITLE })).toBeNull());
  });

  it("sits at the bottom of a college page", async () => {
    await enterDemo();
    setHash("#/college/139755");
    await waitFor(() => expect(screen.getByText("Georgia Institute of Technology")).toBeTruthy());
    const l = line();
    expect(l.textContent).toContain(AI_NOTICE_SHORT);
    const remove = screen.getByRole("button", { name: "Remove from my list" });
    expect(remove.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Ask tab: the chat variant sits under the message box", async () => {
    await enterDemo();
    setHash("#/ask");
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeTruthy());
    expect(line().textContent).toContain(AI_NOTICE_CHAT);
  });

  it("Settings → About Tierwise opens the full notice with the version", async () => {
    await enterDemo();
    setHash("#/settings");
    await waitFor(() => expect(screen.getByText("About Tierwise")).toBeTruthy());
    fireEvent.click(screen.getByText("About Tierwise"));
    const sheet = await screen.findByRole("dialog", { name: AI_NOTICE_TITLE });
    expect(sheet.textContent).toContain(AI_NOTICE_FULL);
    expect(sheet.textContent).toMatch(/Tierwise \d+\.\d+\.\d+ · Gaddu LLC/);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

function setHash(h: string) {
  window.location.hash = h;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "#/";
  // jsdom lacks matchMedia and scrollTo.
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any;
  Element.prototype.scrollTo = vi.fn() as any;
});
afterEach(() => cleanup());

describe("App", () => {
  it("shows the welcome screen with the ChatGPT button and privacy line", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /Continue with ChatGPT/ })).toBeTruthy();
    expect(screen.getByText(/stay on this phone/)).toBeTruthy();
  });

  it("enters demo mode and renders the balanced list grouped by tier", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("Try demo"));
    await waitFor(() => expect(screen.getAllByText("Your list").length).toBeGreaterThan(0));
    expect(screen.getByRole("region", { name: "High reach" }) || screen.getByText("High reach")).toBeTruthy();
    expect(screen.getByText("Duke University")).toBeTruthy();
    // Persisted under cc2:
    await waitFor(() => {
      expect(localStorage.getItem("cc2:colleges")).toBeTruthy();
      expect(JSON.parse(localStorage.getItem("cc2:prefs") || "{}").demo).toBe(true);
    });
  });

  it("opens a college detail with the odds breakdown and toggles the shortlist", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("Try demo"));
    await waitFor(() => expect(screen.getAllByText("Your list").length).toBeGreaterThan(0));
    setHash("#/college/139755");
    await waitFor(() => expect(screen.getByText("Georgia Institute of Technology")).toBeTruthy());
    expect(screen.getByText("Why these odds")).toBeTruthy();
    expect(screen.getByText("You vs. them")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Add to shortlist" })[0]);
    await waitFor(() => expect(JSON.parse(localStorage.getItem("cc2:shortlist") || "[]")).toContain("139755"));
  });

  it("gates research behind sign-in or demo", async () => {
    render(<App />);
    setHash("#/research");
    await waitFor(() => expect(screen.getByRole("button", { name: /Continue with ChatGPT/ })).toBeTruthy());
  });

  it("persists onboarding answers as a StudentProfile", async () => {
    render(<App />);
    setHash("#/onboarding/1");
    await waitFor(() => expect(screen.getByText("Where's home?")).toBeTruthy());
    fireEvent.click(screen.getByText("Choose a state"));
    fireEvent.click(await screen.findByText("North Carolina"));
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => {
      const p = JSON.parse(localStorage.getItem("cc2:profile") || "null");
      expect(p?.home_state).toBe("NC");
      expect(p?.version).toBe(1);
    });
    expect(screen.getByText(/When do you graduate/)).toBeTruthy();
  });
});

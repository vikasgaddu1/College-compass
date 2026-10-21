// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { rankColleges, buildBalancedList } from "@/engine";
import { DEMO_COLLEGES, DEMO_PROFILE } from "@/state/fixtures";
import { NS } from "@/lib/storage";
import { SHARE_OPTIONS_KEY, ShareListSheet, loadShareOptions } from "./ShareListSheet";

const sharePdf = vi.fn(async (_html: string, _fileName: string) => ({ completed: true }));
vi.mock("@/platform", () => ({ sharePdf: (html: string, fileName: string) => sharePdf(html, fileName) }));

function data() {
  const ranked = rankColleges(DEMO_COLLEGES, DEMO_PROFILE);
  const b = buildBalancedList(ranked, undefined, DEMO_PROFILE);
  const balanced = { high_reach: b.high_reach, reach: b.reach, target: b.target, likely: b.likely, safety: b.safety };
  const first = balanced.target[0] ?? balanced.reach[0];
  return { balanced, others: [], shortlist: [first.college.id], notes: { [first.college.id]: "Visited <twice> & loved it" }, firstName: first.college.name };
}

function mount(onClose = vi.fn()) {
  const d = data();
  const utils = render(<ShareListSheet open onClose={onClose} listName="Robotics Northeast" profile={DEMO_PROFILE} balanced={d.balanced} others={d.others} shortlist={d.shortlist} notes={d.notes} />);
  return { ...utils, ...d, onClose };
}

const sw = (name: string) => screen.getByRole("switch", { name }) as HTMLButtonElement;

beforeEach(() => {
  localStorage.clear();
  sharePdf.mockClear();
});
afterEach(() => cleanup());

describe("ShareListSheet", () => {
  it("shows the explainer, four toggles with the defaults, and the Create PDF button", () => {
    mount();
    expect(screen.getByRole("dialog", { name: "Share this list" })).toBeTruthy();
    expect(screen.getByText("Creates a PDF you can send by email, Messages, WhatsApp or AirDrop.")).toBeTruthy();
    expect(sw("Grades and test scores").getAttribute("aria-checked")).toBe("true");
    expect(sw("Family budget and income").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Off keeps your family's finances private")).toBeTruthy();
    expect(sw("My notes").getAttribute("aria-checked")).toBe("true");
    expect(sw("Other colleges researched").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("button", { name: "Create PDF" })).toBeTruthy();
  });

  it("remembers toggles in localStorage under share_options and restores them next time", () => {
    mount();
    fireEvent.click(sw("Family budget and income"));
    fireEvent.click(sw("My notes"));
    expect(JSON.parse(localStorage.getItem(NS + SHARE_OPTIONS_KEY)!)).toEqual({ grades: true, budget: true, notes: false, others: false });
    expect(loadShareOptions()).toEqual({ grades: true, budget: true, notes: false, others: false });
    cleanup();
    mount();
    expect(sw("Family budget and income").getAttribute("aria-checked")).toBe("true");
    expect(sw("My notes").getAttribute("aria-checked")).toBe("false");
    expect(sw("Grades and test scores").getAttribute("aria-checked")).toBe("true");
  });

  it("ignores garbage in storage", () => {
    localStorage.setItem(NS + SHARE_OPTIONS_KEY, JSON.stringify({ grades: "yes", budget: 1, notes: false, bogus: true }));
    expect(loadShareOptions()).toEqual({ grades: true, budget: false, notes: false, others: false });
    localStorage.setItem(NS + SHARE_OPTIONS_KEY, "not json");
    expect(loadShareOptions()).toEqual({ grades: true, budget: false, notes: true, others: false });
  });

  it("Create PDF builds the report with the chosen options and hands it to the platform, then closes", async () => {
    const { onClose, firstName } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Create PDF" }));
    await waitFor(() => expect(sharePdf).toHaveBeenCalledTimes(1));
    const [html, fileName] = sharePdf.mock.calls[0];
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<h1>Robotics Northeast</h1>");
    expect(html).toContain(firstName.replace(/&/g, "&amp;"));
    expect(html).toContain("Visited &lt;twice&gt; &amp; loved it"); // notes on by default, escaped
    expect(html).toContain("SAT 1420".replace(" ", "</th><td>")); // grades on by default
    expect(html).not.toContain("Family budget"); // budget off by default
    expect(html).not.toContain("Other colleges researched");
    expect(fileName).toMatch(/^College list - Robotics Northeast - \d{4}-\d{2}-\d{2}\.pdf$/);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("budget toggle on includes the family's figures; notes off drops the note", async () => {
    mount();
    fireEvent.click(sw("Family budget and income"));
    fireEvent.click(sw("My notes"));
    fireEvent.click(screen.getByRole("button", { name: "Create PDF" }));
    await waitFor(() => expect(sharePdf).toHaveBeenCalledTimes(1));
    const [html] = sharePdf.mock.calls[0];
    expect(html).toContain("Family budget / yr");
    expect(html).toContain("Est. net price / yr");
    expect(html).not.toContain("loved it");
  });

  it("stays open when the share sheet is cancelled and shows errors in a banner", async () => {
    sharePdf.mockImplementationOnce(async () => ({ completed: false }));
    const { onClose } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Create PDF" }));
    await waitFor(() => expect(sharePdf).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole("button", { name: "Create PDF" }) as HTMLButtonElement).disabled).toBe(false));
    expect(onClose).not.toHaveBeenCalled();

    sharePdf.mockImplementationOnce(async () => {
      throw new Error("Couldn't create the PDF: render failed");
    });
    fireEvent.click(screen.getByRole("button", { name: "Create PDF" }));
    await waitFor(() => expect(screen.getByText("Couldn't create the PDF: render failed")).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a busy label while the PDF is being created", async () => {
    let release: (v: { completed: boolean }) => void = () => {};
    sharePdf.mockImplementationOnce(() => new Promise((r) => (release = r)));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Create PDF" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Creating PDF…" })).toBeTruthy());
    expect((screen.getByRole("button", { name: "Creating PDF…" }) as HTMLButtonElement).disabled).toBe(true);
    release({ completed: true });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Creating PDF…" })).toBeNull());
  });

  it("disables Create PDF for an empty list", () => {
    render(<ShareListSheet open onClose={() => {}} listName="Empty" profile={DEMO_PROFILE} balanced={{ high_reach: [], reach: [], target: [], likely: [], safety: [] }} others={[]} shortlist={[]} notes={{}} />);
    expect((screen.getByRole("button", { name: "Create PDF" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Add colleges to the list first.")).toBeTruthy();
  });
});

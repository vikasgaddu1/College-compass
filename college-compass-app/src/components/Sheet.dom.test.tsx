// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Sheet } from "./Sheet";
import { StatePicker } from "@/screens/Onboarding";

function Harness() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(true);
  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Search">
      <input aria-label="q" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
    </Sheet>
  );
}

describe("Sheet with a search box (iPhone keyboard regression)", () => {
  it("keeps focus in the field while typing, even with an inline onClose", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("q") as HTMLInputElement;
    input.focus();
    for (const ch of ["n", "o", "r", "t", "h"]) {
      fireEvent.change(input, { target: { value: input.value + ch } });
      await new Promise((r) => setTimeout(r, 40)); // past the sheet's 30 ms focus timer
      expect(document.activeElement).toBe(input);
    }
    expect(input.value).toBe("north");
  });
});

describe("Home state search", () => {
  const names = () => screen.getAllByRole("button").map((b) => b.textContent ?? "").filter((t) => /[A-Z]{2}$/.test(t));

  it("filters as you type: names starting with the text first, then names containing it", async () => {
    render(<StatePicker value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /choose a state/i }));
    const input = screen.getByLabelText("Search states");
    fireEvent.change(input, { target: { value: "n" } });
    const n = names();
    expect(n[0]).toMatch(/^Nebraska/);
    expect(n.slice(0, 8).every((t) => t.startsWith("N"))).toBe(true);
    fireEvent.change(input, { target: { value: "no" } });
    const no = names();
    expect(no[0]).toMatch(/^North Carolina/);
    expect(no[1]).toMatch(/^North Dakota/);
    expect(no.some((t) => t.startsWith("Illinois"))).toBe(true);
    expect(no.indexOf(no.find((t) => t.startsWith("Illinois"))!)).toBeGreaterThan(1);
    fireEvent.change(input, { target: { value: "north carolina" } });
    expect(names()).toEqual(["North CarolinaNC"]);
  });
});

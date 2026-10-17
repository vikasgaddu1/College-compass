import { beforeEach, describe, expect, it } from "vitest";
import { createResearchCache, findFresh } from "./cache";
import { fakeCollege, installMemoryStorage } from "./test-helpers";

const NOW = Date.parse("2026-10-16T12:00:00Z");

beforeEach(() => {
  installMemoryStorage();
});

describe("research cache", () => {
  it("finds entries by any alias (normalized) and respects the 30-day freshness window", () => {
    const c = createResearchCache({ now: () => NOW });
    c.put({ ...fakeCollege("University of North Carolina at Chapel Hill", "2026-10-10T00:00:00Z"), short: "UNC Chapel Hill" }, ["UNC"]);
    expect(c.get("the university of north carolina at chapel hill")?.short).toBe("UNC Chapel Hill");
    expect(c.get("unc chapel hill")).not.toBeNull();
    expect(c.get("UNC")).not.toBeNull();
    expect(c.get("Duke")).toBeNull();
    const later = createResearchCache({ now: () => NOW + 40 * 86400_000 });
    expect(later.get("UNC")).toBeNull();
    expect(localStorage.getItem("cc2:research_cache")).toBeTruthy();
  });

  it("replaces entries sharing an alias and evicts least-recently-used beyond the cap", () => {
    let t = NOW;
    const c = createResearchCache({ now: () => t, maxEntries: 3 });
    for (const n of ["A College", "B College", "C College"]) {
      t += 1000;
      c.put(fakeCollege(n, "2026-10-10T00:00:00Z"));
    }
    t += 1000;
    c.get("A College"); // A is now most recent
    t += 1000;
    c.put(fakeCollege("D College", "2026-10-10T00:00:00Z"));
    expect(c.all().map((x) => x.name).sort()).toEqual(["A College", "C College", "D College"]);
    t += 1000;
    c.put({ ...fakeCollege("D College", "2026-10-15T00:00:00Z"), admit_rate: 0.1 });
    expect(c.all()).toHaveLength(3);
    expect(c.get("D College")?.admit_rate).toBe(0.1);
  });

  it("trims to the size cap", () => {
    const c = createResearchCache({ now: () => NOW, maxChars: 4000 });
    for (let i = 0; i < 20; i++) c.put(fakeCollege(`College ${i}`, "2026-10-10T00:00:00Z"));
    expect(localStorage.getItem("cc2:research_cache")!.length).toBeLessThanOrEqual(4000);
    expect(c.all().length).toBeGreaterThan(0);
  });

  it("findFresh picks the newest fresh match from a plain list", () => {
    const list = [fakeCollege("Elon University", "2026-10-01T00:00:00Z"), fakeCollege("Elon University", "2026-10-12T00:00:00Z"), fakeCollege("Old U", "2026-01-01T00:00:00Z")];
    expect(findFresh(list, "elon university", NOW)?.researched_at).toBe("2026-10-12T00:00:00Z");
    expect(findFresh(list, "Old U", NOW)).toBeNull();
    expect(findFresh(undefined, "x", NOW)).toBeNull();
  });
});

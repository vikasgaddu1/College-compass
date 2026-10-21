// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { exportAll, importAll, load } from "@/lib/storage";
import { DEMO_COLLEGES, DEMO_PROFILE } from "./fixtures";
import { defaultProfile } from "./catalog";
import { LISTS_KEY, autoListName, listKey, loadIndex, nextListName, reconcileLists, uniqueName, type ListsIndex } from "./lists";

const raw = (key: string) => localStorage.getItem("cc2:" + key);
const seedFlat = () => {
  localStorage.setItem("cc2:profile", JSON.stringify(DEMO_PROFILE));
  localStorage.setItem("cc2:colleges", JSON.stringify(DEMO_COLLEGES));
  localStorage.setItem("cc2:shortlist", JSON.stringify([DEMO_COLLEGES[0]!.id]));
  localStorage.setItem("cc2:notes", JSON.stringify({ [DEMO_COLLEGES[0]!.id]: "visit in May" }));
  localStorage.setItem("cc2:chat", JSON.stringify([{ role: "user", content: "hi" }]));
  localStorage.setItem("cc2:prefs", JSON.stringify({ sort: "odds", onboardingDone: true, researchedAt: "2026-10-01T12:00:00.000Z" }));
};
const snapshot = () => {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    out[k] = localStorage.getItem(k)!;
  }
  return out;
};

beforeEach(() => localStorage.clear());

describe("reconcileLists: migration from the flat keys", () => {
  it("fresh install: one empty 'My list', nothing else written", () => {
    const idx = reconcileLists();
    expect(idx.items).toHaveLength(1);
    expect(idx.items[0]!.name).toBe("My list");
    expect(idx.active).toBe(idx.items[0]!.id);
    expect(idx.items[0]!.onboardingDone).toBeFalsy();
    expect(JSON.parse(raw(LISTS_KEY)!)).toEqual(idx);
    expect(raw(listKey(idx.active, "profile"))).toBeNull();
  });

  it("existing data moves losslessly into the first list, with the per-list flags out of prefs", () => {
    seedFlat();
    const idx = reconcileLists();
    expect(idx.items).toHaveLength(1);
    const l = idx.items[0]!;
    expect(l.name).toBe("My list");
    expect(l.onboardingDone).toBe(true);
    expect(l.researchedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(load(listKey(l.id, "profile"), null)).toEqual(DEMO_PROFILE);
    expect(load(listKey(l.id, "colleges"), [])).toEqual(DEMO_COLLEGES);
    expect(load(listKey(l.id, "shortlist"), [])).toEqual([DEMO_COLLEGES[0]!.id]);
    expect(load(listKey(l.id, "notes"), {})).toEqual({ [DEMO_COLLEGES[0]!.id]: "visit in May" });
    expect(load(listKey(l.id, "chat"), [])).toEqual([{ role: "user", content: "hi" }]);
    // Flat keys gone; unrelated prefs kept, per-list flags removed.
    for (const k of ["profile", "colleges", "shortlist", "notes", "chat"]) expect(raw(k)).toBeNull();
    expect(load("prefs", {})).toEqual({ sort: "odds" });
  });

  it("storage full: frees the research cache and retries; never deletes data it couldn't copy", () => {
    seedFlat();
    localStorage.setItem("cc2:research_cache", JSON.stringify({ big: "x" }));
    const real = Storage.prototype.setItem;
    let failing = true;
    Storage.prototype.setItem = function (k: string, v: string) {
      // Writes of list data fail until the research cache has been freed.
      if (failing && k.startsWith("cc2:list:") && localStorage.getItem("cc2:research_cache") !== null) throw new Error("QuotaExceededError");
      return real.call(this, k, v);
    };
    try {
      const idx = reconcileLists();
      expect(raw("research_cache")).toBeNull();
      expect(raw("profile")).toBeNull();
      expect(JSON.parse(raw(listKey(idx.active, "notes"))!)).toEqual({ [DEMO_COLLEGES[0]!.id]: "visit in May" });

      // Now writes keep failing even after freeing space: the original data must stay put.
      localStorage.clear();
      seedFlat();
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k.startsWith("cc2:list:")) throw new Error("QuotaExceededError");
        return real.call(this, k, v);
      };
      const before = raw("colleges");
      reconcileLists();
      expect(raw("colleges")).toBe(before);
      expect(raw("notes")).not.toBeNull();
      expect(Object.keys(snapshot()).some((k) => k.startsWith("cc2:list:"))).toBe(false);

      // Space is back: the next launch brings the data in as its own list.
      Storage.prototype.setItem = real;
      failing = false;
      const after = reconcileLists();
      expect(raw("colleges")).toBeNull();
      expect(JSON.parse(raw(listKey(after.active, "colleges"))!)).toHaveLength(DEMO_COLLEGES.length);
    } finally {
      Storage.prototype.setItem = real;
    }
  });

  it("storage full when saving the index: keeps the original data and drops the copy", () => {
    seedFlat();
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === "cc2:" + LISTS_KEY && v.includes('"items":[{')) throw new Error("QuotaExceededError");
      return real.call(this, k, v);
    };
    try {
      const before = { profile: raw("profile"), colleges: raw("colleges"), notes: raw("notes"), chat: raw("chat"), shortlist: raw("shortlist") };
      reconcileLists();
      expect({ profile: raw("profile"), colleges: raw("colleges"), notes: raw("notes"), chat: raw("chat"), shortlist: raw("shortlist") }).toEqual(before);
      expect(Object.keys(snapshot()).some((k) => k.startsWith("cc2:list:"))).toBe(false);
    } finally {
      Storage.prototype.setItem = real;
    }
    // Next launch with space: migrates normally.
    const idx = reconcileLists();
    expect(raw("colleges")).toBeNull();
    expect(JSON.parse(raw(listKey(idx.active, "colleges"))!)).toHaveLength(DEMO_COLLEGES.length);
  });

  it("re-running is a no-op", () => {
    seedFlat();
    reconcileLists();
    const before = snapshot();
    const again = reconcileLists();
    expect(snapshot()).toEqual(before);
    expect(again).toEqual(loadIndex());
  });

  it("a demo session in progress becomes a 'Demo' list flagged as such", () => {
    seedFlat();
    localStorage.setItem("cc2:prefs", JSON.stringify({ demo: true, onboardingDone: true, researchedAt: "2026-10-01T12:00:00.000Z" }));
    const idx = reconcileLists();
    expect(idx.items[0]!.name).toBe("Demo");
    expect(idx.items[0]!.demo).toBe(true);
    expect(load("prefs", {})).toEqual({});
  });

  it("finishes a migration that was cut off after the list keys were written but before the index", () => {
    seedFlat();
    // Simulate: list keys written under an id that never made it into an index.
    localStorage.setItem("cc2:list:orphan1:profile", JSON.stringify(DEMO_PROFILE));
    localStorage.setItem("cc2:list:orphan1:colleges", JSON.stringify(DEMO_COLLEGES));
    const idx = reconcileLists();
    expect(idx.items).toHaveLength(1);
    expect(load(listKey(idx.active, "colleges"), [])).toEqual(DEMO_COLLEGES);
    expect(raw("list:orphan1:profile")).toBeNull(); // orphan cleaned up
    expect(raw("profile")).toBeNull();
  });

  it("finishes a migration that was cut off after the index was written but before the flat keys were removed", () => {
    seedFlat();
    const idx = reconcileLists();
    seedFlat(); // the flat keys come back as if their removal never happened
    const again = reconcileLists();
    expect(again.items).toHaveLength(1);
    expect(again.items[0]!.id).toBe(idx.items[0]!.id);
    expect(raw("profile")).toBeNull();
    expect(load("prefs", {})).toEqual({ sort: "odds" });
  });

  it("repairs an index whose active id is missing and drops data of lists not in the index", () => {
    const bad: ListsIndex = { v: 1, active: "nope", items: [{ id: "a1", name: "A", createdAt: "2026-01-01" }] };
    localStorage.setItem("cc2:lists", JSON.stringify(bad));
    localStorage.setItem("cc2:list:zz:colleges", "[]");
    const idx = reconcileLists();
    expect(idx.active).toBe("a1");
    expect(raw("list:zz:colleges")).toBeNull();
  });
});

describe("import of backups", () => {
  it("an old (flat) export imports as its own list next to the existing ones and becomes active", () => {
    seedFlat();
    const oldExport = exportAll(); // flat keys, as an older version wrote them
    localStorage.clear();
    const first = reconcileLists(); // this phone already uses lists
    expect(importAll(oldExport)).toBeGreaterThan(0);
    const idx = reconcileLists();
    expect(idx.items.map((l) => l.name)).toEqual(["My list", "Imported"]);
    expect(idx.active).not.toBe(first.active);
    expect(load(listKey(idx.active, "colleges"), [])).toEqual(DEMO_COLLEGES);
    expect(idx.items[1]!.onboardingDone).toBe(true);
    expect(raw("profile")).toBeNull();
  });

  it("a current export round-trips the index and every list", () => {
    seedFlat();
    const idx = reconcileLists();
    const json = exportAll();
    localStorage.clear();
    expect(importAll(json)).toBeGreaterThan(0);
    const after = reconcileLists();
    expect(after).toEqual(idx);
    expect(load(listKey(after.active, "notes"), {})).toEqual({ [DEMO_COLLEGES[0]!.id]: "visit in May" });
  });
});

describe("names", () => {
  it("auto-names from the primary major and where the student wants to be", () => {
    const p = { ...defaultProfile(), home_state: "NC" };
    expect(autoListName({ ...p, majors: ["robotics_mechatronics"], regions: ["new_england"] })).toBe("Robotics · New England");
    expect(autoListName({ ...p, majors: ["business"], regions: [] })).toBe("Business · NC");
    expect(autoListName({ ...p, majors: ["nursing", "public_health"], regions: ["south_atlantic", "mid_atlantic"] })).toBe("Nursing · South Atlantic +1");
    expect(autoListName({ ...p, majors: ["biology"], regions: ["midwest", "pacific"] })).toBe("Biology · Midwest & Pacific");
    expect(autoListName({ ...p, majors: ["computer_science"], regions: ["pacific", "mountain", "southwest"] })).toBe("Comp sci · Pacific +2");
    expect(autoListName({ ...p, majors: ["undecided"], regions: [] })).toBe("Undecided · NC");
    expect(autoListName({ ...p, home_state: "", majors: [], regions: [] })).toBe("My list");
    for (const majors of [["languages_international"], ["political_science_law"], ["environmental_science"]] as const) {
      expect(autoListName({ ...p, majors: [...majors], regions: ["south_atlantic"] }).length).toBeLessThanOrEqual(30);
    }
  });

  it("suggests List N and keeps names unique", () => {
    const items = [
      { id: "a", name: "My list", createdAt: "" },
      { id: "b", name: "List 2", createdAt: "" },
    ];
    expect(nextListName(items)).toBe("List 3");
    expect(uniqueName("List 2", items)).toBe("List 2 2");
    expect(uniqueName("List 2", items, "b")).toBe("List 2");
    expect(uniqueName("Fresh", items)).toBe("Fresh");
  });
});

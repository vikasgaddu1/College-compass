import { beforeEach, describe, expect, it } from "vitest";
import { clearAll, exportAll, importAll, load, remove, save } from "./storage";

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true, writable: true });
});

describe("storage", () => {
  it("round-trips values under the cc2: namespace", () => {
    expect(save("profile", { a: 1 })).toBe(true);
    expect(localStorage.getItem("cc2:profile")).toBe('{"a":1}');
    expect(load("profile", null)).toEqual({ a: 1 });
  });

  it("returns the fallback for missing or corrupt values", () => {
    expect(load("nope", 42)).toBe(42);
    localStorage.setItem("cc2:bad", "{not json");
    expect(load("bad", "fb")).toBe("fb");
  });

  it("remove deletes a key", () => {
    save("k", 1);
    remove("k");
    expect(load("k", "gone")).toBe("gone");
  });

  it("never throws when storage throws", () => {
    const boom = {
      get length(): number { throw new Error("denied"); },
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("quota"); },
      removeItem() { throw new Error("denied"); },
      key() { throw new Error("denied"); },
      clear() { throw new Error("denied"); },
    };
    Object.defineProperty(globalThis, "localStorage", { value: boom, configurable: true, writable: true });
    expect(load("x", "fb")).toBe("fb");
    expect(save("x", 1)).toBe(false);
    expect(() => remove("x")).not.toThrow();
    expect(() => clearAll()).not.toThrow();
    expect(JSON.parse(exportAll()).data).toEqual({});
    expect(importAll('{"app":"college-compass","data":{"a":1}}')).toBe(0);
  });

  it("exportAll / importAll / clearAll only touch cc2: keys", () => {
    save("a", 1);
    save("b", { x: [1, 2] });
    localStorage.setItem("other", "keep");
    const dump = exportAll();
    expect(JSON.parse(dump).data).toEqual({ a: 1, b: { x: [1, 2] } });

    clearAll();
    expect(load("a", null)).toBeNull();
    expect(localStorage.getItem("other")).toBe("keep");

    expect(importAll(dump)).toBe(2);
    expect(load("b", null)).toEqual({ x: [1, 2] });
  });

  it("importAll rejects invalid input", () => {
    expect(importAll("garbage")).toBe(0);
    expect(importAll('{"app":"other","data":{"a":1}}')).toBe(0);
    expect(importAll("null")).toBe(0);
  });
});

import { describe as d2, it as i2, expect as e2, beforeEach as be2 } from "vitest";
import { exportAll as ex2, save as sv2, clearAll as ca2 } from "./storage";
d2("export never includes credentials", () => {
  be2(() => ca2());
  i2("skips ChatGPT tokens and developer keys", () => {
    if (typeof localStorage === "undefined") return;
    sv2("chatgpt", { access_token: "secret" });
    sv2("dev_openai_key", "sk-test");
    sv2("profile", { home_state: "NC" });
    const out = JSON.parse(ex2());
    e2(out.data.profile).toBeTruthy();
    e2(out.data.chatgpt).toBeUndefined();
    e2(out.data.dev_openai_key).toBeUndefined();
  });
});

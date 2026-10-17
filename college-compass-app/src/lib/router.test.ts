import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { back, buildHref, matchRoute, navigate, parseHash, parseRoute } from "./router";

describe("parseHash", () => {
  it("normalizes empty / bare hashes to root", () => {
    expect(parseHash("")).toEqual({ path: "/", query: {} });
    expect(parseHash("#")).toEqual({ path: "/", query: {} });
    expect(parseHash("#/")).toEqual({ path: "/", query: {} });
  });
  it("adds a leading slash and strips trailing slashes", () => {
    expect(parseHash("#list/").path).toBe("/list");
    expect(parseHash("#/shortlist///").path).toBe("/shortlist");
  });
  it("parses query strings", () => {
    expect(parseHash("#/list?sort=fit&q=mit%20x")).toEqual({ path: "/list", query: { sort: "fit", q: "mit x" } });
  });
});

describe("parseRoute / matchRoute", () => {
  it("matches static routes", () => {
    for (const p of ["/", "/list", "/shortlist", "/ask", "/settings", "/auth/callback"]) {
      expect(parseRoute("#" + p).pattern).toBe(p);
    }
  });
  it("extracts params", () => {
    expect(parseRoute("#/onboarding/gpa").params).toEqual({ step: "gpa" });
    const r = parseRoute("#/college/190150?tab=cost");
    expect(r.pattern).toBe("/college/:id");
    expect(r.params).toEqual({ id: "190150" });
    expect(r.query).toEqual({ tab: "cost" });
  });
  it("decodes params and tolerates bad escapes", () => {
    expect(parseRoute("#/college/a%20b").params.id).toBe("a b");
    expect(parseRoute("#/college/%E0%A4%A").params.id).toBe("%E0%A4%A");
  });
  it("returns null pattern for unknown paths", () => {
    expect(parseRoute("#/nope").pattern).toBeNull();
    expect(matchRoute("/college")).toBeNull();
    expect(matchRoute("/college/1/extra")).toBeNull();
  });
  it("handles an OAuth-style callback with query", () => {
    const r = parseRoute("#/auth/callback?code=abc&state=xyz");
    expect(r.pattern).toBe("/auth/callback");
    expect(r.query).toEqual({ code: "abc", state: "xyz" });
  });
});

describe("buildHref", () => {
  it("builds hash links with optional query", () => {
    expect(buildHref("/list")).toBe("#/list");
    expect(buildHref("college/5", { tab: "odds", skip: null })).toBe("#/college/5?tab=odds");
  });
});

describe("navigate / back", () => {
  const listeners = new Map<string, () => void>();
  const win = {
    location: { hash: "", pathname: "/College-compass/app/", search: "" },
    history: {
      length: 2,
      state: null as unknown,
      back: vi.fn(),
      replaceState: vi.fn((_s: unknown, _t: string, url: string) => {
        win.location.hash = url.slice(url.indexOf("#"));
      }),
    },
    dispatchEvent: vi.fn((e: Event) => {
      listeners.get(e.type)?.();
      return true;
    }),
  };

  beforeEach(() => {
    vi.stubGlobal("window", win);
    vi.stubGlobal("HashChangeEvent", class extends Event { constructor(t: string) { super(t); } });
    win.location.hash = "";
    win.history.length = 2;
    win.history.back.mockClear();
    win.history.replaceState.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("push navigation sets location.hash", () => {
    navigate("/list");
    expect(win.location.hash).toBe("#/list");
    navigate("#/ask");
    expect(win.location.hash).toBe("#/ask");
    navigate("settings");
    expect(win.location.hash).toBe("#/settings");
  });

  it("replace navigation uses replaceState and fires hashchange", () => {
    const cb = vi.fn();
    listeners.set("hashchange", cb);
    navigate("/shortlist", { replace: true });
    expect(win.history.replaceState).toHaveBeenCalledOnce();
    expect(win.location.hash).toBe("#/shortlist");
    expect(cb).toHaveBeenCalled();
    listeners.clear();
  });

  it("back() uses history when available, else falls back", () => {
    back();
    expect(win.history.back).toHaveBeenCalledOnce();
    win.history.length = 1;
    back("/list");
    expect(win.location.hash).toBe("#/list");
  });
});

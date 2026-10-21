import { describe, expect, it, vi } from "vitest";
import {
  LOOPBACK_PREFERRED_PORT,
  NATIVE_SCHEME,
  closeAuthBrowser,
  createLoopbackSession,
  loopbackRedirectUri,
  onAuthBrowserFinished,
  parseLoopbackCallback,
  startLoopback,
  supportsSelfServeSignIn,
  type LoopbackAuthPlugin,
  isAuthCallbackUrl,
  isNative,
  onAuthRedirect,
  parseAuthCallback,
  sharePdf,
  webPrintHtml,
} from "./index";

describe("platform (node / web fallbacks)", () => {
  it("is not native under node", () => {
    expect(isNative()).toBe(false);
    expect(NATIVE_SCHEME).toBe("collegecompass");
  });

  it("onAuthRedirect is a no-op off-device and returns a disposer", () => {
    const off = onAuthRedirect(() => {
      throw new Error("must not fire");
    });
    expect(typeof off).toBe("function");
    off();
  });

  it("closeAuthBrowser resolves off-device", async () => {
    await expect(closeAuthBrowser()).resolves.toBeUndefined();
  });

  it("sharePdf never throws without a DOM: resolves completed=false", async () => {
    await expect(sharePdf("<!doctype html><p>x</p>", "College list - 2026-10-20.pdf")).resolves.toEqual({ completed: false });
    await expect(webPrintHtml("<p>x</p>", "x.pdf")).resolves.toEqual({ completed: false });
  });
});

describe("isAuthCallbackUrl", () => {
  it("accepts the callback with query, fragment, trailing slash or bare", () => {
    expect(isAuthCallbackUrl("collegecompass://auth/callback?code=a&state=b")).toBe(true);
    expect(isAuthCallbackUrl("collegecompass://auth/callback/?code=a")).toBe(true);
    expect(isAuthCallbackUrl("collegecompass://auth/callback#x")).toBe(true);
    expect(isAuthCallbackUrl("collegecompass://auth/callback")).toBe(true);
    expect(isAuthCallbackUrl("CollegeCompass://AUTH/Callback?code=1")).toBe(true);
  });

  it("rejects other schemes, hosts, paths and empties", () => {
    expect(isAuthCallbackUrl("https://vikasgaddu1.github.io/College-compass/app/callback.html?code=a")).toBe(false);
    expect(isAuthCallbackUrl("collegecompass://other/callback?code=a")).toBe(false);
    expect(isAuthCallbackUrl("collegecompass://auth/callbackx?code=a")).toBe(false);
    expect(isAuthCallbackUrl("collegecompass://auth/callback/evil?code=a")).toBe(false);
    expect(isAuthCallbackUrl("evil://collegecompass://auth/callback?code=a")).toBe(false);
    expect(isAuthCallbackUrl("")).toBe(false);
    expect(isAuthCallbackUrl(null)).toBe(false);
    expect(isAuthCallbackUrl(undefined)).toBe(false);
  });
});

describe("parseAuthCallback", () => {
  it("returns decoded query params", () => {
    const q = parseAuthCallback("collegecompass://auth/callback?code=ab%2Bc&state=s1&native=1")!;
    expect(q.get("code")).toBe("ab+c");
    expect(q.get("state")).toBe("s1");
    expect(q.get("native")).toBe("1");
  });

  it("ignores the fragment and handles errors from the provider", () => {
    const q = parseAuthCallback("collegecompass://auth/callback?error=access_denied&error_description=No%20thanks#frag")!;
    expect(q.get("error")).toBe("access_denied");
    expect(q.get("error_description")).toBe("No thanks");
    expect(q.has("frag")).toBe(false);
  });

  it("returns empty params for a bare callback and null for non-matches", () => {
    expect([...parseAuthCallback("collegecompass://auth/callback")!.keys()]).toEqual([]);
    expect(parseAuthCallback("collegecompass://nope?code=1")).toBeNull();
    expect(parseAuthCallback(undefined)).toBeNull();
  });
});

describe("self-serve loopback helpers", () => {
  it("builds the 127.0.0.1 redirect URI (only the port varies)", () => {
    expect(loopbackRedirectUri(1455)).toBe("http://127.0.0.1:1455/auth/callback");
    expect(loopbackRedirectUri(50123)).toBe("http://127.0.0.1:50123/auth/callback");
    expect(() => loopbackRedirectUri(0)).toThrow();
    expect(() => loopbackRedirectUri(70000)).toThrow();
    expect(() => loopbackRedirectUri(1.5)).toThrow();
    expect(LOOPBACK_PREFERRED_PORT).toBe(1455);
  });

  it("parses loopback callbacks and rejects anything else", () => {
    const q = parseLoopbackCallback("http://127.0.0.1:1455/auth/callback?code=a%2Bb&state=s&client_id=oaiapp_1", 1455)!;
    expect(q.get("code")).toBe("a+b");
    expect(q.get("client_id")).toBe("oaiapp_1");
    expect(parseLoopbackCallback("http://127.0.0.1:1455/auth/callback?error=access_denied")!.get("error")).toBe("access_denied");
    expect(parseLoopbackCallback("http://127.0.0.1:1456/auth/callback?code=a", 1455)).toBeNull();
    expect(parseLoopbackCallback("http://localhost:1455/auth/callback?code=a")).toBeNull();
    expect(parseLoopbackCallback("https://127.0.0.1:1455/auth/callback?code=a")).toBeNull();
    expect(parseLoopbackCallback("http://127.0.0.1:1455/auth/other?code=a")).toBeNull();
    expect(parseLoopbackCallback("http://u:p@127.0.0.1:1455/auth/callback?code=a")).toBeNull();
    expect(parseLoopbackCallback("not a url")).toBeNull();
    expect(parseLoopbackCallback(null)).toBeNull();
  });

  it("is web-only off-device: no self-serve, startLoopback throws", async () => {
    expect(supportsSelfServeSignIn()).toBe(false);
    await expect(startLoopback()).rejects.toThrow(/native/);
    const off = onAuthBrowserFinished(() => { throw new Error("must not fire"); });
    off();
  });
});

describe("createLoopbackSession", () => {
  function fakePlugin(port = 1455) {
    let cb: ((e: { url: string }) => void) | null = null;
    const order: string[] = [];
    const remove = vi.fn(async () => {});
    const plugin: LoopbackAuthPlugin = {
      addListener: vi.fn(async (_ev, fn) => { order.push("listen"); cb = fn; return { remove }; }),
      start: vi.fn(async () => { order.push("start"); return { port }; }),
      stop: vi.fn(async () => {}),
    };
    return { plugin, order, remove, emit: (url: string) => cb?.({ url }) };
  }

  it("listens before starting and resolves next() with the first valid callback", async () => {
    const f = fakePlugin(50123);
    const s = await createLoopbackSession(f.plugin);
    expect(f.order).toEqual(["listen", "start"]);
    expect(f.plugin.start).toHaveBeenCalledWith({ preferredPort: 1455 });
    expect(s.redirectUri).toBe("http://127.0.0.1:50123/auth/callback");
    const n = s.next();
    f.emit("http://127.0.0.1:1455/auth/callback?code=wrong-port");
    f.emit("http://127.0.0.1:50123/auth/callback?code=c1&state=s1");
    f.emit("http://127.0.0.1:50123/auth/callback?code=c2&state=s2");
    expect((await n).get("code")).toBe("c1");
    expect((await s.next()).get("code")).toBe("c1"); // buffered
    await s.stop();
    await s.stop();
    expect(f.remove).toHaveBeenCalledTimes(1);
    expect(f.plugin.stop).toHaveBeenCalledTimes(1);
  });

  it("removes the listener when start fails or reports a bad port", async () => {
    const f = fakePlugin();
    (f.plugin.start as any).mockRejectedValueOnce(new Error("in use"));
    await expect(createLoopbackSession(f.plugin)).rejects.toThrow(/in use/);
    expect(f.remove).toHaveBeenCalled();
    const g = fakePlugin(0);
    await expect(createLoopbackSession(g.plugin)).rejects.toThrow(/port/);
    expect(g.plugin.stop).toHaveBeenCalled();
  });
});

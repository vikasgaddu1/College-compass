import { describe, expect, it } from "vitest";
import {
  NATIVE_SCHEME,
  closeAuthBrowser,
  isAuthCallbackUrl,
  isNative,
  onAuthRedirect,
  parseAuthCallback,
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

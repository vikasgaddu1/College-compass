import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { callbackTarget } from "./callback";

const html = readFileSync(fileURLToPath(new URL("../../public/callback.html", import.meta.url)), "utf8");

function inlinedTarget(): (search: string) => string {
  const m = html.match(/function ccCallbackTarget\(search\) \{[\s\S]*?\n  \}/);
  if (!m) throw new Error("ccCallbackTarget not found in callback.html");
  return new Function(`${m[0]}; return ccCallbackTarget;`)() as (s: string) => string;
}

const CASES = [
  "?code=abc&state=xyz",
  "?code=abc&state=xyz.n",
  "?state=xyz.n&error=access_denied&error_description=User%20cancelled",
  "?error=access_denied&state=s",
  "code=1&state=q.n",
  "",
  "?state=n",
  "?state=abc.nn",
];

describe("callback routing", () => {
  it("forwards native sign-ins (state ending in .n) to the custom scheme", () => {
    expect(callbackTarget("?code=abc&state=xyz.n")).toBe("collegecompass://auth/callback?code=abc&state=xyz.n");
    expect(callbackTarget("?state=s.n&error=access_denied")).toBe("collegecompass://auth/callback?state=s.n&error=access_denied");
  });

  it("forwards web sign-ins to the SPA hash route with the query intact", () => {
    expect(callbackTarget("?code=abc&state=xyz")).toBe("./#/auth/callback?code=abc&state=xyz");
    expect(callbackTarget("")).toBe("./#/auth/callback");
    expect(callbackTarget("?state=abc.nn")).toBe("./#/auth/callback?state=abc.nn");
  });

  it("callback.html inlines exactly the same logic", () => {
    const fn = inlinedTarget();
    for (const c of CASES) expect(fn(c)).toBe(callbackTarget(c));
  });

  it("callback.html loads nothing external and hides the referrer", () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).toContain('name="referrer" content="no-referrer"');
    expect(html).toContain("Open Tierwise");
    expect(html).toContain("location.replace(target)");
  });
});

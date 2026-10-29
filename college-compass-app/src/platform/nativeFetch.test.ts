import { describe, expect, it, vi } from "vitest";
import { nativeFetch, type NativeHttpPlugin } from "./index";

const sse = 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n';

function plugin(request: NativeHttpPlugin["request"]) {
  const cancel = vi.fn(async () => {});
  const extra = {
    requestNotificationPermission: vi.fn(async () => ({ granted: true })), notifyWhenDone: vi.fn(async () => {}), cancelNotify: vi.fn(async () => {}),
    beginRun: vi.fn(async () => {}), endRun: vi.fn(async () => {}), takeOrphans: vi.fn(async () => ({ orphans: [] })),
  };
  return { http: { request: vi.fn(request), cancel, ...extra } as NativeHttpPlugin & { request: ReturnType<typeof vi.fn> }, cancel };
}

describe("nativeFetch (NativeHttp-backed fetch)", () => {
  it("sends id, method, headers and string body, and returns a readable Response", async () => {
    const { http } = plugin(async () => ({ status: 200, headers: { "Content-Type": "text/event-stream", "x-request-id": "req_1" }, data: sse }));
    const res = await nativeFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
      ccTag: "research:run1:x",
    } as RequestInit, http);
    const opts = (http.request.mock.calls[0] as any[])[0];
    expect(opts).toMatchObject({ url: "https://api.openai.com/v1/responses", method: "POST", body: '{"a":1}', background: true, tag: "research:run1:x" });
    expect(typeof opts.id).toBe("string");
    expect(opts.headers).toMatchObject({ authorization: "Bearer t", "content-type": "application/json" });
    expect(res.ok).toBe(true);
    expect(res.headers.get("x-request-id")).toBe("req_1");
    expect(res.body).toBeTruthy();
    expect(await res.text()).toBe(sse);
  });

  it("keeps error statuses and bodies", async () => {
    const { http } = plugin(async () => ({ status: 429, headers: {}, data: '{"error":{"code":"rate_limit_exceeded"}}' }));
    const res = await nativeFetch("https://api.openai.com/v1/models", {}, http);
    expect((http.request.mock.calls[0] as any[])[0].background).toBe(false);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "rate_limit_exceeded" } });
  });

  it("exposes the final URL after redirects as Response.url, so an off-site redirect is detectable", async () => {
    const { http } = plugin(async () => ({ status: 200, headers: { "Content-Type": "text/html" }, data: "<p>hi</p>", url: "https://www.commonapp.org/explore/wpi" }));
    const res = await nativeFetch("https://www.wpi.edu/admissions/deadlines", {}, http);
    expect(res.url).toBe("https://www.commonapp.org/explore/wpi");
    expect(await res.text()).toBe("<p>hi</p>");
    // Older plugin builds without `url`: stays empty like a constructed Response.
    const old = plugin(async () => ({ status: 200, headers: {}, data: "x" }));
    expect((await nativeFetch("https://www.wpi.edu/", {}, old.http)).url).toBe("");
  });

  it("the deadline proof check marks a natively fetched page that redirected off-site as unchecked", async () => {
    const { verifyCollegeDeadlines } = await import("@/deadlines/verify");
    const { DEMO_COLLEGES } = await import("@/state/fixtures");
    const { http } = plugin(async () => ({ status: 200, headers: { "Content-Type": "text/html" }, data: `<html><body>${"Early Action: November 1. ".repeat(20)}</body></html>`, url: "https://www.commonapp.org/explore/wpi" }));
    const c = { ...DEMO_COLLEGES[0]!, url: "https://www.wpi.edu", application: { cycle: "Fall 2027 entry", plans: [{ plan: "EA" as const, deadline: "2026-11-01", source_url: "https://www.wpi.edu/admissions/deadlines" }], test_policy_note: null, essays_note: null, fee: null } };
    const out = await verifyCollegeDeadlines(c, { fetch: (url, init) => nativeFetch(url, init, http), now: () => new Date(2026, 9, 21) });
    expect(out.application!.plans[0]!.check).toMatchObject({ status: "unchecked", reason: "off_site" });
  });

  it("cancels the native request on abort", async () => {
    const ctl = new AbortController();
    const { http, cancel } = plugin(() => new Promise<never>(() => {}));
    const p = nativeFetch("https://x.test", { signal: ctl.signal }, http);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    const id = (http.request.mock.calls[0] as any[])[0].id;
    expect(cancel).toHaveBeenCalledWith({ id });
  });

  it("maps native ABORTED to AbortError and transport failures to TypeError", async () => {
    const a = plugin(async () => { throw Object.assign(new Error("Aborted"), { code: "ABORTED" }); });
    await expect(nativeFetch("https://x.test", {}, a.http)).rejects.toMatchObject({ name: "AbortError" });
    const n = plugin(async () => { throw Object.assign(new Error("offline"), { code: "NETWORK" }); });
    await expect(nativeFetch("https://x.test", {}, n.http)).rejects.toBeInstanceOf(TypeError);
  });
});

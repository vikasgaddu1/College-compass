import { describe, expect, it, vi } from "vitest";
import { nativeFetch } from "./index";

const sse = 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n';

describe("nativeFetch (CapacitorHttp-backed fetch)", () => {
  it("sends method, headers and string body, and returns a readable Response", async () => {
    const request = vi.fn(async () => ({ status: 200, headers: { "Content-Type": "text/event-stream", "x-request-id": "req_1" }, data: sse, url: "" }));
    const res = await nativeFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    }, { request } as any);
    const opts = (request.mock.calls[0] as any[])[0];
    expect(opts).toMatchObject({ url: "https://api.openai.com/v1/responses", method: "POST", data: '{"a":1}', responseType: "text" });
    expect(opts.headers).toMatchObject({ authorization: "Bearer t", "content-type": "application/json" });
    expect(res.ok).toBe(true);
    expect(res.headers.get("x-request-id")).toBe("req_1");
    expect(res.body).toBeTruthy();
    expect(await res.text()).toBe(sse);
  });

  it("re-serializes JSON the plugin already parsed and keeps error statuses", async () => {
    const request = vi.fn(async () => ({ status: 429, headers: {}, data: { error: { code: "rate_limit_exceeded" } }, url: "" }));
    const res = await nativeFetch("https://api.openai.com/v1/models", {}, { request } as any);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "rate_limit_exceeded" } });
  });

  it("rejects on abort and on a native transport failure", async () => {
    const ctl = new AbortController();
    const never = vi.fn(() => new Promise<any>(() => {}));
    const p = nativeFetch("https://x.test", { signal: ctl.signal }, { request: never } as any);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    const fail = vi.fn(async () => ({ status: 0, headers: {}, data: null, url: "" }));
    await expect(nativeFetch("https://x.test", {}, { request: fail } as any)).rejects.toBeInstanceOf(TypeError);
  });
});

import { describe, expect, it, vi } from "vitest";
import { nativeFetch, type NativeHttpPlugin } from "./index";

const sse = 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n';

function plugin(request: NativeHttpPlugin["request"]) {
  const cancel = vi.fn(async () => {});
  return { http: { request: vi.fn(request), cancel } as NativeHttpPlugin & { request: ReturnType<typeof vi.fn> }, cancel };
}

describe("nativeFetch (NativeHttp-backed fetch)", () => {
  it("sends id, method, headers and string body, and returns a readable Response", async () => {
    const { http } = plugin(async () => ({ status: 200, headers: { "Content-Type": "text/event-stream", "x-request-id": "req_1" }, data: sse }));
    const res = await nativeFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    }, http);
    const opts = (http.request.mock.calls[0] as any[])[0];
    expect(opts).toMatchObject({ url: "https://api.openai.com/v1/responses", method: "POST", body: '{"a":1}' });
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
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "rate_limit_exceeded" } });
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiError, type ChatGPTAccount } from "../types";
import type { ChatGPTAuth } from "./auth";
import { AiCallError, createAiClient, unsupportedFeature } from "./client";
import { RESPONSES_URL } from "./config";
import { submitResearchTool } from "./prompts";
import { installMemoryStorage, jsonResponse, sseResponse } from "./test-helpers";

const ACCOUNT: ChatGPTAccount = { sub: "u1", name: null, email: null, picture: null, plan_usage: true };

function fakeAuth(over: Partial<ChatGPTAuth> = {}) {
  let token = "at1";
  const a = {
    configured: () => true,
    account: () => ACCOUNT,
    signIn: async () => {},
    completeSignIn: async () => ACCOUNT,
    signOut: () => {},
    listModels: vi.fn(async () => [{ slug: "gpt-plan", display_name: "Plan model" }, { slug: "gpt-mini", display_name: "Mini" }]),
    subscribe: () => () => {},
    getAccessToken: vi.fn(async (o?: { rejected?: string }) => {
      if (o?.rejected) token = "at2";
      return token;
    }),
    hasPlanUsage: () => true,
    lastError: () => null,
    clearError: () => {},
    takeReturnTo: () => null,
    ...over,
  };
  return a as ChatGPTAuth & typeof a;
}

const completed = (extra: Record<string, unknown>[] = []) => [
  { type: "response.created", response: { model: "gpt-plan" } },
  ...extra,
  { type: "response.completed", response: { model: "gpt-plan", output: [] } },
];

function setup(responses: (Response | (() => Response))[], authOver: Partial<ChatGPTAuth> = {}, devKey: string | null = null) {
  const bodies: any[] = [];
  const headers: Record<string, string>[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe(RESPONSES_URL);
    bodies.push(JSON.parse(String(init!.body)));
    headers.push(init!.headers as Record<string, string>);
    const next = queue.shift();
    if (!next) throw new Error("no more responses");
    return typeof next === "function" ? next() : next;
  });
  const auth = fakeAuth(authOver);
  const client = createAiClient(auth, { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {}, devKey: () => devKey, preferredModel: () => null });
  return { client, auth, bodies, headers, fetchMock };
}

beforeEach(() => {
  installMemoryStorage();
});

describe("aiClient.call", () => {
  it("sends a plan-compliant request: store:false, stream:true, instructions, namespaced tools + web_search", async () => {
    const { client, bodies, headers } = setup([
      sseResponse(completed([
        { type: "response.output_item.added", item: { type: "function_call", id: "f1", name: "submit_college_research", namespace: "college_compass", arguments: "" } },
        { type: "response.function_call_arguments.done", item_id: "f1", arguments: '{"colleges":[]}' },
      ])),
    ]);
    const r = await client.call({
      instructions: "Be careful.",
      input: [{ role: "user", content: "Hi" }],
      tools: [submitResearchTool],
      tool_choice: { type: "function", name: "submit_college_research" },
      webSearch: true,
      reasoning: "medium",
    });
    expect(r).toEqual({ text: "", model: "gpt-plan", tool_calls: [{ name: "submit_college_research", arguments: '{"colleges":[]}' }] });
    const b = bodies[0];
    expect(b).toMatchObject({ model: "gpt-plan", instructions: "Be careful.", store: false, stream: true, input: [{ role: "user", content: "Hi" }], reasoning: { effort: "medium" } });
    for (const k of ["temperature", "max_output_tokens", "metadata", "user", "previous_response_id", "truncation", "top_p"]) expect(b).not.toHaveProperty(k);
    expect(b.input.some((m: any) => m.role === "system")).toBe(false);
    expect(b.tools[0]).toMatchObject({ type: "namespace", name: "college_compass", tools: [{ type: "function", name: "submit_college_research", strict: true }] });
    expect(b.tools[1]).toEqual({ type: "web_search" });
    expect(b.tool_choice).toBe("required");
    expect(headers[0]!.Authorization).toBe("Bearer at1");
  });

  it("streams text through onDelta and succeeds only on response.completed", async () => {
    const deltas: string[] = [];
    const { client } = setup([sseResponse(completed([{ type: "response.output_text.delta", delta: "Hi " }, { type: "response.output_text.delta", delta: "there" }]))]);
    const r = await client.call({ instructions: "x", input: [{ role: "user", content: "q" }], onDelta: (t) => deltas.push(t) });
    expect(r.text).toBe("Hi there");
    expect(deltas).toEqual(["Hi ", "there"]);
  });

  it("401 → refreshes once and retries; a second 401 → reauth_required", async () => {
    const ok = setup([jsonResponse(401, { error: { code: "subscription_sharing_invalid_user", message: "bad" } }), sseResponse(completed())]);
    await ok.client.call({ instructions: "x", input: [] });
    expect(ok.auth.getAccessToken).toHaveBeenLastCalledWith({ rejected: "at1" });
    expect(ok.headers[1]!.Authorization).toBe("Bearer at2");

    const bad = setup([jsonResponse(401, { detail: "nope" }), jsonResponse(401, { detail: "nope" })]);
    await expect(bad.client.call({ instructions: "x", input: [] })).rejects.toMatchObject({ code: "reauth_required" });
  });

  it("usage limit (HTTP 429 or response.failed) → usage_limit, with request id preserved", async () => {
    const a = setup([jsonResponse(429, { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } }, { "x-request-id": "req_1" })]);
    const err = await a.client.call({ instructions: "x", input: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toBeInstanceOf(AiCallError);
    expect(err).toMatchObject({ code: "usage_limit", status: 429, apiCode: "subscription_sharing_usage_limit_exceeded", requestId: "req_1" });

    const b = setup([sseResponse([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } } }])]);
    await expect(b.client.call({ instructions: "x", input: [] })).rejects.toMatchObject({ code: "usage_limit" });
  });

  it("usage temporarily unavailable → bounded backoff then usage_limit", async () => {
    const r503 = () => jsonResponse(503, { error: { code: "subscription_sharing_usage_unavailable", message: "later" } });
    const { client, fetchMock } = setup([r503, r503, r503]);
    await expect(client.call({ instructions: "x", input: [] })).rejects.toMatchObject({ code: "usage_limit" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("not eligible / misconfigured → unsupported without retry", async () => {
    const { client, fetchMock } = setup([jsonResponse(403, { error: { code: "subscription_sharing_user_not_eligible", message: "no" } })]);
    await expect(client.call({ instructions: "x", input: [] })).rejects.toMatchObject({ code: "unsupported" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drops web_search when the route rejects it, retries, and remembers", async () => {
    const reject = jsonResponse(400, { error: { code: "subscription_sharing_unsupported_capability", param: "tools[1].type", message: "web_search is not supported" } });
    const { client, bodies } = setup([reject, sseResponse(completed()), sseResponse(completed())]);
    await client.call({ instructions: "x", input: [], webSearch: true });
    expect(bodies[0].tools).toEqual([{ type: "web_search" }]);
    expect(bodies[1].tools).toBeUndefined();
    await client.call({ instructions: "x", input: [], webSearch: true });
    expect(bodies[2].tools).toBeUndefined(); // remembered
  });

  it("switches tool shape (namespace ↔ flat) when tools are rejected", async () => {
    const reject = jsonResponse(400, { error: { code: "subscription_sharing_unsupported_capability", param: "tools[0].type", message: "unsupported" } });
    const { client, bodies } = setup([reject, sseResponse(completed())]);
    await client.call({ instructions: "x", input: [], tools: [submitResearchTool], tool_choice: { type: "function", name: submitResearchTool.name } });
    expect(bodies[0].tools[0].type).toBe("namespace");
    expect(bodies[1].tools[0]).toMatchObject({ type: "function", name: submitResearchTool.name });
    expect(bodies[1].tool_choice).toEqual({ type: "function", name: submitResearchTool.name });
  });

  it("drops reasoning when rejected", async () => {
    const reject = jsonResponse(400, { error: { code: "unsupported_parameter", param: "reasoning.effort", message: "x" } });
    const { client, bodies } = setup([reject, sseResponse(completed())]);
    await client.call({ instructions: "x", input: [], reasoning: "high" });
    expect(bodies[1].reasoning).toBeUndefined();
  });

  it("incomplete / interrupted streams fail", async () => {
    const a = setup([sseResponse([{ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }])]);
    await expect(a.client.call({ instructions: "x", input: [] })).rejects.toMatchObject({ code: "server" });
    const b = setup([sseResponse([{ type: "response.output_text.delta", delta: "half" }])]);
    await expect(b.client.call({ instructions: "x", input: [] })).rejects.toMatchObject({ code: "network" });
  });

  it("network failure → network (CORS-blocked ChatGPT web call → unsupported); abort → AbortError", async () => {
    const a = setup([() => { throw new TypeError("Failed to fetch"); }]);
    // From a web page a ChatGPT-token request fails at CORS, so the error points to the iPhone app.
    await expect(a.client.call({ instructions: "x", input: [] })).rejects.toMatchObject({ code: "unsupported" });
    const k = setup([() => { throw new TypeError("Failed to fetch"); }], { account: () => null }, "sk-test");
    await expect(k.client.call({ instructions: "x", input: [] })).rejects.toMatchObject({ code: "network" });
    const ctrl = new AbortController();
    ctrl.abort();
    const b = setup([sseResponse(completed())]);
    await expect(b.client.call({ instructions: "x", input: [], signal: ctrl.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("uses the developer API key (flat tools, configured model) when there is no ChatGPT plan session", async () => {
    const { client, bodies, headers } = setup([sseResponse(completed())], { account: () => null }, "sk-test");
    expect(client.connection()).toEqual({ kind: "api_key" });
    await client.call({ instructions: "x", input: [], tools: [submitResearchTool], tool_choice: { type: "function", name: submitResearchTool.name } });
    expect(headers[0]!.Authorization).toBe("Bearer sk-test");
    expect(bodies[0].model).toBe("gpt-5");
    expect(bodies[0].tools[0].type).toBe("function");
    expect(bodies[0].store).toBe(false);
  });

  it("not signed in → not_connected; signed in without plan usage → unsupported", async () => {
    const none = setup([], { account: () => null });
    expect(none.client.connection()).toEqual({ kind: "none" });
    await expect(none.client.call({ instructions: "x", input: [] })).rejects.toMatchObject({ code: "not_connected" });
    const noPlan = setup([], { account: () => ({ ...ACCOUNT, plan_usage: false }) });
    await expect(noPlan.client.call({ instructions: "x", input: [] })).rejects.toMatchObject({ code: "unsupported" });
  });

  it("defaults to the first listed model, or the preferred one when it is listed", async () => {
    const { client } = setup([]);
    expect(await client.defaultModel()).toBe("gpt-plan");
    const auth = fakeAuth();
    const c2 = createAiClient(auth, { fetch: vi.fn() as unknown as typeof fetch, devKey: () => null, preferredModel: () => "gpt-mini" });
    expect(await c2.defaultModel()).toBe("gpt-mini");
  });
});

describe("unsupportedFeature", () => {
  it("classifies by param first, then message", () => {
    expect(unsupportedFeature({ param: "tools[2]", message: "" })).toBe("tools");
    expect(unsupportedFeature({ param: "tool_choice", message: "" })).toBe("tool_choice");
    expect(unsupportedFeature({ param: null, message: "Web search is disabled by your workspace" })).toBe("web_search");
    expect(unsupportedFeature({ param: "model", message: "" })).toBe("model");
    expect(unsupportedFeature({ param: null, message: "something else" })).toBeNull();
  });
});

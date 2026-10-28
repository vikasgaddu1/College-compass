/**
 * Responses API client (ChatGPT plan via Sign in with ChatGPT, or a developer API key for demos).
 *
 * Rules for ChatGPT plan usage (developers.openai.com/siwc, Oct 2026):
 *  - always `store:false` + `stream:true`; guidance goes in `instructions` (no system messages);
 *  - never send temperature, max_output_tokens, metadata, user, previous_response_id, truncation, …;
 *  - function tools (grouped in a namespace for plan usage) + web_search (subject to policy);
 *  - success only on `response.completed`.
 * Anything the route rejects as unsupported (web_search, tool shape, forced tool_choice, reasoning) is
 * dropped, retried once and remembered for a week on this device.
 */
import { load, remove, save } from "../lib/storage";
import { httpFetch, isNative } from "../platform";
import { AiError, type AiCallResult, type AiClient, type AiConnection, type AiFunctionTool } from "../types";
import { auth as authSingleton, type ChatGPTAuth } from "./auth";
import { DEV_DEFAULT_MODEL, KEYS, MANAGE_USAGE_URL, RESPONSES_URL } from "./config";
import { ResponseAccumulator, SseParser, readSse, type StreamError } from "./sse";

type CallOpts = Parameters<AiClient["call"]>[0];

/** AiError with the diagnostic details OpenAI asks integrators to preserve. */
export class AiCallError extends AiError {
  constructor(
    code: AiError["code"],
    message: string,
    public status: number | null = null,
    public apiCode: string | null = null,
    public param: string | null = null,
    public requestId: string | null = null,
  ) {
    super(code, message);
  }
}

export const USAGE_LIMIT_MESSAGE = "You've reached your ChatGPT usage limit for now. Review your plan or this app's limit in ChatGPT settings (Manage usage).";

// ───────────────────────────── developer key + model preference ─────────────────────────────

/** Developer/demo mode only (Settings → Developer). The key never leaves this device except to api.openai.com. */
export function getDevApiKey(): string | null {
  const k = load<string | null>(KEYS.devKey, null);
  return typeof k === "string" && k.trim() ? k.trim() : null;
}
export function setDevApiKey(key: string | null): void {
  if (key && key.trim()) save(KEYS.devKey, key.trim());
  else remove(KEYS.devKey);
}
export function getDevModel(): string {
  const m = load<string | null>(KEYS.devModel, null);
  return typeof m === "string" && m.trim() ? m.trim() : DEV_DEFAULT_MODEL;
}
export function setDevModel(model: string | null): void {
  if (model && model.trim()) save(KEYS.devModel, model.trim());
  else remove(KEYS.devModel);
}
/** The model picked in Settings (a `slug` from listModels()); null = first listed. */
export function getPreferredModel(): string | null {
  const m = load<string | null>(KEYS.model, null);
  return typeof m === "string" && m ? m : null;
}
export function setPreferredModel(slug: string | null): void {
  if (slug) save(KEYS.model, slug);
  else remove(KEYS.model);
}

// ───────────────────────────── adaptive capabilities ─────────────────────────────

export type ToolMode = "namespace" | "flat";
interface Caps {
  at: number;
  no_web_search?: boolean;
  tool_mode?: ToolMode;
  no_forced_choice?: boolean;
  no_reasoning?: boolean;
}
type CapsStore = Partial<Record<"chatgpt" | "api_key", Caps>>;
const CAPS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NAMESPACE = "college_compass";

// ───────────────────────────── helpers ─────────────────────────────

export interface ClientDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  devKey: () => string | null;
  devModel: () => string;
  preferredModel: () => string | null;
}

function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException("Aborted", "AbortError");
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(abortError(signal)); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

interface Failure {
  status: number | null;
  code: string | null;
  param: string | null;
  message: string;
  requestId: string | null;
}

async function readFailure(res: Response): Promise<Failure> {
  let text = "";
  try { text = await res.text(); } catch { /* ignore */ }
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  const e = json?.error && typeof json.error === "object" ? json.error : null;
  return {
    status: res.status,
    code: typeof e?.code === "string" ? e.code : null,
    param: typeof e?.param === "string" ? e.param : null,
    message: String(e?.message ?? json?.detail ?? (text.slice(0, 300) || res.statusText || "Request failed")),
    requestId: res.headers.get("x-request-id"),
  };
}

function fromStream(e: StreamError | null, requestId: string | null): Failure {
  return { status: null, code: e?.code ?? null, param: e?.param ?? null, message: e?.message ?? "The model returned an error.", requestId };
}

/**
 * Which unsupported feature a 400 points at: `error.param` first (resolving `tools[i]` against the body
 * we sent), then the message.
 */
export function unsupportedFeature(
  f: Pick<Failure, "param" | "message">,
  body?: { tools?: { type?: string }[] },
): "web_search" | "tool_choice" | "reasoning" | "tools" | "model" | null {
  const param = (f.param ?? "").toLowerCase();
  const msg = (f.message ?? "").toLowerCase();
  const idx = param.match(/^tools\[(\d+)\]/);
  if (idx && body?.tools) {
    const t = body.tools[Number(idx[1])];
    if (t?.type === "web_search") return "web_search";
    if (t) return "tools";
  }
  if (/web_search|web search/.test(param) || (!/^(tool_choice|reasoning|model)/.test(param) && /web_search|web search/.test(msg))) return "web_search";
  const hay = param || msg;
  if (/tool_choice/.test(hay)) return "tool_choice";
  if (/reasoning/.test(hay)) return "reasoning";
  if (/namespace|tools|function|additional_tools/.test(hay)) return "tools";
  if (/\bmodel\b/.test(hay)) return "model";
  return null;
}

function stripNamespace(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1) : name;
}

/** api.openai.com blocks browser (CORS) calls made with ChatGPT tokens; only the app can make them. */
function webPlanError(): AiCallError {
  return new AiCallError("unsupported", "OpenAI only accepts ChatGPT-plan requests from the Tierwise iPhone app, not from a web page. Open the app to run research, or try the demo here.");
}

/**
 * Parse a complete, buffered Responses API stream (SSE text) into a call result. Used to recover
 * research responses that iOS delivered while the app wasn't running. Null unless it completed.
 */
export function parseResponsesText(text: string): AiCallResult | null {
  const acc = new ResponseAccumulator(() => {});
  const parser = new SseParser();
  for (const m of [...parser.push(text), ...parser.flush()]) {
    acc.handle(m);
    if (acc.done) break;
  }
  const out = acc.result();
  if (out.status !== "completed") return null;
  return {
    text: out.text,
    tool_calls: out.tool_calls.map((c) => ({ name: stripNamespace(c.name), arguments: c.arguments })),
    model: out.model || "",
  };
}

// ───────────────────────────── client ─────────────────────────────

export interface CompassAiClient extends AiClient {
  /** Models for the model picker (ChatGPT: visibility=list; dev key: the configured model). */
  listModels(): Promise<{ slug: string; display_name: string }[]>;
  /** The model call() uses when none is passed. */
  defaultModel(): Promise<string>;
  /** Forget remembered "unsupported" adaptations (e.g. after the account's policy changes). */
  resetCapabilities(): void;
}

export function createAiClient(auth: ChatGPTAuth, overrides: Partial<ClientDeps> = {}): CompassAiClient {
  const d: ClientDeps = {
    fetch: (...a) => httpFetch(...a),
    now: () => Date.now(),
    sleep: defaultSleep,
    devKey: getDevApiKey,
    devModel: getDevModel,
    preferredModel: getPreferredModel,
    ...overrides,
  };

  const capsFor = (kind: "chatgpt" | "api_key"): Caps => {
    const all = load<CapsStore>(KEYS.caps, {});
    const c = all?.[kind];
    if (c && typeof c.at === "number" && d.now() - c.at < CAPS_TTL_MS) return { ...c };
    return { at: d.now() };
  };
  const rememberCaps = (kind: "chatgpt" | "api_key", c: Caps) => {
    const all = load<CapsStore>(KEYS.caps, {}) ?? {};
    all[kind] = { ...c, at: d.now() };
    save(KEYS.caps, all);
  };

  function connection(): AiConnection {
    const acct = auth.account();
    if (acct?.plan_usage) return { kind: "chatgpt", account: acct };
    if (d.devKey()) return { kind: "api_key" };
    if (acct) return { kind: "chatgpt", account: acct };
    return { kind: "none" };
  }

  function resolve(): { kind: "chatgpt" } | { kind: "api_key"; key: string } {
    const acct = auth.account();
    if (acct?.plan_usage) return { kind: "chatgpt" };
    const key = d.devKey();
    if (key) return { kind: "api_key", key };
    if (acct) {
      throw new AiCallError(
        "unsupported",
        "ChatGPT plan usage wasn't allowed for Tierwise. Sign out, sign in again and allow the app to use your ChatGPT plan.",
      );
    }
    throw new AiCallError("not_connected", "Sign in with ChatGPT to use AI research.");
  }

  async function listModels(): Promise<{ slug: string; display_name: string }[]> {
    const acct = auth.account();
    if (acct?.plan_usage || (acct && !d.devKey())) return auth.listModels();
    if (d.devKey()) {
      const m = d.devModel();
      return [{ slug: m, display_name: `${m} (developer key)` }];
    }
    return [];
  }

  async function defaultModel(): Promise<string> {
    const conn = resolve();
    if (conn.kind === "api_key") return d.devModel();
    const pref = d.preferredModel();
    let models: { slug: string }[] = [];
    try {
      models = await auth.listModels();
    } catch (e) {
      if (pref) return pref;
      throw e;
    }
    if (pref && models.some((m) => m.slug === pref)) return pref;
    if (models[0]) return models[0].slug;
    if (pref) return pref;
    throw new AiCallError("unsupported", "Your ChatGPT account has no models available to this app.");
  }

  function buildBody(o: CallOpts, model: string, caps: Caps, kind: "chatgpt" | "api_key"): Record<string, unknown> {
    const mode: ToolMode = caps.tool_mode ?? (kind === "chatgpt" ? "namespace" : "flat");
    const body: Record<string, unknown> = {
      model,
      instructions: o.instructions,
      input: o.input.map((m) => ({ role: m.role, content: m.content })),
      store: false,
      stream: true,
    };
    const fns = (o.tools ?? []).map((t: AiFunctionTool) => ({
      type: "function" as const,
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      ...(t.strict != null ? { strict: t.strict } : {}),
    }));
    const tools: unknown[] = [];
    if (fns.length) {
      if (mode === "namespace") {
        tools.push({ type: "namespace", name: NAMESPACE, description: "Tierwise structured outputs. Call these to return results.", tools: fns });
      } else {
        tools.push(...fns);
      }
    }
    if (o.webSearch && !caps.no_web_search) tools.push({ type: "web_search" });
    if (tools.length) body.tools = tools;

    const tc = o.tool_choice;
    if (tc && tools.length) {
      if (typeof tc === "object") {
        const forced = fns.some((f) => f.name === tc.name);
        if (forced && mode === "flat" && !caps.no_forced_choice) body.tool_choice = { type: "function", name: tc.name };
        else if (forced) body.tool_choice = "required";
      } else if (tc !== "auto") {
        body.tool_choice = tc;
      }
    }
    if (o.reasoning && !caps.no_reasoning) body.reasoning = { effort: o.reasoning };
    return body;
  }

  async function call(o: CallOpts): Promise<AiCallResult> {
    const conn = resolve();
    const signal = o.signal;
    if (signal?.aborted) throw abortError(signal);
    let model: string;
    try {
      model = o.model || (await defaultModel());
    } catch (e) {
      // Model discovery (GET /v1/models) is CORS-blocked the same way on the web, and it runs first.
      if (conn.kind === "chatgpt" && !isNative() && (e as { code?: string })?.code === "network") throw webPlanError();
      throw e;
    }
    const caps = capsFor(conn.kind);
    const startMode: ToolMode = caps.tool_mode ?? (conn.kind === "chatgpt" ? "namespace" : "flat");
    let refreshed = false;
    let backoffs = 0;
    let adaptations = 0;
    let rejected: string | undefined;

    for (let attempt = 0; attempt < 8; attempt++) {
      if (signal?.aborted) throw abortError(signal);
      const token = conn.kind === "chatgpt" ? await auth.getAccessToken(rejected ? { rejected } : {}) : conn.key;
      rejected = undefined;
      const body = buildBody(o, model, caps, conn.kind);

      let res: Response;
      try {
        res = await d.fetch(RESPONSES_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(body),
          signal,
          // Read by platform.httpFetch on iOS only; fetch() ignores unknown init fields.
          ...(o.tag ? { ccTag: o.tag } : {}),
        } as RequestInit);
      } catch {
        if (signal?.aborted) throw abortError(signal);
        if (conn.kind === "chatgpt" && !isNative()) {
          // api.openai.com blocks browser (CORS) calls made with ChatGPT tokens; only the app can make them.
          throw webPlanError();
        }
        throw new AiCallError("network", "Couldn't reach OpenAI. Check your connection and try again.");
      }

      let failure: Failure | null = null;
      let textStreamed = false;
      if (!res.ok) {
        failure = await readFailure(res);
      } else if (!res.body) {
        throw new AiCallError("server", "OpenAI returned an empty response.", res.status);
      } else {
        const requestId = res.headers.get("x-request-id");
        const acc = new ResponseAccumulator(o.onDelta ? (t) => { textStreamed = true; o.onDelta!(t); } : () => { textStreamed = true; });
        try {
          for await (const m of readSse(res.body, signal)) {
            acc.handle(m);
            if (acc.done) break;
          }
        } catch {
          if (signal?.aborted) throw abortError(signal);
          // otherwise: the stream broke → reported as "interrupted" below
        }
        const out = acc.result();
        if (out.status === "completed") {
          return {
            text: out.text,
            tool_calls: out.tool_calls.map((c) => ({ name: stripNamespace(c.name), arguments: c.arguments })),
            model: out.model || model,
          };
        }
        if (out.status === "incomplete") {
          throw new AiCallError("server", `The answer was cut short (${out.incomplete_reason ?? "incomplete"}). Try again.`, res.status, null, null, requestId);
        }
        if (out.status === "interrupted") {
          throw new AiCallError("network", "The connection dropped before the answer finished. Try again.", res.status, null, null, requestId);
        }
        failure = fromStream(out.error, requestId);
      }

      // ── decide: adapt / refresh / back off / throw ──
      const f = failure!;
      const code = f.code ?? "";
      const err = (c: AiError["code"], msg: string) => new AiCallError(c, msg, f.status, f.code, f.param, f.requestId);

      if (code === "subscription_sharing_usage_limit_exceeded") throw err("usage_limit", USAGE_LIMIT_MESSAGE);
      if (code === "subscription_sharing_user_not_eligible") {
        throw err("unsupported", "ChatGPT plan usage isn't available for this account or workspace, so Tierwise can't run AI requests with it.");
      }
      if (code === "subscription_sharing_route_not_supported" || code.startsWith("chatpass_v2_")) {
        throw err("unsupported", `This app's ChatGPT access is misconfigured (${code}). Please update the app.`);
      }

      const isUnsupported = code === "subscription_sharing_unsupported_capability" || f.status === 400 || code === "invalid_request_error" || code === "unsupported_parameter" || code === "unsupported_value";
      if (isUnsupported && !textStreamed && adaptations < 4) {
        const feat = unsupportedFeature(f, body as { tools?: { type?: string }[] });
        let adapted = false;
        if (feat === "web_search" && o.webSearch && !caps.no_web_search) { caps.no_web_search = true; adapted = true; }
        else if (feat === "tool_choice" && !caps.no_forced_choice && o.tool_choice && typeof o.tool_choice === "object") { caps.no_forced_choice = true; adapted = true; }
        else if (feat === "reasoning" && o.reasoning && !caps.no_reasoning) { caps.no_reasoning = true; adapted = true; }
        else if (feat === "tools" && o.tools?.length && (caps.tool_mode ?? startMode) === startMode) {
          caps.tool_mode = startMode === "namespace" ? "flat" : "namespace";
          adapted = true;
        }
        if (adapted) {
          adaptations++;
          rememberCaps(conn.kind, caps);
          continue;
        }
        if (feat === "model") throw err("unsupported", `The model “${model}” isn't available here. Pick another model in Settings.`);
        if (f.status === 400 || code === "subscription_sharing_unsupported_capability") {
          throw err("unsupported", `OpenAI rejected the request: ${f.message}`);
        }
      }

      if (f.status === 401 || code === "subscription_sharing_invalid_user" || code === "invalid_api_key") {
        if (conn.kind === "chatgpt" && !refreshed) {
          refreshed = true;
          rejected = token;
          continue;
        }
        throw err(
          "reauth_required",
          conn.kind === "chatgpt" ? "Your ChatGPT session needs to be renewed. Please sign in again." : "The developer API key was rejected.",
        );
      }

      const transient =
        code === "subscription_sharing_usage_unavailable" || code === "subscription_sharing_user_unavailable" ||
        f.status === 503 || f.status === 502 || f.status === 500 || f.status === 504 ||
        (f.status === 429 && conn.kind === "api_key") || code === "server_error" || code === "rate_limit_exceeded";
      if (transient && !textStreamed && backoffs < 2) {
        await d.sleep(backoffs === 0 ? 1500 : 4000, signal);
        backoffs++;
        continue;
      }
      if (code === "subscription_sharing_usage_unavailable") {
        throw err("usage_limit", "ChatGPT plan usage is temporarily unavailable. Please try again in a little while.");
      }
      if (f.status === 429 || code === "rate_limit_exceeded" || code === "insufficient_quota") throw err("usage_limit", USAGE_LIMIT_MESSAGE);
      if (f.status === 403) throw err("unsupported", `OpenAI blocked this request: ${f.message}`);
      if (f.status != null && f.status >= 500) throw err("server", "OpenAI is having trouble right now. Please try again shortly.");
      throw err("server", `The model couldn't finish: ${f.message}`);
    }
    throw new AiCallError("server", "OpenAI kept rejecting the request. Please try again later.");
  }

  return {
    connection,
    call,
    listModels,
    defaultModel,
    resetCapabilities: () => remove(KEYS.caps),
  };
}

/** Friendly "Manage usage" link for usage_limit errors. */
export const manageUsageUrl = MANAGE_USAGE_URL;

export const auth = authSingleton;
export const aiClient: CompassAiClient = createAiClient(authSingleton);

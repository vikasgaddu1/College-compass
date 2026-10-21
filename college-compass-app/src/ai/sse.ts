import type { AiUsage } from "../types";

/**
 * Server-Sent Events parsing for the Responses API stream (fetch ReadableStream), plus an
 * accumulator that turns Responses events into text + function calls + a terminal outcome.
 *
 * Success is ONLY `response.completed`. `response.failed`, `response.incomplete`, an `error` event
 * or a stream that ends without a terminal event are all failures.
 */

export interface SseMessage {
  event: string;   // "message" when no `event:` field was sent
  data: string;
  id?: string;
}

/** Incremental, chunk-boundary-safe SSE parser (WHATWG EventSource rules). */
export class SseParser {
  private buf = "";
  private dataLines: string[] = [];
  private event = "";
  private id: string | undefined;
  private sawData = false;

  push(chunk: string): SseMessage[] {
    this.buf += chunk;
    const out: SseMessage[] = [];
    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const ch = this.buf[i];
      if (ch !== "\n" && ch !== "\r") continue;
      // A trailing "\r" might be the first half of "\r\n" split across chunks — wait for more.
      if (ch === "\r" && i === this.buf.length - 1) break;
      const line = this.buf.slice(start, i);
      if (ch === "\r" && this.buf[i + 1] === "\n") i++;
      start = i + 1;
      const msg = this.line(line);
      if (msg) out.push(msg);
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  /** Call at end of stream: dispatches a final event that lacked its blank line. */
  flush(): SseMessage[] {
    const out: SseMessage[] = [];
    if (this.buf) {
      const rest = this.buf.replace(/\r$/, "");
      this.buf = "";
      const m = this.line(rest);
      if (m) out.push(m);
    }
    const m = this.dispatch();
    if (m) out.push(m);
    return out;
  }

  private line(line: string): SseMessage | null {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return null; // comment / keep-alive
    const c = line.indexOf(":");
    const field = c < 0 ? line : line.slice(0, c);
    let value = c < 0 ? "" : line.slice(c + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") { this.dataLines.push(value); this.sawData = true; }
    else if (field === "event") this.event = value;
    else if (field === "id") this.id = value;
    return null;
  }

  private dispatch(): SseMessage | null {
    const had = this.sawData;
    const msg: SseMessage = { event: this.event || "message", data: this.dataLines.join("\n") };
    if (this.id !== undefined) msg.id = this.id;
    this.dataLines = [];
    this.event = "";
    this.sawData = false;
    return had ? msg : null;
  }
}

/** Iterate SSE messages from a fetch body. Cancels the reader when the consumer stops or aborts. */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", onAbort, { once: true });
  let finished = false;
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { value, done } = await reader.read();
      if (done) { finished = true; break; }
      for (const m of parser.push(decoder.decode(value, { stream: true }))) yield m;
    }
    const tail = decoder.decode();
    if (tail) for (const m of parser.push(tail)) yield m;
    finished = true;
    for (const m of parser.flush()) yield m;
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // Consumer stopped early (terminal event seen) → free the connection.
    if (!finished) void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* stream already cancelled */ }
  }
}

// ───────────────────────────── Responses event accumulation ─────────────────────────────

export interface StreamError { code: string | null; message: string; param: string | null; type?: string | null }

export interface StreamOutcome {
  status: "completed" | "failed" | "incomplete" | "error" | "interrupted";
  text: string;
  tool_calls: { name: string; arguments: string; namespace?: string }[];
  model: string;
  error: StreamError | null;
  incomplete_reason: string | null;
  /** `response.usage` + web searches run, when the completed response reported them. */
  usage: AiUsage | null;
}

interface CallState { key: string; name: string; namespace?: string; arguments: string; order: number }

const tok = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Usage from a completed response (null when it reported neither token counts nor web searches). */
function usageFrom(resp: any, output: any[] | null): AiUsage | null {
  const u = resp?.usage && typeof resp.usage === "object" ? resp.usage : null;
  const web = output ? output.filter((i: any) => i?.type === "web_search_call").length : 0;
  if (!u && !web) return null;
  return {
    input_tokens: tok(u?.input_tokens),
    output_tokens: tok(u?.output_tokens),
    reasoning_tokens: tok(u?.output_tokens_details?.reasoning_tokens),
    total_tokens: tok(u?.total_tokens),
    web_searches: web,
  };
}

function errFrom(obj: any): StreamError {
  const e = obj && typeof obj === "object" ? obj : {};
  return {
    code: typeof e.code === "string" ? e.code : null,
    message: typeof e.message === "string" ? e.message : "The model returned an error.",
    param: typeof e.param === "string" ? e.param : null,
    type: typeof e.type === "string" ? e.type : null,
  };
}

export class ResponseAccumulator {
  private text = "";
  private model = "";
  private calls = new Map<string, CallState>();
  private order = 0;
  private status: StreamOutcome["status"] | null = null;
  private error: StreamError | null = null;
  private incomplete: string | null = null;
  private finalCalls: CallState[] | null = null;
  private finalText: string | null = null;
  private usage: AiUsage | null = null;

  constructor(private onDelta?: (t: string) => void) {}

  get done(): boolean {
    return this.status !== null;
  }

  private call(key: string): CallState {
    let c = this.calls.get(key);
    if (!c) {
      c = { key, name: "", arguments: "", order: this.order++ };
      this.calls.set(key, c);
    }
    return c;
  }

  private absorbItem(item: any, final: boolean): void {
    if (!item || item.type !== "function_call") return;
    const key = String(item.id ?? item.call_id ?? `idx${this.order}`);
    const c = this.call(key);
    if (typeof item.name === "string" && item.name) c.name = item.name;
    if (typeof item.namespace === "string" && item.namespace) c.namespace = item.namespace;
    if (typeof item.arguments === "string" && (final || item.arguments)) c.arguments = item.arguments;
  }

  handle(msg: SseMessage): void {
    if (this.status) return;
    const raw = msg.data.trim();
    if (!raw || raw === "[DONE]") return;
    let ev: any;
    try { ev = JSON.parse(raw); } catch { return; }
    const type: string = typeof ev?.type === "string" ? ev.type : msg.event;
    const resp = ev?.response;
    if (resp && typeof resp.model === "string") this.model = resp.model;

    switch (type) {
      case "response.output_text.delta":
        if (typeof ev.delta === "string" && ev.delta) {
          this.text += ev.delta;
          try { this.onDelta?.(ev.delta); } catch { /* UI callback errors must not break the stream */ }
        }
        break;
      case "response.output_item.added":
        this.absorbItem(ev.item, false);
        break;
      case "response.output_item.done":
        this.absorbItem(ev.item, true);
        break;
      case "response.function_call_arguments.delta":
        if (typeof ev.delta === "string") this.call(String(ev.item_id ?? `out${ev.output_index}`)).arguments += ev.delta;
        break;
      case "response.function_call_arguments.done": {
        const c = this.call(String(ev.item_id ?? `out${ev.output_index}`));
        if (typeof ev.arguments === "string") c.arguments = ev.arguments;
        if (typeof ev.name === "string" && ev.name) c.name = ev.name;
        break;
      }
      case "response.completed": {
        this.status = "completed";
        const out = Array.isArray(resp?.output) ? resp.output : null;
        this.usage = usageFrom(resp, out);
        if (out) {
          const fc = out.filter((i: any) => i?.type === "function_call" && typeof i.name === "string");
          if (fc.length) {
            this.finalCalls = fc.map((i: any, n: number) => ({
              key: String(i.id ?? n), name: i.name, namespace: typeof i.namespace === "string" ? i.namespace : undefined,
              arguments: typeof i.arguments === "string" ? i.arguments : "", order: n,
            }));
          }
          if (!this.text) {
            const t = out
              .filter((i: any) => i?.type === "message" && Array.isArray(i.content))
              .flatMap((i: any) => i.content)
              .filter((c: any) => c?.type === "output_text" && typeof c.text === "string")
              .map((c: any) => c.text)
              .join("");
            if (t) this.finalText = t;
          }
        }
        break;
      }
      case "response.failed":
        this.status = "failed";
        this.error = errFrom(resp?.error);
        break;
      case "response.incomplete":
        this.status = "incomplete";
        this.incomplete = typeof resp?.incomplete_details?.reason === "string" ? resp.incomplete_details.reason : "unknown";
        break;
      case "error":
        this.status = "error";
        this.error = errFrom(ev.error && typeof ev.error === "object" ? ev.error : ev);
        break;
      default:
        break;
    }
  }

  result(): StreamOutcome {
    const calls = (this.finalCalls ?? [...this.calls.values()].filter((c) => c.name))
      .sort((a, b) => a.order - b.order)
      .map((c) => (c.namespace ? { name: c.name, arguments: c.arguments, namespace: c.namespace } : { name: c.name, arguments: c.arguments }));
    return {
      status: this.status ?? "interrupted",
      text: this.text || this.finalText || "",
      tool_calls: calls,
      model: this.model,
      error: this.error,
      incomplete_reason: this.incomplete,
      usage: this.usage,
    };
  }
}

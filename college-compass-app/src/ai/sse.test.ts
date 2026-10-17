import { describe, expect, it } from "vitest";
import { ResponseAccumulator, SseParser, readSse } from "./sse";
import { sseText, streamOf } from "./test-helpers";

describe("SseParser", () => {
  it("parses events split at arbitrary chunk boundaries", () => {
    const text = sseText([{ type: "a", n: 1 }, { type: "b", n: 2 }]);
    for (let cut = 1; cut < text.length; cut += 7) {
      const p = new SseParser();
      const got = [...p.push(text.slice(0, cut)), ...p.push(text.slice(cut)), ...p.flush()];
      expect(got.map((m) => m.event)).toEqual(["a", "b"]);
      expect(JSON.parse(got[1]!.data)).toEqual({ type: "b", n: 2 });
    }
  });

  it("handles CRLF split across chunks, comments, multi-line data and missing space", () => {
    const p = new SseParser();
    const out = [
      ...p.push(": keep-alive\r"),
      ...p.push("\nevent:x\r\ndata: line1\r"),
      ...p.push("\ndata:line2\r\nid: 7\r\n\r\n"),
    ];
    expect(out).toEqual([{ event: "x", data: "line1\nline2", id: "7" }]);
  });

  it("defaults event to 'message', ignores empty dispatches and flushes a trailing event", () => {
    const p = new SseParser();
    expect(p.push("\n\n")).toEqual([]);
    expect(p.push("data: {\"k\":1}")).toEqual([]);
    expect(p.flush()).toEqual([{ event: "message", data: '{"k":1}' }]);
  });
});

describe("readSse", () => {
  it("reads a fetch-style byte stream (multi-byte UTF-8 split across chunks)", async () => {
    const bytes = new TextEncoder().encode('data: {"t":"café ✓"}\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 15));
        c.enqueue(bytes.slice(15));
        c.close();
      },
    });
    const got = [];
    for await (const m of readSse(stream)) got.push(m);
    expect(JSON.parse(got[0]!.data).t).toBe("café ✓");
  });

  it("stops with an AbortError when the signal aborts", async () => {
    const ctrl = new AbortController();
    const stream = streamOf(["data: 1\n\n", "data: 2\n\n", "data: 3\n\n"]);
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const m of readSse(stream, ctrl.signal)) {
          seen.push(m.data);
          ctrl.abort();
        }
      })(),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual(["1"]);
  });
});

function feed(events: Record<string, unknown>[], onDelta?: (t: string) => void) {
  const acc = new ResponseAccumulator(onDelta);
  const p = new SseParser();
  for (const m of [...p.push(sseText(events)), ...p.flush()]) acc.handle(m);
  return acc.result();
}

describe("ResponseAccumulator", () => {
  it("collects text deltas and succeeds only on response.completed", () => {
    const deltas: string[] = [];
    const r = feed(
      [
        { type: "response.created", response: { model: "gpt-x" } },
        { type: "response.output_text.delta", delta: "Hel" },
        { type: "response.output_text.delta", delta: "lo" },
        { type: "response.completed", response: { model: "gpt-x", output: [] } },
      ],
      (t) => deltas.push(t),
    );
    expect(r).toMatchObject({ status: "completed", text: "Hello", model: "gpt-x", tool_calls: [] });
    expect(deltas).toEqual(["Hel", "lo"]);
  });

  it("assembles streamed function-call arguments", () => {
    const r = feed([
      { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", name: "submit", arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"a":' },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: "1}" },
      { type: "response.function_call_arguments.done", item_id: "fc_1", arguments: '{"a":1}' },
      { type: "response.output_item.done", item: { type: "function_call", id: "fc_1", name: "submit", namespace: "college_compass", arguments: '{"a":1}' } },
      { type: "response.completed", response: {} },
    ]);
    expect(r.tool_calls).toEqual([{ name: "submit", arguments: '{"a":1}', namespace: "college_compass" }]);
  });

  it("prefers the completed response's output when present", () => {
    const r = feed([
      { type: "response.function_call_arguments.delta", item_id: "x", delta: "{bro" },
      {
        type: "response.completed",
        response: {
          model: "m",
          output: [
            { type: "web_search_call", id: "ws" },
            { type: "function_call", id: "x", name: "f", arguments: '{"ok":true}' },
            { type: "message", content: [{ type: "output_text", text: "done" }] },
          ],
        },
      },
    ]);
    expect(r.tool_calls).toEqual([{ name: "f", arguments: '{"ok":true}' }]);
    expect(r.text).toBe("done");
  });

  it("reports failed / incomplete / error / interrupted", () => {
    expect(feed([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } } }])).toMatchObject({
      status: "failed",
      error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" },
    });
    expect(feed([{ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }])).toMatchObject({
      status: "incomplete",
      incomplete_reason: "max_output_tokens",
    });
    expect(feed([{ type: "error", code: "server_error", message: "boom", param: null }])).toMatchObject({ status: "error", error: { code: "server_error" } });
    expect(feed([{ type: "response.output_text.delta", delta: "partial" }])).toMatchObject({ status: "interrupted", text: "partial" });
  });

  it("ignores events after the terminal one and junk data", () => {
    const acc = new ResponseAccumulator();
    acc.handle({ event: "message", data: "not json" });
    acc.handle({ event: "message", data: "[DONE]" });
    acc.handle({ event: "response.completed", data: JSON.stringify({ type: "response.completed", response: {} }) });
    acc.handle({ event: "x", data: JSON.stringify({ type: "response.output_text.delta", delta: "late" }) });
    expect(acc.result()).toMatchObject({ status: "completed", text: "" });
  });
});

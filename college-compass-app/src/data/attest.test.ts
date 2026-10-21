import { describe, expect, it, vi } from "vitest";
import { sha256, toBase64, utf8 } from "../../supabase/functions/attest/appattest/bytes";
import { createHandler } from "../../supabase/functions/attest/handler";
import { fakeDb } from "../attest/fakeDb";
import { fakeApple, fakeAssertion, fakeAttestation, type FakeApple, type KeyPair } from "../attest/testkit";
import type { AppAttestPlugin } from "../platform";
import { ATTEST_RETRY_MS, createAttestor } from "./attest";
import { createSharedLookup, defaultAttestor, type Contribution } from "./shared";

const APP_ID = "C544LPNJ2S.com.gaddu.collegecompass";
const ENDPOINT = "https://x.supabase.co/functions/v1/attest";

const contribution = (name = "Duke University"): Contribution => ({
  install_id: "11111111-1111-4111-8111-111111111111",
  app_version: "1.0.0",
  cycle: "Fall 2027",
  college: { name, state: "NC", admit_rate: 0.06 },
  programs: [{ major: "computer_science", offered: true }],
});

/** DCAppAttestService stand-in producing real (synthetic-chain) attestations and assertions. */
function fakeNative(apple: FakeApple, opts: { supported?: boolean } = {}) {
  let pending: { keyId: string; credential: KeyPair } | null = null;
  let active: { keyId: string; credential: KeyPair } | null = null;
  let counter = 0;
  const calls: string[] = [];
  const plugin: AppAttestPlugin = {
    async status() {
      calls.push("status");
      return { supported: opts.supported ?? true, registered: !!active, ...(active ? { keyId: active.keyId } : {}) };
    },
    async attestKey({ challenge }) {
      calls.push("attestKey");
      const a = await fakeAttestation(apple, { appId: APP_ID, clientDataHash: await sha256(utf8(challenge)) });
      pending = { keyId: a.keyId, credential: a.credential };
      counter = 0;
      return { keyId: a.keyId, attestation: toBase64(a.attestation) };
    },
    async confirmKey({ keyId }) {
      calls.push("confirmKey");
      if (pending?.keyId === keyId) [active, pending] = [pending, null];
    },
    async generateAssertion({ clientData }) {
      calls.push("generateAssertion");
      if (!active) throw Object.assign(new Error("no key"), { code: "NO_KEY" });
      counter++;
      return { keyId: active.keyId, assertion: toBase64(await fakeAssertion(active.credential, APP_ID, utf8(clientData), counter)) };
    },
    async resetKey() {
      calls.push("resetKey");
      active = null;
    },
  };
  return { plugin, calls, forget: () => (active = null) };
}

async function setup(opts: { supported?: boolean; timeoutMs?: number } = {}) {
  const apple = await fakeApple();
  const db = fakeDb();
  const handler = createHandler({ rpc: db.rpc, now: () => apple.now, rootPem: apple.rootPem });
  const requests: { op: unknown }[] = [];
  const doFetch = vi.fn(async (url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return handler(new Request(url, init));
  }) as unknown as typeof fetch;
  const native = fakeNative(apple, opts);
  let clock = apple.now;
  let retryAfter = 0;
  const attestor = createAttestor({
    endpoint: ENDPOINT, apiKey: "pk", native: native.plugin, fetch: doFetch, timeoutMs: opts.timeoutMs,
    now: () => clock, retry: { get: () => retryAfter, set: (ms) => (retryAfter = ms) },
  });
  return { apple, db, native, attestor, requests, doFetch, advance: (ms: number) => (clock += ms) };
}

describe("App Attest contributions (client ↔ edge function ↔ database, real verification)", () => {
  it("first contribution attests a key once, then every contribution is an assertion over the exact payload", async () => {
    const { attestor, native, db, requests } = await setup();
    expect(await attestor.contribute(contribution())).toBe(true);
    expect(native.calls).toEqual(["status", "attestKey", "confirmKey", "generateAssertion"]);
    expect(requests.map((r) => r.op)).toEqual(["challenge", "register", "challenge", "contribute"]);
    expect(db.contributions).toHaveLength(1);
    expect(db.contributions[0]!.payload).toEqual(contribution());

    native.calls.length = 0;
    expect(await attestor.contribute(contribution("NC State"))).toBe(true);
    expect(native.calls).toEqual(["status", "generateAssertion"]);
    expect(db.contributions.map((c) => (c.payload as Contribution).college.name)).toEqual(["Duke University", "NC State"]);
    expect([...db.keys.values()][0]!.counter).toBe(2);
  });

  it("parallel contributions share one attestation and reach the server in counter order", async () => {
    const { attestor, native, db } = await setup();
    const results = await Promise.all(["A", "B", "C", "D"].map((n) => attestor.contribute(contribution(n))));
    expect(results).toEqual([true, true, true, true]);
    expect(native.calls.filter((c) => c === "attestKey")).toHaveLength(1);
    expect(db.contributions).toHaveLength(4);
  });

  it("unsupported (Simulator, old devices): false without any network call, and stops asking", async () => {
    const { attestor, native, doFetch } = await setup({ supported: false });
    expect(await attestor.contribute(contribution())).toBe(false);
    expect(await attestor.contribute(contribution())).toBe(false);
    expect(native.calls).toEqual(["status"]);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("a refused registration falls back and isn't retried for a day", async () => {
    const { attestor, native, db, advance } = await setup();
    db.override("attest_register_key", { status: "rejected", reason: "development_not_allowed" });
    expect(await attestor.contribute(contribution())).toBe(false);
    expect(await attestor.contribute(contribution())).toBe(false);
    expect(native.calls.filter((c) => c === "attestKey")).toHaveLength(1);
    advance(ATTEST_RETRY_MS + 1);
    expect(await attestor.contribute(contribution())).toBe(true);
    expect(native.calls.filter((c) => c === "attestKey")).toHaveLength(2);
  });

  it("a key the server doesn't know is dropped and re-attested next time", async () => {
    const { attestor, native, db } = await setup();
    expect(await attestor.contribute(contribution())).toBe(true);
    db.keys.clear();
    expect(await attestor.contribute(contribution())).toBe(false);
    expect(native.calls).toContain("resetKey");
    expect(await attestor.contribute(contribution())).toBe(true);
    expect(native.calls.filter((c) => c === "attestKey")).toHaveLength(2);
  });

  it("native errors (Apple invalidated the key) and server/network failures fall back", async () => {
    const { attestor, native, db, doFetch } = await setup();
    expect(await attestor.contribute(contribution())).toBe(true);
    (doFetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError("offline"));
    expect(await attestor.contribute(contribution())).toBe(false);
    db.override("attest_new_challenge", new Error("HTTP 500"));
    expect(await attestor.contribute(contribution())).toBe(false);
    native.forget(); // generateAssertion rejects like INVALID_KEY would after the plugin drops the key
    vi.spyOn(native.plugin, "status").mockResolvedValueOnce({ supported: true, registered: true });
    expect(await attestor.contribute(contribution())).toBe(false);
    expect(native.calls.filter((c) => c === "generateAssertion")).toHaveLength(2);
    expect(db.contributions).toHaveLength(1);
  });

  it("is time-boxed: a hung native call falls back, and queued work that timed out is skipped", async () => {
    const { attestor, native, db } = await setup({ timeoutMs: 40 });
    vi.spyOn(native.plugin, "attestKey").mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    expect(await Promise.all([attestor.contribute(contribution("A")), attestor.contribute(contribution("B"))])).toEqual([false, false]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(db.contributions).toHaveLength(0);
  });
});

describe("createSharedLookup().contribute with App Attest", () => {
  const cfg = { url: "https://x.supabase.co", key: "pk" };

  it("doesn't call the anonymous RPC when the attested path delivered it", async () => {
    const doFetch = vi.fn(async () => new Response("{}"));
    const att = { contribute: vi.fn(async () => true) };
    await createSharedLookup(cfg, doFetch as unknown as typeof fetch, 6000, att)!.contribute!(contribution());
    expect(att.contribute).toHaveBeenCalledTimes(1);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("falls back to the anonymous RPC when attestation fails or throws", async () => {
    for (const att of [{ contribute: vi.fn(async () => false) }, { contribute: vi.fn(async () => { throw new Error("boom"); }) }]) {
      const doFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}"));
      await createSharedLookup(cfg, doFetch as unknown as typeof fetch, 6000, att)!.contribute!(contribution());
      expect(doFetch).toHaveBeenCalledTimes(1);
      expect(doFetch.mock.calls[0]![0]).toBe("https://x.supabase.co/rest/v1/rpc/contribute_research");
      expect(JSON.parse(String(doFetch.mock.calls[0]![1]!.body))).toEqual({ payload: contribution() });
    }
  });

  it("web build / tests: no App Attest path at all", () => {
    expect(defaultAttestor(cfg, fetch)).toBeNull();
  });
});

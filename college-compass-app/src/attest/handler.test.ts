import { describe, expect, it } from "vitest";
import { sha256, toBase64, utf8 } from "../../supabase/functions/attest/appattest/bytes";
import { createHandler, createRestRpc } from "../../supabase/functions/attest/handler";
import { fakeDb } from "./fakeDb";
import { AAGUID_DEV, fakeApple, fakeAssertion, fakeAttestation, type FakeApple } from "./testkit";

const APP_ID = "C544LPNJ2S.com.gaddu.collegecompass";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://x.supabase.co/functions/v1/attest", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

async function setup() {
  const apple = await fakeApple();
  const db = fakeDb();
  const handler = createHandler({ rpc: db.rpc, now: () => apple.now, rootPem: apple.rootPem });
  return { apple, db, handler };
}

async function call(handler: (r: Request) => Promise<Response>, body: unknown, headers?: Record<string, string>) {
  const res = await handler(post(body, headers));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, headers: res.headers };
}

async function registered(apple: FakeApple, handler: (r: Request) => Promise<Response>) {
  const ch = (await call(handler, { op: "challenge", purpose: "attest" })).body.challenge as string;
  const att = await fakeAttestation(apple, { appId: APP_ID, clientDataHash: await sha256(utf8(ch)) });
  const reg = await call(handler, { op: "register", key_id: att.keyId, attestation: toBase64(att.attestation), challenge: ch });
  return { ...att, reg };
}

async function contribution(handler: (r: Request) => Promise<Response>, credential: Awaited<ReturnType<typeof registered>>["credential"], keyId: string, counter: number, payload: unknown = { cycle: "Fall 2027" }) {
  const ch = (await call(handler, { op: "challenge", purpose: "assert" })).body.challenge as string;
  const clientData = JSON.stringify({ v: 1, op: "contribute", challenge: ch, payload });
  const assertion = await fakeAssertion(credential, APP_ID, utf8(clientData), counter);
  return { ch, clientData, assertion: toBase64(assertion), send: (over: Record<string, unknown> = {}) => call(handler, { op: "contribute", key_id: keyId, client_data: clientData, assertion: toBase64(assertion), ...over }) };
}

describe("attest edge function", () => {
  it("answers CORS preflight and refuses other methods / bad bodies", async () => {
    const { handler } = await setup();
    const pre = await handler(new Request("https://x/functions/v1/attest", { method: "OPTIONS" }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await handler(new Request("https://x/functions/v1/attest"))).status).toBe(405);
    expect((await call(handler, "not json")).status).toBe(400);
    expect((await call(handler, { op: "nope" })).status).toBe(400);
    expect((await call(handler, { op: "challenge", purpose: "other" })).status).toBe(400);
  });

  it("issues single-use challenges, passing the caller's address for rate limiting", async () => {
    const { handler, db } = await setup();
    const r = await call(handler, { op: "challenge", purpose: "assert" }, { "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(r.status).toBe(200);
    expect(r.body.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(db.calls[0]).toEqual({ fn: "attest_new_challenge", args: { p_challenge: r.body.challenge, p_purpose: "assert", p_ip: "203.0.113.9" } });
    db.override("attest_new_challenge", { status: "rejected", reason: "rate_limited" });
    expect((await call(handler, { op: "challenge", purpose: "assert" })).status).toBe(429);
  });

  it("registers an attested key once; the challenge can't be reused", async () => {
    const { apple, handler, db } = await setup();
    const { keyId, attestation, reg } = await registered(apple, handler);
    expect(reg).toMatchObject({ status: 200, body: { status: "registered", environment: "production" } });
    const stored = db.keys.get(keyId)!;
    expect(stored.counter).toBe(0);
    const args = db.calls.find((c) => c.fn === "attest_register_key")!.args;
    expect(args).toMatchObject({ p_key_id: keyId, p_environment: "production", p_validation_category: null });
    // Same attestation, same challenge again → challenge already used.
    const again = await call(handler, { op: "register", key_id: keyId, attestation: toBase64(attestation), challenge: args.p_challenge });
    expect(again).toMatchObject({ status: 403, body: { reason: "bad_challenge" } });
  });

  it("rejects attestations over another challenge, from development builds (unless allowed) or with garbage", async () => {
    const { apple, handler, db } = await setup();
    const ch = (await call(handler, { op: "challenge", purpose: "attest" })).body.challenge as string;
    const wrong = await fakeAttestation(apple, { appId: APP_ID, clientDataHash: await sha256(utf8("something else")) });
    expect(await call(handler, { op: "register", key_id: wrong.keyId, attestation: toBase64(wrong.attestation), challenge: ch })).toMatchObject({ status: 400, body: { reason: "bad_nonce" } });

    const dev = await fakeAttestation(apple, { appId: APP_ID, clientDataHash: await sha256(utf8(ch)), aaguid: AAGUID_DEV });
    expect(await call(handler, { op: "register", key_id: dev.keyId, attestation: toBase64(dev.attestation), challenge: ch })).toMatchObject({ status: 403, body: { reason: "development_not_allowed" } });
    db.settings.allowDevelopment = true;
    const ch2 = (await call(handler, { op: "challenge", purpose: "attest" })).body.challenge as string;
    const dev2 = await fakeAttestation(apple, { appId: APP_ID, clientDataHash: await sha256(utf8(ch2)), aaguid: AAGUID_DEV });
    expect(await call(handler, { op: "register", key_id: dev2.keyId, attestation: toBase64(dev2.attestation), challenge: ch2 })).toMatchObject({ status: 200, body: { environment: "development" } });

    expect((await call(handler, { op: "register", key_id: "short", attestation: "AAAA", challenge: ch })).status).toBe(400);
    expect(await call(handler, { op: "register", key_id: wrong.keyId, attestation: "AAAA", challenge: ch })).toMatchObject({ status: 400, body: { reason: "malformed" } });
  });

  it("accepts a contribution signed by the attested key and hands the exact signed payload to the database", async () => {
    const { apple, handler, db } = await setup();
    const { keyId, credential } = await registered(apple, handler);
    const payload = { install_id: "11111111-1111-4111-8111-111111111111", cycle: "Fall 2027", college: { name: "Duke University" }, programs: [] };
    const c = await contribution(handler, credential, keyId, 1, payload);
    const r = await c.send();
    expect(r).toMatchObject({ status: 200, body: { status: "accepted", attested: true } });
    expect(db.contributions).toEqual([{ payload, key_id: keyId }]);
    const args = db.calls.find((x) => x.fn === "contribute_research_attested")!.args;
    expect(args).toMatchObject({ p_key_id: keyId, p_counter: 1, p_challenge: c.ch });
    // Replaying the same request: the counter (and challenge) were used.
    expect((await c.send()).status).toBe(409);
    // The next assertion (counter 2) works.
    expect((await (await contribution(handler, credential, keyId, 2)).send()).status).toBe(200);
  });

  it("rejects tampered payloads, unknown or revoked keys, and unsigned client data shapes", async () => {
    const { apple, handler, db } = await setup();
    const { keyId, credential } = await registered(apple, handler);
    const c = await contribution(handler, credential, keyId, 1, { a: 1 });
    expect(await c.send({ client_data: c.clientData.replace('"a":1', '"a":2') })).toMatchObject({ status: 400, body: { reason: "bad_signature" } });
    expect(await c.send({ key_id: toBase64(new Uint8Array(32)) })).toMatchObject({ status: 404, body: { reason: "unknown_key" } });
    db.keys.get(keyId)!.revoked = true;
    expect(await c.send()).toMatchObject({ status: 403, body: { reason: "revoked_key" } });
    db.keys.get(keyId)!.revoked = false;

    // Correctly signed, but the client data doesn't carry a challenge + payload.
    const bad = JSON.stringify({ v: 1, op: "contribute", payload: { a: 1 } });
    const as = await fakeAssertion(credential, APP_ID, utf8(bad), 3);
    expect(await call(handler, { op: "contribute", key_id: keyId, client_data: bad, assertion: toBase64(as) })).toMatchObject({ status: 400, body: { reason: "bad_client_data" } });
    // A signed but unknown/expired challenge is refused by the database (consumed check).
    const stale = JSON.stringify({ v: 1, op: "contribute", challenge: "A".repeat(43), payload: { a: 1 } });
    const as2 = await fakeAssertion(credential, APP_ID, utf8(stale), 4);
    expect(await call(handler, { op: "contribute", key_id: keyId, client_data: stale, assertion: toBase64(as2) })).toMatchObject({ status: 409, body: { reason: "bad_challenge" } });
  });

  it("a database content rejection still counts as handled (200), a database outage is 503", async () => {
    const { apple, handler, db } = await setup();
    const { keyId, credential } = await registered(apple, handler);
    const c = await contribution(handler, credential, keyId, 1);
    db.override("contribute_research_attested", { status: "rejected", reason: "unknown_college" });
    expect(await c.send()).toMatchObject({ status: 200, body: { status: "rejected", reason: "unknown_college", attested: true } });
    const c2 = await contribution(handler, credential, keyId, 2);
    db.override("attest_key_info", new Error("HTTP 500"));
    expect(await c2.send()).toMatchObject({ status: 503, body: { reason: "unavailable" } });
  });
});

describe("createRestRpc", () => {
  it("posts to PostgREST with the service key (Authorization only for JWT keys) and throws on HTTP errors", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ ok: 1 }), { status: url.includes("fail") ? 500 : 200 });
    }) as unknown as typeof fetch;
    expect(await createRestRpc("https://p.supabase.co/", "eyJhbGciOi.service", f)("attest_key_info", { p_key_id: "k" })).toEqual({ ok: 1 });
    expect(seen[0]!.url).toBe("https://p.supabase.co/rest/v1/rpc/attest_key_info");
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer eyJhbGciOi.service");
    await createRestRpc("https://p.supabase.co", "sb_secret_x", f)("x", {});
    expect((seen[1]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    await expect(createRestRpc("https://fail", "k", f)("x", {})).rejects.toThrow("HTTP 500");
  });
});

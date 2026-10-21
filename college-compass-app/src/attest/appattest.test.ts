import { describe, expect, it } from "vitest";
import { concat, fromBase64, sha256, toBase64, utf8 } from "../../supabase/functions/attest/appattest/bytes";
import { decodeCbor, decodeCborExact } from "../../supabase/functions/attest/appattest/cbor";
import { parseCertificate, pemToDer } from "../../supabase/functions/attest/appattest/der";
import { P256, P384, verifyDigest } from "../../supabase/functions/attest/appattest/ecdsa";
import {
  APPLE_APP_ATTESTATION_ROOT_CA,
  AttestError,
  verifyAssertion,
  verifyAttestation,
  type AttestFailure,
} from "../../supabase/functions/attest/appattest/verify";
import appleGuide from "./fixtures/apple-guide.json";
import nodeAppAttest from "./fixtures/node-app-attest.json";
import {
  AAGUID_DEV,
  basicConstraints,
  cbor,
  certificate,
  criticalUnknown,
  DAY,
  fakeApple,
  fakeAssertion,
  fakeAttestation,
  keyPair,
  nonceExtension,
  sign,
} from "./testkit";

const subtle = globalThis.crypto.subtle;

async function failure(p: Promise<unknown>): Promise<AttestFailure | "ok" | string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof AttestError ? e.reason : `unexpected: ${String(e)}`;
  }
}

describe("pinned Apple App Attestation Root CA", () => {
  it("parses, is a P-384 CA valid until 2045, and verifies its own signature", async () => {
    const root = parseCertificate(pemToDer(APPLE_APP_ATTESTATION_ROOT_CA));
    expect(root.curve).toBe("1.3.132.0.34");
    expect(new Date(root.notAfter).toISOString()).toBe("2045-03-15T00:00:00.000Z");
    const fp = Array.from(await sha256(root.raw), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    expect(fp).toBe("1CB9823BA28BA6AD2D33A006941DE2AE4F513EF1D4E831B9F7E0FA7B6242C932");
    const digest = new Uint8Array(await subtle.digest("SHA-384", root.tbs.slice()));
    expect(verifyDigest(P384, root.publicKey, digest, root.signature)).toBe(true);
  });
});

describe("verifyAttestation — real attestation objects", () => {
  it("Apple's documented sample (production, with validation-category extensions)", async () => {
    const v = await verifyAttestation(fromBase64(appleGuide.attestation), {
      appId: `${appleGuide.teamId}.${appleGuide.bundleId}`,
      keyId: appleGuide.keyId,
      // Apple's sample app passed the raw challenge bytes as clientDataHash.
      clientDataHash: utf8(appleGuide.challenge),
      now: Date.UTC(2026, 3, 21),
    });
    expect(v.environment).toBe("production");
    expect(v.keyId).toBe(appleGuide.keyId);
    expect(v.publicKey.length).toBe(65);
    expect(toBase64(await sha256(v.publicKey))).toBe(appleGuide.keyId);
    expect(v.validationCategory).toBe(1);
    expect(v.bundleVersion).toBe("1");
    expect(v.receipt.length).toBeGreaterThan(1000);
  });

  const opts = (env: "development" | "production") => ({
    appId: `${nodeAppAttest.teamId}.${nodeAppAttest.bundleId}`,
    keyId: nodeAppAttest[env].keyId,
    clientDataHash: undefined as unknown as Uint8Array,
    now: Date.UTC(2024, 1, 10),
  });

  it("a development (sandbox) key from a device: accepted only when development is allowed", async () => {
    const o = { ...opts("development"), clientDataHash: await sha256(fromBase64(nodeAppAttest.development.challenge)) };
    const att = fromBase64(nodeAppAttest.development.attestation);
    expect(await failure(verifyAttestation(att, o))).toBe("development_not_allowed");
    const v = await verifyAttestation(att, { ...o, allowDevelopment: true });
    expect(v.environment).toBe("development");
    expect(v.validationCategory).toBeNull();
  });

  it("a production key from a device", async () => {
    const o = { ...opts("production"), clientDataHash: await sha256(fromBase64(nodeAppAttest.production.challenge)) };
    const v = await verifyAttestation(fromBase64(nodeAppAttest.production.attestation), o);
    expect(v.environment).toBe("production");
    expect(v.keyId).toBe(nodeAppAttest.production.keyId);
  });

  describe("rejects tampering with Apple's sample", () => {
    const base = () => ({
      appId: `${appleGuide.teamId}.${appleGuide.bundleId}`,
      keyId: appleGuide.keyId,
      clientDataHash: utf8(appleGuide.challenge),
      now: Date.UTC(2026, 3, 21),
    });
    const att = () => fromBase64(appleGuide.attestation);

    it("another challenge", async () => {
      expect(await failure(verifyAttestation(att(), { ...base(), clientDataHash: utf8("another_challenge") }))).toBe("bad_nonce");
    });
    it("another app (our App ID)", async () => {
      expect(await failure(verifyAttestation(att(), { ...base(), appId: "C544LPNJ2S.com.gaddu.collegecompass" }))).toBe("rp_id_mismatch");
    });
    it("another key id", async () => {
      expect(await failure(verifyAttestation(att(), { ...base(), keyId: toBase64(new Uint8Array(32)) }))).toBe("key_id_mismatch");
    });
    it("expired credential certificate", async () => {
      expect(await failure(verifyAttestation(att(), { ...base(), now: Date.UTC(2026, 3, 24) }))).toBe("cert_expired");
    });
    it("a different trust anchor", async () => {
      const apple = await fakeApple();
      expect(await failure(verifyAttestation(att(), { ...base(), rootPem: apple.rootPem }))).toBe("bad_chain");
    });
    it("a flipped bit in the authenticator data", async () => {
      const b = att();
      // authData is the last CBOR item; flip a bit inside the COSE key region near the end.
      b[b.length - 80] ^= 0x01;
      expect(["bad_nonce", "malformed"]).toContain(await failure(verifyAttestation(b, base())));
    });
    it("truncated / garbage input", async () => {
      expect(await failure(verifyAttestation(att().subarray(0, 100), base()))).toBe("malformed");
      expect(await failure(verifyAttestation(utf8("hello"), base()))).toBe("malformed");
      expect(await failure(verifyAttestation(cbor(new Map([["fmt", "packed"]])), base()))).toBe("bad_format");
    });
  });
});

describe("verifyAssertion — real assertion", () => {
  const a = nodeAppAttest.assertion;
  const appId = `${nodeAppAttest.teamId}.${nodeAppAttest.bundleId}`;
  const spki = fromBase64(a.publicKeyPem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""));
  const publicKey = spki.subarray(spki.length - 65);

  it("verifies and returns the counter", async () => {
    const v = await verifyAssertion(fromBase64(a.assertion), { appId, publicKey, clientData: utf8(a.clientData), previousCounter: 0 });
    expect(v.counter).toBe(1);
  });
  it("rejects a replay (counter not increasing)", async () => {
    expect(await failure(verifyAssertion(fromBase64(a.assertion), { appId, publicKey, clientData: utf8(a.clientData), previousCounter: 1 }))).toBe("replay");
  });
  it("rejects other client data, another key or another app", async () => {
    expect(await failure(verifyAssertion(fromBase64(a.assertion), { appId, publicKey, clientData: utf8(a.clientData + " "), previousCounter: 0 }))).toBe("bad_signature");
    const other = await keyPair("P-256");
    expect(await failure(verifyAssertion(fromBase64(a.assertion), { appId, publicKey: other.raw, clientData: utf8(a.clientData), previousCounter: 0 }))).toBe("bad_signature");
    expect(await failure(verifyAssertion(fromBase64(a.assertion), { appId: "C544LPNJ2S.com.gaddu.collegecompass", publicKey, clientData: utf8(a.clientData), previousCounter: 0 }))).toBe("rp_id_mismatch");
  });
});

describe("verifyAttestation — every check, with a synthetic chain (injected root)", () => {
  const appId = "C544LPNJ2S.com.gaddu.collegecompass";
  const cdh = utf8("0123456789abcdef0123456789abcdef");

  it("accepts a well-formed attestation and records the validation category", async () => {
    const apple = await fakeApple();
    const { attestation, keyId } = await fakeAttestation(apple, {
      appId, clientDataHash: cdh,
      extensions: new Map<string | number, never>([["apple_validation_category_01", Uint8Array.of(4, 0, 0, 0) as never], ["apple_bundle_version_01", "7" as never]]),
    });
    const v = await verifyAttestation(attestation, { appId, keyId, clientDataHash: cdh, now: apple.now, rootPem: apple.rootPem });
    expect(v).toMatchObject({ environment: "production", keyId, validationCategory: 4, bundleVersion: "7" });
    // The real Apple root does not accept it.
    expect(await failure(verifyAttestation(attestation, { appId, keyId, clientDataHash: cdh, now: apple.now }))).toBe("bad_chain");
  });

  it.each([
    ["counter must be 0", { counter: 1 }, "bad_counter"],
    ["unknown aaguid", { aaguid: utf8("somethingelse!!!") }, "bad_aaguid"],
    ["development aaguid", { aaguid: AAGUID_DEV }, "development_not_allowed"],
    ["denied validation category 0", { extensions: new Map([["apple_validation_category_01", Uint8Array.of(0, 0, 0, 0)]]) }, "bad_validation_category"],
    ["missing nonce extension", { leafExtensions: () => [basicConstraints(false)] }, "bad_nonce"],
    ["wrong nonce", { leafExtensions: () => [basicConstraints(false), nonceExtension(new Uint8Array(32))] }, "bad_nonce"],
    ["credential certificate is a CA", { leafExtensions: (n: Uint8Array) => [basicConstraints(true), nonceExtension(n)] }, "bad_chain"],
    ["unknown critical extension", { leafExtensions: (n: Uint8Array) => [basicConstraints(false), nonceExtension(n), criticalUnknown] }, "bad_chain"],
    ["credential id ≠ public key hash", { keyIdOverride: new Uint8Array(32).fill(7) }, "key_id_mismatch"],
  ] as const)("%s", async (_name, over, reason) => {
    const apple = await fakeApple();
    const { attestation, keyId } = await fakeAttestation(apple, { appId, clientDataHash: cdh, ...(over as object) });
    expect(await failure(verifyAttestation(attestation, { appId, keyId, clientDataHash: cdh, now: apple.now, rootPem: apple.rootPem }))).toBe(reason);
  });

  it("development keys pass when allowed", async () => {
    const apple = await fakeApple();
    const { attestation, keyId } = await fakeAttestation(apple, { appId, clientDataHash: cdh, aaguid: AAGUID_DEV });
    const v = await verifyAttestation(attestation, { appId, keyId, clientDataHash: cdh, now: apple.now, rootPem: apple.rootPem, allowDevelopment: true });
    expect(v.environment).toBe("development");
  });

  it("credential certificate signed by someone else", async () => {
    const apple = await fakeApple();
    const { attestation, keyId } = await fakeAttestation(apple, { appId, clientDataHash: cdh, leafSigner: await keyPair("P-384") });
    expect(await failure(verifyAttestation(attestation, { appId, keyId, clientDataHash: cdh, now: apple.now, rootPem: apple.rootPem }))).toBe("bad_chain");
  });

  it("intermediate that isn't a CA, or signed by another root", async () => {
    const apple = await fakeApple();
    const notCa = await certificate({
      subject: "Test App Attestation CA 1", issuer: "Test App Attestation Root CA", key: apple.intermediate, signer: apple.root, hash: "SHA-384",
      notBefore: apple.now - DAY, notAfter: apple.now + DAY, extensions: [basicConstraints(false)],
    });
    let r = await fakeAttestation(apple, { appId, clientDataHash: cdh, intermediateDer: notCa });
    expect(await failure(verifyAttestation(r.attestation, { appId, keyId: r.keyId, clientDataHash: cdh, now: apple.now, rootPem: apple.rootPem }))).toBe("bad_chain");
    const rogueRoot = await keyPair("P-384");
    const rogue = await certificate({
      subject: "Test App Attestation CA 1", issuer: "Test App Attestation Root CA", key: apple.intermediate, signer: rogueRoot, hash: "SHA-384",
      notBefore: apple.now - DAY, notAfter: apple.now + DAY, extensions: [basicConstraints(true)],
    });
    r = await fakeAttestation(apple, { appId, clientDataHash: cdh, intermediateDer: rogue });
    expect(await failure(verifyAttestation(r.attestation, { appId, keyId: r.keyId, clientDataHash: cdh, now: apple.now, rootPem: apple.rootPem }))).toBe("bad_chain");
  });

  it("expired credential certificate, COSE key ≠ certificate key", async () => {
    const apple = await fakeApple();
    let r = await fakeAttestation(apple, { appId, clientDataHash: cdh, leafNotAfter: apple.now - 1000 });
    expect(await failure(verifyAttestation(r.attestation, { appId, keyId: r.keyId, clientDataHash: cdh, now: apple.now, rootPem: apple.rootPem }))).toBe("cert_expired");
    r = await fakeAttestation(apple, { appId, clientDataHash: cdh, coseKey: await keyPair("P-256") });
    expect(await failure(verifyAttestation(r.attestation, { appId, keyId: r.keyId, clientDataHash: cdh, now: apple.now, rootPem: apple.rootPem }))).toBe("malformed");
  });

  it("assertions from the attested key: counter, signature, client data, app", async () => {
    const apple = await fakeApple();
    const { credential } = await fakeAttestation(apple, { appId, clientDataHash: cdh });
    const data = utf8(JSON.stringify({ v: 1, op: "contribute", challenge: "c", payload: { a: 1 } }));
    const as = await fakeAssertion(credential, appId, data, 5);
    expect((await verifyAssertion(as, { appId, publicKey: credential.raw, clientData: data, previousCounter: 4 })).counter).toBe(5);
    expect(await failure(verifyAssertion(as, { appId, publicKey: credential.raw, clientData: data, previousCounter: 5 }))).toBe("replay");
    expect(await failure(verifyAssertion(as, { appId, publicKey: credential.raw, clientData: utf8("{}"), previousCounter: 0 }))).toBe("bad_signature");
    const other = await fakeAssertion(credential, "XXXXXXXXXX.com.example.other", data, 9);
    expect(await failure(verifyAssertion(other, { appId, publicKey: credential.raw, clientData: data, previousCounter: 0 }))).toBe("rp_id_mismatch");
    const denied = await fakeAssertion(credential, appId, data, 6, new Map([["apple_validation_category_01", Uint8Array.of(8, 0, 0, 0)]]));
    expect(await failure(verifyAssertion(denied, { appId, publicKey: credential.raw, clientData: data, previousCounter: 0 }))).toBe("bad_validation_category");
  });
});

describe("ECDSA (BigInt) agrees with WebCrypto", () => {
  const cases = [
    ["P-256", "SHA-256"],
    ["P-384", "SHA-256"], // App Attest credential certificates: P-384 issuer, ecdsa-with-SHA256
    ["P-384", "SHA-384"],
    ["P-256", "SHA-384"], // hash longer than the curve: truncated
  ] as const;
  it.each(cases)("%s / %s on random keys and messages", async (curveName, hash) => {
    const curve = curveName === "P-256" ? P256 : P384;
    for (let i = 0; i < 8; i++) {
      const k = await keyPair(curveName);
      const msg = crypto.getRandomValues(new Uint8Array(1 + i * 37));
      const sig = await sign(k, hash, msg);
      const digest = new Uint8Array(await subtle.digest(hash, msg.slice()));
      expect(verifyDigest(curve, k.raw, digest, sig)).toBe(true);
      const bad = digest.slice();
      bad[i % bad.length] ^= 0x80;
      expect(verifyDigest(curve, k.raw, bad, sig)).toBe(false);
      const otherKey = await keyPair(curveName);
      expect(verifyDigest(curve, otherKey.raw, digest, sig)).toBe(false);
    }
  });
  it("rejects out-of-range r/s, off-curve keys and malformed DER", async () => {
    const k = await keyPair("P-256");
    const d = new Uint8Array(32).fill(1);
    const der = (r: Uint8Array, s: Uint8Array) => concat(Uint8Array.of(0x30, r.length + s.length + 4, 0x02, r.length), r, Uint8Array.of(0x02, s.length), s);
    expect(verifyDigest(P256, k.raw, d, der(Uint8Array.of(0), Uint8Array.of(1)))).toBe(false);
    const n = fromBase64(toBase64(Uint8Array.from((P256.n.toString(16).match(/../g) ?? []).map((h) => parseInt(h, 16)))));
    expect(verifyDigest(P256, k.raw, d, der(concat(Uint8Array.of(0), n), Uint8Array.of(1)))).toBe(false);
    const offCurve = k.raw.slice();
    offCurve[64] ^= 1;
    const sig = await sign(k, "SHA-256", d);
    expect(verifyDigest(P256, offCurve, await sha256(d), sig)).toBe(false);
    expect(verifyDigest(P256, k.raw, await sha256(d), sig.subarray(0, sig.length - 1))).toBe(false);
  });
});

describe("CBOR decoder", () => {
  it("decodes maps, arrays, negative ints and reports the end offset", () => {
    const enc = cbor(new Map<string | number, never>([[1, 2 as never], [-2, Uint8Array.of(9) as never], ["k", ["a", 3] as never]]));
    const { value, end } = decodeCbor(concat(enc, Uint8Array.of(0xff)));
    expect(end).toBe(enc.length);
    expect(value).toEqual(new Map<string | number, unknown>([[1, 2], [-2, Uint8Array.of(9)], ["k", ["a", 3]]]));
  });
  it("rejects indefinite lengths, tags, trailing bytes, duplicates and truncation", () => {
    expect(() => decodeCborExact(Uint8Array.of(0x5f, 0xff))).toThrow();
    expect(() => decodeCborExact(Uint8Array.of(0xc0, 0x00))).toThrow();
    expect(() => decodeCborExact(Uint8Array.of(0x01, 0x02))).toThrow();
    expect(() => decodeCborExact(Uint8Array.of(0xa2, 0x01, 0x01, 0x01, 0x02))).toThrow();
    expect(() => decodeCborExact(Uint8Array.of(0x5a, 0xff, 0xff, 0xff, 0xff, 0x00))).toThrow();
  });
});

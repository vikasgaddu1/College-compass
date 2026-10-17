import { describe, expect, it, vi } from "vitest";
import { verifyIdToken } from "./jwt";
import { makeSigner } from "./test-helpers";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const claims = (over: Record<string, unknown> = {}) => ({
  iss: "https://auth.openai.com", aud: "client-1", sub: "user-123", nonce: "n1",
  iat: NOW / 1000 - 10, exp: NOW / 1000 + 3600, email: "a@b.c", ...over,
});
const base = { issuer: "https://auth.openai.com", audience: "client-1", nonce: "n1", nowMs: NOW };

describe("verifyIdToken", () => {
  it("verifies signature and claims", async () => {
    const s = await makeSigner();
    const token = await s.sign(claims());
    const r = await verifyIdToken(token, { ...base, getKeys: async () => [s.jwk] });
    expect(r.signatureVerified).toBe(true);
    expect(r.claims.sub).toBe("user-123");
  });

  it("rejects a bad signature, wrong nonce/aud/iss and expired tokens", async () => {
    const s = await makeSigner();
    const other = await makeSigner();
    const keys = async () => [s.jwk];
    await expect(verifyIdToken(await other.sign(claims()), { ...base, getKeys: keys })).rejects.toThrow(/signature/);
    await expect(verifyIdToken(await s.sign(claims({ nonce: "x" })), { ...base, getKeys: keys })).rejects.toThrow(/nonce/);
    await expect(verifyIdToken(await s.sign(claims({ aud: "other" })), { ...base, getKeys: keys })).rejects.toThrow(/audience/);
    await expect(verifyIdToken(await s.sign(claims({ iss: "https://evil" })), { ...base, getKeys: keys })).rejects.toThrow(/issuer/);
    await expect(verifyIdToken(await s.sign(claims({ exp: NOW / 1000 - 60 })), { ...base, getKeys: keys })).rejects.toThrow(/expired/);
    await expect(verifyIdToken(await s.sign(claims(), { alg: "none" }), { ...base, getKeys: keys })).rejects.toThrow(/algorithm/);
  });

  it("refreshes the key set once for an unknown kid", async () => {
    const s = await makeSigner("new");
    const old = await makeSigner("old");
    const getKeys = vi.fn(async ({ refresh }: { refresh: boolean }) => (refresh ? [old.jwk, s.jwk] : [old.jwk]));
    const r = await verifyIdToken(await s.sign(claims()), { ...base, getKeys });
    expect(r.signatureVerified).toBe(true);
    expect(getKeys).toHaveBeenCalledTimes(2);
  });

  it("falls back to claim checks with a warning when JWKS can't be fetched", async () => {
    const s = await makeSigner();
    const warn = vi.fn();
    const r = await verifyIdToken(await s.sign(claims()), { ...base, getKeys: async () => null, warn });
    expect(r.signatureVerified).toBe(false);
    expect(warn).toHaveBeenCalled();
    await expect(verifyIdToken(await s.sign(claims({ nonce: "bad" })), { ...base, getKeys: async () => null, warn })).rejects.toThrow(/nonce/);
  });
});

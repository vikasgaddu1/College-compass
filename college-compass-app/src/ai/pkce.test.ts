import { describe, expect, it } from "vitest";
import { base64url, base64urlDecode, codeChallengeS256, createPkce, randomString } from "./pkce";

describe("pkce", () => {
  it("base64url-encodes without padding and round-trips", () => {
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe("-__-");
    expect(base64url(new Uint8Array([1]))).toBe("AQ");
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect([...base64urlDecode(base64url(bytes))]).toEqual([...bytes]);
  });

  it("computes the S256 challenge as base64url(SHA-256(verifier))", async () => {
    // SHA-256("abc") = ba7816bf…15ad
    expect(await codeChallengeS256("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });

  it("creates RFC 7636-compliant verifiers", async () => {
    const { verifier, challenge } = await createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(challenge).toBe(await codeChallengeS256(verifier));
    expect(randomString(32)).toHaveLength(43);
    expect(randomString()).not.toBe(randomString());
  });
});

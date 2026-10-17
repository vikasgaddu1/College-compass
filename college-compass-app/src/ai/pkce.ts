/** PKCE / OAuth helpers built on Web Crypto (browser, WKWebView and Node ≥ 20). */

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("Web Crypto is not available in this browser.");
  return c.subtle;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** RFC 4648 §5 base64url without padding. */
export function base64url(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(s: string): Uint8Array {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** URL-safe random string with `bytes` of entropy (32 bytes → 43 chars). */
export function randomString(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

export async function sha256(input: string): Promise<Uint8Array> {
  const digest = await subtle().digest("SHA-256", new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

/** S256 code challenge: base64url(SHA-256(verifier)), no padding. */
export async function codeChallengeS256(verifier: string): Promise<string> {
  return base64url(await sha256(verifier));
}

/** RFC 7636 verifier (43–128 chars from the unreserved set) + its S256 challenge. */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomString(48); // 64 chars
  return { verifier, challenge: await codeChallengeS256(verifier) };
}

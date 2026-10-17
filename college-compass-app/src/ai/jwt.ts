/** Minimal OIDC ID-token verification (RS256 via Web Crypto + claim checks). */
import { base64urlDecode } from "./pkce";

export interface JwtParts {
  header: { alg?: string; kid?: string; typ?: string };
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
}

function decodeJson(seg: string): any {
  return JSON.parse(new TextDecoder().decode(base64urlDecode(seg)));
}

export function decodeJwt(token: string): JwtParts {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed ID token.");
  return {
    header: decodeJson(parts[0]!),
    payload: decodeJson(parts[1]!),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: base64urlDecode(parts[2]!),
  };
}

export interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

export interface VerifyOptions {
  issuer: string;
  audience: string;
  nonce: string;
  /** Returns the JWKS keys, or null when they cannot be fetched (claims-only fallback). */
  getKeys: (opts: { refresh: boolean }) => Promise<Jwk[] | null>;
  nowMs?: number;
  /** Clock tolerance in seconds (OpenAI's example uses 5). */
  toleranceSec?: number;
  warn?: (msg: string) => void;
}

export interface VerifyResult {
  claims: Record<string, unknown>;
  signatureVerified: boolean;
}

async function verifyRs256(parts: JwtParts, jwk: Jwk): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true } as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sig = new Uint8Array(parts.signature);
  const data = new TextEncoder().encode(parts.signingInput);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
}

function pickKey(keys: Jwk[], kid: string | undefined): Jwk | undefined {
  const rsa = keys.filter((k) => k.kty === "RSA" && (!k.use || k.use === "sig"));
  if (kid) return rsa.find((k) => k.kid === kid);
  return rsa.length === 1 ? rsa[0] : undefined;
}

/**
 * Verify an ID token: iss, aud, exp (+iat/nbf sanity), nonce, sub, and the RS256 signature
 * against the JWKS. If the JWKS cannot be fetched (e.g. CORS), only the claims are checked and
 * a warning is logged — the token came straight from the token endpoint over TLS in exchange
 * for our PKCE verifier, so this is defence in depth rather than the sole protection.
 */
export async function verifyIdToken(token: string, o: VerifyOptions): Promise<VerifyResult> {
  const parts = decodeJwt(token);
  const c = parts.payload;
  const now = Math.floor((o.nowMs ?? Date.now()) / 1000);
  const tol = o.toleranceSec ?? 5;

  if (c.iss !== o.issuer) throw new Error("ID token issuer mismatch.");
  const aud = c.aud;
  const audOk = Array.isArray(aud) ? aud.includes(o.audience) : aud === o.audience;
  if (!audOk) throw new Error("ID token audience mismatch.");
  if (Array.isArray(aud) && aud.length > 1 && c.azp != null && c.azp !== o.audience) {
    throw new Error("ID token authorized party mismatch.");
  }
  if (typeof c.exp !== "number" || c.exp + tol < now) throw new Error("ID token expired.");
  if (typeof c.iat !== "number" || c.iat - tol > now + 60) throw new Error("ID token issued in the future.");
  if (typeof c.nbf === "number" && c.nbf - tol > now) throw new Error("ID token not yet valid.");
  if (c.nonce !== o.nonce) throw new Error("ID token nonce mismatch.");
  if (typeof c.sub !== "string" || !c.sub) throw new Error("ID token has no subject.");

  if (parts.header.alg !== "RS256") throw new Error(`Unexpected ID token algorithm ${String(parts.header.alg)}.`);

  let keys = await o.getKeys({ refresh: false }).catch(() => null);
  if (!keys) {
    (o.warn ?? console.warn)("[auth] Could not fetch OpenAI JWKS; ID token claims were checked but the signature was not.");
    return { claims: c, signatureVerified: false };
  }
  let jwk = pickKey(keys, parts.header.kid);
  if (!jwk) {
    // Unfamiliar kid → refresh the key set once (key rotation).
    keys = await o.getKeys({ refresh: true }).catch(() => null);
    jwk = keys ? pickKey(keys, parts.header.kid) : undefined;
  }
  if (!jwk) throw new Error("ID token signing key not found.");
  const ok = await verifyRs256(parts, jwk);
  if (!ok) throw new Error("ID token signature is invalid.");
  return { claims: c, signatureVerified: true };
}

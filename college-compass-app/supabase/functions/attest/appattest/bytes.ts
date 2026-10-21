/**
 * Byte helpers shared by the App Attest verifier. Plain TypeScript on top of Web APIs
 * (atob/btoa, TextEncoder, crypto.subtle) so the same module runs in the Supabase Edge Runtime
 * (Deno) and in Node/Vitest.
 */

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error("not base64");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function toBase64Url(b: Uint8Array): string {
  return toBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function bytesToBigInt(b: Uint8Array): bigint {
  return b.length ? BigInt("0x" + toHex(b)) : 0n;
}

async function digest(alg: "SHA-256" | "SHA-384", data: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer-backed view (subarrays of larger buffers are fine either way).
  return new Uint8Array(await crypto.subtle.digest(alg, data.slice()));
}

export const sha256 = (data: Uint8Array) => digest("SHA-256", data);
export const sha384 = (data: Uint8Array) => digest("SHA-384", data);

/**
 * ECDSA signature verification (SEC 1 v2 §4.1.4) on NIST P-256 and P-384 with BigInt arithmetic.
 *
 * Why not WebCrypto: App Attest's credential certificate is signed with ecdsa-with-SHA256 by a P-384
 * key (a curve/hash pairing some WebCrypto implementations — including older Deno releases the Edge
 * Runtime may be built on — don't support or silently compute with the curve's default hash). Doing
 * the (public-data, verify-only) arithmetic here makes the result identical in Deno and Node; the
 * unit tests cross-check it against Node's WebCrypto on random keys and messages.
 * Hashing still uses crypto.subtle.digest.
 */
import { bytesToBigInt } from "./bytes.ts";
import { DerError, TAG, children, expectTag, readExact } from "./der.ts";

export interface Curve {
  name: "P-256" | "P-384";
  p: bigint;
  a: bigint;
  b: bigint;
  n: bigint;
  gx: bigint;
  gy: bigint;
  /** Coordinate size in bytes. */
  size: number;
}

export const P256: Curve = {
  name: "P-256",
  p: 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn,
  a: 0xffffffff00000001000000000000000000000000fffffffffffffffffffffffcn,
  b: 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn,
  n: 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
  gx: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
  gy: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
  size: 32,
};

export const P384: Curve = {
  name: "P-384",
  p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffffn,
  a: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000fffffffcn,
  b: 0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aefn,
  n: 0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973n,
  gx: 0xaa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7n,
  gy: 0x3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5fn,
  size: 48,
};

const mod = (a: bigint, m: bigint) => {
  const r = a % m;
  return r < 0n ? r + m : r;
};

function inv(a: bigint, m: bigint): bigint {
  let [r0, r1] = [mod(a, m), m];
  let [s0, s1] = [1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error("not invertible");
  return mod(s0, m);
}

/** Jacobian point (X/Z², Y/Z³); Z = 0 is the point at infinity. */
type J = [bigint, bigint, bigint];
const INF: J = [1n, 1n, 0n];

function dbl(c: Curve, [x, y, z]: J): J {
  if (z === 0n || y === 0n) return INF;
  const p = c.p;
  // dbl-2001-b (a = -3)
  const delta = mod(z * z, p);
  const gamma = mod(y * y, p);
  const beta = mod(x * gamma, p);
  const alpha = mod(3n * (x - delta) * (x + delta), p);
  const x3 = mod(alpha * alpha - 8n * beta, p);
  const z3 = mod((y + z) * (y + z) - gamma - delta, p);
  const y3 = mod(alpha * (4n * beta - x3) - 8n * gamma * gamma, p);
  return [x3, y3, z3];
}

function add(c: Curve, P: J, Q: J): J {
  if (P[2] === 0n) return Q;
  if (Q[2] === 0n) return P;
  const p = c.p;
  const [x1, y1, z1] = P;
  const [x2, y2, z2] = Q;
  // add-2007-bl
  const z1z1 = mod(z1 * z1, p);
  const z2z2 = mod(z2 * z2, p);
  const u1 = mod(x1 * z2z2, p);
  const u2 = mod(x2 * z1z1, p);
  const s1 = mod(y1 * z2 * z2z2, p);
  const s2 = mod(y2 * z1 * z1z1, p);
  const h = mod(u2 - u1, p);
  const r = mod(2n * (s2 - s1), p);
  if (h === 0n) return r === 0n ? dbl(c, P) : INF;
  const i = mod(4n * h * h, p);
  const j = mod(h * i, p);
  const v = mod(u1 * i, p);
  const x3 = mod(r * r - j - 2n * v, p);
  const y3 = mod(r * (v - x3) - 2n * s1 * j, p);
  const z3 = mod(((z1 + z2) * (z1 + z2) - z1z1 - z2z2) * h, p);
  return [x3, y3, z3];
}

function affineX(c: Curve, [x, , z]: J): bigint {
  const zi = inv(z, c.p);
  return mod(x * zi * zi, c.p);
}

/** Parse and validate an uncompressed public key point (0x04 || X || Y) on `c`. */
export function decodePoint(c: Curve, key: Uint8Array): [bigint, bigint] {
  if (key.length !== 1 + 2 * c.size || key[0] !== 0x04) throw new Error("bad public key encoding");
  const x = bytesToBigInt(key.subarray(1, 1 + c.size));
  const y = bytesToBigInt(key.subarray(1 + c.size));
  if (x >= c.p || y >= c.p) throw new Error("public key out of range");
  if (mod(y * y - (x * x * x + c.a * x + c.b), c.p) !== 0n) throw new Error("public key not on curve");
  return [x, y];
}

/** DER ECDSA-Sig-Value → (r, s). */
export function parseDerSignature(sig: Uint8Array): [bigint, bigint] {
  const parts = children(expectTag(readExact(sig), TAG.SEQUENCE, "ECDSA-Sig-Value"));
  if (parts.length !== 2) throw new DerError("bad ECDSA signature");
  const int = (t: (typeof parts)[number]) => {
    const v = expectTag(t, TAG.INTEGER, "INTEGER").value;
    if (!v.length || v[0]! & 0x80) throw new DerError("negative or empty INTEGER");
    if (v.length > 1 && v[0] === 0 && !(v[1]! & 0x80)) throw new DerError("non-minimal INTEGER");
    return bytesToBigInt(v);
  };
  return [int(parts[0]!), int(parts[1]!)];
}

/**
 * Verify a DER-encoded ECDSA signature over a message whose digest is `hash` (already computed with
 * the signature algorithm's hash function). Returns false on any invalid input; never throws.
 */
export function verifyDigest(c: Curve, publicKey: Uint8Array, hash: Uint8Array, derSignature: Uint8Array): boolean {
  try {
    const [qx, qy] = decodePoint(c, publicKey);
    const [r, s] = parseDerSignature(derSignature);
    if (r < 1n || r >= c.n || s < 1n || s >= c.n) return false;
    // e = leftmost bitlen(n) bits of the hash
    let e = bytesToBigInt(hash);
    const nBits = c.n.toString(2).length;
    const hBits = hash.length * 8;
    if (hBits > nBits) e >>= BigInt(hBits - nBits);
    const w = inv(s, c.n);
    const u1 = mod(e * w, c.n);
    const u2 = mod(r * w, c.n);
    // Shamir's trick: R = u1·G + u2·Q
    const G: J = [c.gx, c.gy, 1n];
    const Q: J = [qx, qy, 1n];
    const GQ = add(c, G, Q);
    let R: J = INF;
    const bits = Math.max(u1.toString(2).length, u2.toString(2).length);
    for (let i = bits - 1; i >= 0; i--) {
      R = dbl(c, R);
      const b1 = (u1 >> BigInt(i)) & 1n;
      const b2 = (u2 >> BigInt(i)) & 1n;
      if (b1 && b2) R = add(c, R, GQ);
      else if (b1) R = add(c, R, G);
      else if (b2) R = add(c, R, Q);
    }
    if (R[2] === 0n) return false;
    return mod(affineX(c, R), c.n) === r;
  } catch {
    return false;
  }
}

export function curveFor(oid: string): Curve | null {
  if (oid === "1.2.840.10045.3.1.7") return P256;
  if (oid === "1.3.132.0.34") return P384;
  return null;
}

/**
 * Minimal, strict CBOR (RFC 8949) decoder for App Attest objects: attestation objects
 * ({fmt, attStmt: {x5c, receipt}, authData}), assertions ({signature, authenticatorData}), the COSE
 * public key and the extensions map inside authenticator data.
 *
 * Supports unsigned/negative integers, byte and text strings, arrays, maps, false/true/null.
 * Rejects indefinite lengths, tags, floats, undefined/other simple values, duplicate map keys,
 * nesting deeper than 8 and lengths past the end of the input — none of which App Attest uses.
 */

export type CborValue = number | bigint | Uint8Array | string | boolean | null | CborValue[] | Map<string | number, CborValue>;

export class CborError extends Error {}

const MAX_DEPTH = 8;

export function decodeCbor(buf: Uint8Array, offset = 0): { value: CborValue; end: number } {
  let pos = offset;

  const need = (n: number) => {
    if (n < 0 || pos + n > buf.length) throw new CborError("truncated");
  };

  const readArg = (ai: number): number => {
    if (ai < 24) return ai;
    if (ai === 24) { need(1); return buf[pos++]!; }
    if (ai === 25) { need(2); const v = (buf[pos]! << 8) | buf[pos + 1]!; pos += 2; return v; }
    if (ai === 26) { need(4); const v = ((buf[pos]! << 24) >>> 0) + (buf[pos + 1]! << 16) + (buf[pos + 2]! << 8) + buf[pos + 3]!; pos += 4; return v; }
    if (ai === 27) {
      need(8);
      let v = 0n;
      for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(buf[pos + i]!);
      pos += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new CborError("integer too large");
      return Number(v);
    }
    throw new CborError("indefinite or reserved length");
  };

  const item = (depth: number): CborValue => {
    if (depth > MAX_DEPTH) throw new CborError("too deep");
    need(1);
    const ib = buf[pos++]!;
    const major = ib >> 5;
    const ai = ib & 0x1f;
    switch (major) {
      case 0: return readArg(ai);
      case 1: return -1 - readArg(ai);
      case 2: {
        const n = readArg(ai);
        need(n);
        const v = buf.slice(pos, pos + n);
        pos += n;
        return v;
      }
      case 3: {
        const n = readArg(ai);
        need(n);
        const v = new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(pos, pos + n));
        pos += n;
        return v;
      }
      case 4: {
        const n = readArg(ai);
        if (n > buf.length - pos) throw new CborError("truncated");
        const arr: CborValue[] = [];
        for (let i = 0; i < n; i++) arr.push(item(depth + 1));
        return arr;
      }
      case 5: {
        const n = readArg(ai);
        if (n > buf.length - pos) throw new CborError("truncated");
        const map = new Map<string | number, CborValue>();
        for (let i = 0; i < n; i++) {
          const k = item(depth + 1);
          if (typeof k !== "string" && typeof k !== "number") throw new CborError("unsupported map key");
          if (map.has(k)) throw new CborError("duplicate map key");
          map.set(k, item(depth + 1));
        }
        return map;
      }
      case 7:
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22) return null;
        throw new CborError("unsupported simple value");
      default:
        throw new CborError("unsupported major type");
    }
  };

  const value = item(0);
  return { value, end: pos };
}

/** Decode exactly one item spanning the whole buffer. */
export function decodeCborExact(buf: Uint8Array): CborValue {
  const { value, end } = decodeCbor(buf, 0);
  if (end !== buf.length) throw new CborError("trailing bytes");
  return value;
}

export const isMap = (v: CborValue | undefined): v is Map<string | number, CborValue> => v instanceof Map;
export const isBytes = (v: CborValue | undefined): v is Uint8Array => v instanceof Uint8Array;

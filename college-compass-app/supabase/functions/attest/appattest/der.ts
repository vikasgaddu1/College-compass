/**
 * Minimal, strict DER reader and X.509 certificate parser — just what App Attest verification needs:
 * the signed TBS bytes, signature algorithm and value, issuer/subject (compared as raw DER),
 * validity, the EC public key and the extensions. Definite lengths only; anything malformed throws.
 */

export class DerError extends Error {}

export interface Tlv {
  /** Identifier octet (class + constructed bit + low tag number; high tag numbers are reported as 0x1f | class bits). */
  tag: number;
  /** Tag number (also for high-tag-number form). */
  tagNumber: number;
  constructed: boolean;
  /** Offset of the value within the input buffer. */
  valueStart: number;
  /** Offset just past the value. */
  end: number;
  /** The value bytes (a view). */
  value: Uint8Array;
  /** The whole element: identifier + length + value (a view). */
  raw: Uint8Array;
}

export function readTlv(buf: Uint8Array, offset: number, limit = buf.length): Tlv {
  let pos = offset;
  const need = (n: number) => {
    if (pos + n > limit) throw new DerError("truncated");
  };
  need(1);
  const tag = buf[pos++]!;
  let tagNumber = tag & 0x1f;
  if (tagNumber === 0x1f) {
    tagNumber = 0;
    for (let i = 0; ; i++) {
      need(1);
      const b = buf[pos++]!;
      tagNumber = tagNumber * 128 + (b & 0x7f);
      if (!(b & 0x80)) break;
      if (i > 3) throw new DerError("tag too long");
    }
  }
  need(1);
  let len = buf[pos++]!;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0) throw new DerError("indefinite length");
    if (n > 4) throw new DerError("length too long");
    need(n);
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[pos++]!;
    if (len < 0x80) throw new DerError("non-minimal length");
  }
  need(len);
  return {
    tag,
    tagNumber,
    constructed: (tag & 0x20) !== 0,
    valueStart: pos,
    end: pos + len,
    value: buf.subarray(pos, pos + len),
    raw: buf.subarray(offset, pos + len),
  };
}

/** Children of a constructed element. */
export function children(t: Tlv): Tlv[] {
  if (!t.constructed) throw new DerError("not constructed");
  const out: Tlv[] = [];
  let pos = 0;
  while (pos < t.value.length) {
    const c = readTlv(t.value, pos);
    out.push(c);
    pos = c.end;
  }
  return out;
}

export function expectTag(t: Tlv | undefined, tag: number, what: string): Tlv {
  if (!t || t.tag !== tag) throw new DerError(`expected ${what}`);
  return t;
}

/** Read exactly one element spanning the whole buffer. */
export function readExact(buf: Uint8Array): Tlv {
  const t = readTlv(buf, 0);
  if (t.end !== buf.length) throw new DerError("trailing bytes");
  return t;
}

export function oidToString(v: Uint8Array): string {
  if (!v.length) throw new DerError("empty OID");
  const parts: number[] = [];
  const first = v[0]!;
  parts.push(first < 80 ? Math.floor(first / 40) : 2, first < 80 ? first % 40 : first - 80);
  let n = 0;
  for (let i = 1; i < v.length; i++) {
    n = n * 128 + (v[i]! & 0x7f);
    if (!(v[i]! & 0x80)) {
      parts.push(n);
      n = 0;
    } else if (i === v.length - 1) throw new DerError("bad OID");
  }
  if (first & 0x80) throw new DerError("unsupported OID");
  return parts.join(".");
}

const TAG = { BOOLEAN: 0x01, INTEGER: 0x02, BIT_STRING: 0x03, OCTET_STRING: 0x04, OID: 0x06, SEQUENCE: 0x30, UTC_TIME: 0x17, GENERALIZED_TIME: 0x18 } as const;
export { TAG };

/** BIT STRING contents with zero unused bits. */
export function bitStringBytes(t: Tlv): Uint8Array {
  expectTag(t, TAG.BIT_STRING, "BIT STRING");
  if (t.value.length < 1 || t.value[0] !== 0) throw new DerError("unexpected unused bits");
  return t.value.subarray(1);
}

function parseTime(t: Tlv): number {
  const s = new TextDecoder().decode(t.value);
  let m: RegExpMatchArray | null;
  if (t.tag === TAG.UTC_TIME && (m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/))) {
    const yy = Number(m[1]);
    return Date.UTC(yy >= 50 ? 1900 + yy : 2000 + yy, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  if (t.tag === TAG.GENERALIZED_TIME && (m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/))) {
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  throw new DerError("bad time");
}

export const OID = {
  ecPublicKey: "1.2.840.10045.2.1",
  p256: "1.2.840.10045.3.1.7",
  p384: "1.3.132.0.34",
  ecdsaSha256: "1.2.840.10045.4.3.2",
  ecdsaSha384: "1.2.840.10045.4.3.3",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
  extKeyUsage: "2.5.29.37",
  appAttestNonce: "1.2.840.113635.100.8.2",
} as const;

export interface Extension {
  critical: boolean;
  /** extnValue contents (the DER inside the OCTET STRING). */
  value: Uint8Array;
}

export interface Certificate {
  raw: Uint8Array;
  /** The DER of tbsCertificate — the bytes the issuer signed. */
  tbs: Uint8Array;
  signatureAlgorithm: string;
  /** DER-encoded ECDSA-Sig-Value. */
  signature: Uint8Array;
  issuer: Uint8Array;
  subject: Uint8Array;
  notBefore: number;
  notAfter: number;
  /** Named curve OID of the EC public key. */
  curve: string;
  /** Uncompressed X9.62 point (0x04 || X || Y). */
  publicKey: Uint8Array;
  extensions: Map<string, Extension>;
}

export function parseCertificate(der: Uint8Array): Certificate {
  const cert = expectTag(readExact(der), TAG.SEQUENCE, "Certificate");
  const [tbsT, algT, sigT, ...rest] = children(cert);
  if (rest.length) throw new DerError("extra Certificate fields");
  expectTag(tbsT, TAG.SEQUENCE, "TBSCertificate");
  const signatureAlgorithm = algorithmOid(expectTag(algT, TAG.SEQUENCE, "AlgorithmIdentifier"));
  const signature = bitStringBytes(sigT!);

  const tbs = children(tbsT!);
  let i = 0;
  if (tbs[i]?.tag === 0xa0) i++; // [0] EXPLICIT version
  expectTag(tbs[i++], TAG.INTEGER, "serialNumber");
  const innerAlg = algorithmOid(expectTag(tbs[i++], TAG.SEQUENCE, "signature"));
  if (innerAlg !== signatureAlgorithm) throw new DerError("signature algorithm mismatch");
  const issuer = expectTag(tbs[i++], TAG.SEQUENCE, "issuer").raw;
  const validity = children(expectTag(tbs[i++], TAG.SEQUENCE, "validity"));
  if (validity.length !== 2) throw new DerError("bad validity");
  const notBefore = parseTime(validity[0]!);
  const notAfter = parseTime(validity[1]!);
  const subject = expectTag(tbs[i++], TAG.SEQUENCE, "subject").raw;
  const spki = children(expectTag(tbs[i++], TAG.SEQUENCE, "subjectPublicKeyInfo"));
  if (spki.length !== 2) throw new DerError("bad subjectPublicKeyInfo");
  const keyAlg = children(expectTag(spki[0], TAG.SEQUENCE, "AlgorithmIdentifier"));
  if (oidToString(expectTag(keyAlg[0], TAG.OID, "OID").value) !== OID.ecPublicKey) throw new DerError("not an EC key");
  const curve = oidToString(expectTag(keyAlg[1], TAG.OID, "namedCurve").value);
  const publicKey = bitStringBytes(spki[1]!);

  const extensions = new Map<string, Extension>();
  for (; i < tbs.length; i++) {
    const t = tbs[i]!;
    if (t.tag === 0x81 || t.tag === 0x82) continue; // issuer/subject unique IDs
    if (t.tag !== 0xa3) throw new DerError("unexpected TBSCertificate field");
    const [seq, ...more] = children(t);
    if (more.length) throw new DerError("bad extensions");
    for (const ext of children(expectTag(seq, TAG.SEQUENCE, "Extensions"))) {
      const parts = children(expectTag(ext, TAG.SEQUENCE, "Extension"));
      const oid = oidToString(expectTag(parts[0], TAG.OID, "extnID").value);
      let critical = false;
      let j = 1;
      if (parts[j]?.tag === TAG.BOOLEAN) {
        if (parts[j]!.value.length !== 1) throw new DerError("bad BOOLEAN");
        critical = parts[j]!.value[0] !== 0;
        j++;
      }
      const value = expectTag(parts[j], TAG.OCTET_STRING, "extnValue").value;
      if (parts.length !== j + 1) throw new DerError("bad Extension");
      if (extensions.has(oid)) throw new DerError("duplicate extension");
      extensions.set(oid, { critical, value });
    }
  }
  return { raw: der, tbs: tbsT!.raw, signatureAlgorithm, signature, issuer, subject, notBefore, notAfter, curve, publicKey, extensions };
}

function algorithmOid(seq: Tlv): string {
  const parts = children(seq);
  const oid = oidToString(expectTag(parts[0], TAG.OID, "algorithm").value);
  // ECDSA AlgorithmIdentifiers carry no parameters.
  if (parts.length !== 1) throw new DerError("unexpected algorithm parameters");
  return oid;
}

/** basicConstraints cA flag (false when the extension is absent). */
export function isCa(cert: Certificate): boolean {
  const ext = cert.extensions.get(OID.basicConstraints);
  if (!ext) return false;
  const parts = children(expectTag(readExact(ext.value), TAG.SEQUENCE, "BasicConstraints"));
  const first = parts[0];
  return !!first && first.tag === TAG.BOOLEAN && first.value.length === 1 && first.value[0] !== 0;
}

/** keyUsage keyCertSign bit (true when the extension is absent — then it doesn't restrict usage). */
export function canSignCertificates(cert: Certificate): boolean {
  const ext = cert.extensions.get(OID.keyUsage);
  if (!ext) return true;
  const t = expectTag(readExact(ext.value), TAG.BIT_STRING, "KeyUsage");
  return t.value.length >= 2 && (t.value[1]! & 0x04) !== 0;
}

/** PEM → DER bytes of the first certificate. */
export function pemToDer(pem: string): Uint8Array {
  const m = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/);
  if (!m) throw new DerError("not a PEM certificate");
  const b64 = m[1]!.replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return out;
}

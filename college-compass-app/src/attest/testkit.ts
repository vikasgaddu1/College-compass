/**
 * Test-only helpers: a tiny DER/CBOR encoder and a synthetic App Attest "Apple" PKI (root →
 * intermediate → credential certificate) signed with WebCrypto, so every verifier check can be
 * exercised with an injected trust anchor. Never imported by app or server code.
 */
import { concat, sha256, toBase64, utf8 } from "../../supabase/functions/attest/appattest/bytes";

const subtle = globalThis.crypto.subtle;

// ───────────── DER ─────────────
const derLen = (n: number): number[] => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]);
export const tlv = (tag: number, ...parts: Uint8Array[]): Uint8Array => {
  const v = concat(...parts);
  return concat(Uint8Array.of(tag, ...derLen(v.length)), v);
};
export const seq = (...p: Uint8Array[]) => tlv(0x30, ...p);
export function oid(s: string): Uint8Array {
  const n = s.split(".").map(Number);
  const out = [n[0]! * 40 + n[1]!];
  for (const v of n.slice(2)) {
    const b = [v & 0x7f];
    for (let x = v >>> 7; x > 0; x >>>= 7) b.unshift((x & 0x7f) | 0x80);
    out.push(...b);
  }
  return tlv(0x06, Uint8Array.from(out));
}
const int = (n: number) => tlv(0x02, Uint8Array.of(n));
const name = (cn: string) => seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, utf8(cn)))));
function utcTime(ms: number): Uint8Array {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return tlv(0x17, utf8(`${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`));
}
const ext = (id: string, critical: boolean, value: Uint8Array) =>
  seq(oid(id), ...(critical ? [tlv(0x01, Uint8Array.of(0xff))] : []), tlv(0x04, value));
export const basicConstraints = (ca: boolean) => ext("2.5.29.19", true, seq(...(ca ? [tlv(0x01, Uint8Array.of(0xff))] : [])));
const keyUsageCertSign = ext("2.5.29.15", true, tlv(0x03, Uint8Array.of(1, 0x06)));
export const nonceExtension = (nonce: Uint8Array) => ext("1.2.840.113635.100.8.2", false, seq(tlv(0xa1, tlv(0x04, nonce))));
export const criticalUnknown = ext("1.2.3.4.5", true, tlv(0x05, new Uint8Array(0)));

/** P1363 (r||s) → DER ECDSA-Sig-Value. */
export function derSig(raw: Uint8Array): Uint8Array {
  const h = raw.length / 2;
  const i = (b: Uint8Array) => {
    let k = 0;
    while (k < b.length - 1 && b[k] === 0) k++;
    const v = b.subarray(k);
    return tlv(0x02, v[0]! & 0x80 ? concat(Uint8Array.of(0), v) : v);
  };
  return seq(i(raw.subarray(0, h)), i(raw.subarray(h)));
}

export interface KeyPair { privateKey: CryptoKey; publicKey: CryptoKey; raw: Uint8Array; curve: "P-256" | "P-384" }
export async function keyPair(curve: "P-256" | "P-384"): Promise<KeyPair> {
  const k = (await subtle.generateKey({ name: "ECDSA", namedCurve: curve }, true, ["sign", "verify"])) as CryptoKeyPair;
  return { ...k, raw: new Uint8Array(await subtle.exportKey("raw", k.publicKey)), curve };
}
export async function sign(key: KeyPair, hash: "SHA-256" | "SHA-384", data: Uint8Array): Promise<Uint8Array> {
  return derSig(new Uint8Array(await subtle.sign({ name: "ECDSA", hash }, key.privateKey, data.slice())));
}

const CURVE_OID = { "P-256": "1.2.840.10045.3.1.7", "P-384": "1.3.132.0.34" } as const;
const SIG_OID = { "SHA-256": "1.2.840.10045.4.3.2", "SHA-384": "1.2.840.10045.4.3.3" } as const;

export async function certificate(o: {
  subject: string; issuer: string; key: KeyPair; signer: KeyPair; hash?: "SHA-256" | "SHA-384";
  notBefore: number; notAfter: number; extensions: Uint8Array[]; serial?: number;
}): Promise<Uint8Array> {
  const hash = o.hash ?? "SHA-256";
  const alg = seq(oid(SIG_OID[hash]));
  const tbs = seq(
    tlv(0xa0, int(2)),
    int(o.serial ?? 1),
    alg,
    name(o.issuer),
    seq(utcTime(o.notBefore), utcTime(o.notAfter)),
    name(o.subject),
    seq(seq(oid("1.2.840.10045.2.1"), oid(CURVE_OID[o.key.curve])), tlv(0x03, Uint8Array.of(0), o.key.raw)),
    tlv(0xa3, seq(...o.extensions)),
  );
  return seq(tbs, alg, tlv(0x03, Uint8Array.of(0), await sign(o.signer, hash, tbs)));
}

export function toPem(der: Uint8Array): string {
  return `-----BEGIN CERTIFICATE-----\n${toBase64(der).replace(/(.{64})/g, "$1\n")}\n-----END CERTIFICATE-----\n`;
}

// ───────────── CBOR ─────────────
type C = number | string | Uint8Array | C[] | Map<string | number, C>;
function head(major: number, n: number): Uint8Array {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 0x100) return Uint8Array.of((major << 5) | 24, n);
  if (n < 0x10000) return Uint8Array.of((major << 5) | 25, n >> 8, n & 0xff);
  return Uint8Array.of((major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}
export function cbor(v: C): Uint8Array {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const b = utf8(v); return concat(head(3, b.length), b); }
  if (v instanceof Uint8Array) return concat(head(2, v.length), v);
  if (Array.isArray(v)) return concat(head(4, v.length), ...v.map(cbor));
  return concat(head(5, v.size), ...Array.from(v, ([k, x]) => concat(cbor(k), cbor(x))));
}

// ───────────── Synthetic App Attest ─────────────
export const DAY = 86_400_000;

export interface FakeApple {
  rootPem: string;
  root: KeyPair;
  intermediate: KeyPair;
  intermediateDer: Uint8Array;
  now: number;
}

export async function fakeApple(now = Date.UTC(2026, 9, 21)): Promise<FakeApple> {
  const root = await keyPair("P-384");
  const intermediate = await keyPair("P-384");
  const rootDer = await certificate({
    subject: "Test App Attestation Root CA", issuer: "Test App Attestation Root CA", key: root, signer: root, hash: "SHA-384",
    notBefore: now - 365 * DAY, notAfter: now + 3650 * DAY, extensions: [basicConstraints(true), keyUsageCertSign],
  });
  const intermediateDer = await certificate({
    subject: "Test App Attestation CA 1", issuer: "Test App Attestation Root CA", key: intermediate, signer: root, hash: "SHA-384",
    notBefore: now - 365 * DAY, notAfter: now + 3650 * DAY, extensions: [basicConstraints(true), keyUsageCertSign],
  });
  return { rootPem: toPem(rootDer), root, intermediate, intermediateDer, now };
}

export interface FakeAttestationOptions {
  appId: string;
  clientDataHash: Uint8Array;
  aaguid?: Uint8Array;
  counter?: number;
  extensions?: Map<string | number, C>;
  /** Override pieces to provoke failures. */
  leafSigner?: KeyPair;
  leafExtensions?: (nonce: Uint8Array) => Uint8Array[];
  intermediateDer?: Uint8Array;
  coseKey?: KeyPair;
  leafNotAfter?: number;
  keyIdOverride?: Uint8Array;
}

export const AAGUID_PROD = concat(utf8("appattest"), new Uint8Array(7));
export const AAGUID_DEV = utf8("appattestdevelop");

/** A credential key, its attestation object and key id, as DCAppAttestService would produce. */
export async function fakeAttestation(apple: FakeApple, o: FakeAttestationOptions) {
  const credential = await keyPair("P-256");
  const keyId = o.keyIdOverride ?? (await sha256(credential.raw));
  const cose = o.coseKey ?? credential;
  const counter = o.counter ?? 0;
  const authData = concat(
    await sha256(utf8(o.appId)),
    Uint8Array.of(0x40),
    Uint8Array.of((counter >>> 24) & 0xff, (counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff),
    o.aaguid ?? AAGUID_PROD,
    Uint8Array.of(0, 32),
    keyId,
    cbor(new Map<string | number, C>([[1, 2], [3, -7], [-1, 1], [-2, cose.raw.subarray(1, 33)], [-3, cose.raw.subarray(33)]])),
    o.extensions ? cbor(o.extensions) : new Uint8Array(0),
  );
  const nonce = await sha256(concat(authData, o.clientDataHash));
  const leaf = await certificate({
    subject: "credential", issuer: "Test App Attestation CA 1", key: credential, signer: o.leafSigner ?? apple.intermediate,
    notBefore: apple.now - DAY, notAfter: o.leafNotAfter ?? apple.now + 3 * DAY,
    extensions: o.leafExtensions ? o.leafExtensions(nonce) : [basicConstraints(false), nonceExtension(nonce)],
  });
  const attestation = cbor(new Map<string | number, C>([
    ["fmt", "apple-appattest"],
    ["attStmt", new Map<string | number, C>([["x5c", [leaf, o.intermediateDer ?? apple.intermediateDer]], ["receipt", utf8("receipt")]])],
    ["authData", authData],
  ]));
  return { credential, keyId: toBase64(await sha256(credential.raw)), attestation };
}

/** An assertion over `clientData` with `credential`, as generateAssertion would produce. */
export async function fakeAssertion(credential: KeyPair, appId: string, clientData: Uint8Array, counter: number, extensions?: Map<string | number, C>) {
  const authData = concat(
    await sha256(utf8(appId)),
    Uint8Array.of(0x40),
    Uint8Array.of((counter >>> 24) & 0xff, (counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff),
    extensions ? cbor(extensions) : new Uint8Array(0),
  );
  const nonce = await sha256(concat(authData, await sha256(clientData)));
  const signature = await sign(credential, "SHA-256", nonce);
  return cbor(new Map<string | number, C>([["signature", signature], ["authenticatorData", authData]]));
}

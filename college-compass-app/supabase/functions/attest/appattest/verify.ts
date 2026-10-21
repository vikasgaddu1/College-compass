/**
 * Apple App Attest verification — attestation objects (once per key) and assertions (per request) —
 * following "Validating apps that connect to your server" (developer.apple.com/documentation/devicecheck).
 *
 * Plain TypeScript with no dependencies (CBOR, DER and ECDSA live next to this file) so the exact same
 * code runs in the Supabase Edge Function (Deno) and in the Vitest suite (Node). Production pins
 * Apple's App Attestation Root CA; tests may inject another root to exercise every check.
 */
import { concat, equal, fromBase64, sha256, sha384, toBase64, utf8 } from "./bytes.ts";
import { decodeCbor, decodeCborExact, isBytes, isMap, type CborValue } from "./cbor.ts";
import { DerError, OID, TAG, canSignCertificates, children, expectTag, isCa, parseCertificate, pemToDer, readExact, type Certificate } from "./der.ts";
import { curveFor, verifyDigest } from "./ecdsa.ts";

/** College Compass: Team ID C544LPNJ2S + bundle ID (the App ID App Attest hashes into rpIdHash). */
export const COLLEGE_COMPASS_APP_ID = "C544LPNJ2S.com.gaddu.collegecompass";

/**
 * Apple App Attestation Root CA (https://www.apple.com/certificateauthority/private/,
 * Apple_App_Attestation_Root_CA.pem). SHA-256 fingerprint
 * 1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32.
 * Valid 2020-03-18 → 2045-03-15.
 */
export const APPLE_APP_ATTESTATION_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

export type AttestEnvironment = "production" | "development";

/** Why verification failed (sent back to the app as `reason`; never contains input data). */
export type AttestFailure =
  | "malformed"
  | "bad_format"
  | "bad_chain"
  | "cert_expired"
  | "bad_nonce"
  | "key_id_mismatch"
  | "rp_id_mismatch"
  | "bad_counter"
  | "bad_aaguid"
  | "development_not_allowed"
  | "bad_validation_category"
  | "bad_signature"
  | "replay";

export class AttestError extends Error {
  constructor(public readonly reason: AttestFailure, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
  }
}

const AAGUID_PRODUCTION = concat(utf8("appattest"), new Uint8Array(7));
const AAGUID_DEVELOPMENT = utf8("appattestdevelop");

/**
 * `apple_validation_category_01` values that are never acceptable for our app (Apple's table:
 * 0 = invalid; 7–9 = binaries the system generates in restricted situations). Other values are
 * recorded (2 TestFlight, 3 development-signed, 4 App Store, 5 ad hoc/enterprise, …) so the policy can
 * be tightened later. Older iOS versions don't send the extension at all.
 */
const DENIED_VALIDATION_CATEGORIES = new Set([0, 7, 8, 9]);

/** Extras Apple adds to authenticator data on newer OS versions (both optional). */
export interface AuthenticatorExtras {
  validationCategory: number | null;
  bundleVersion: string | null;
}

export interface VerifiedAttestation extends AuthenticatorExtras {
  /** Base64 SHA-256 of the public key — Apple's key identifier. */
  keyId: string;
  /** Uncompressed P-256 point (65 bytes). */
  publicKey: Uint8Array;
  environment: AttestEnvironment;
  /** Opaque App Attest receipt (for Apple's fraud-metric API). */
  receipt: Uint8Array;
}

export interface AttestationOptions {
  /** "<Team ID>.<bundle ID>". */
  appId: string;
  /** The key identifier the app sent (base64). */
  keyId: string;
  /** Exactly the bytes the app passed to attestKey(_:clientDataHash:). */
  clientDataHash: Uint8Array;
  /** Verification time (ms since epoch). */
  now: number;
  /** Accept keys from the App Attest sandbox (Xcode builds). Default false. */
  allowDevelopment?: boolean;
  /** Tests only: a different trust anchor. Production always uses Apple's root. */
  rootPem?: string;
}

let appleRoot: Certificate | null = null;
function trustAnchor(rootPem?: string): Certificate {
  if (rootPem) return parseCertificate(pemToDer(rootPem));
  appleRoot ??= parseCertificate(pemToDer(APPLE_APP_ATTESTATION_ROOT_CA));
  return appleRoot;
}

async function digestFor(alg: string, data: Uint8Array): Promise<Uint8Array> {
  if (alg === OID.ecdsaSha256) return sha256(data);
  if (alg === OID.ecdsaSha384) return sha384(data);
  throw new AttestError("bad_chain", "unsupported signature algorithm");
}

async function signedBy(cert: Certificate, issuer: Certificate): Promise<boolean> {
  const curve = curveFor(issuer.curve);
  if (!curve) return false;
  if (!equal(cert.issuer, issuer.subject)) return false;
  return verifyDigest(curve, issuer.publicKey, await digestFor(cert.signatureAlgorithm, cert.tbs), cert.signature);
}

const KNOWN_CRITICAL = new Set<string>([OID.basicConstraints, OID.keyUsage, OID.extKeyUsage]);

function checkCert(cert: Certificate, now: number) {
  if (now < cert.notBefore || now > cert.notAfter) throw new AttestError("cert_expired");
  for (const [oid, ext] of cert.extensions) {
    if (ext.critical && !KNOWN_CRITICAL.has(oid)) throw new AttestError("bad_chain", `unknown critical extension ${oid}`);
  }
}

/** Parse the authenticator data's trailing extensions map (if any). */
function extras(buf: Uint8Array, offset: number): AuthenticatorExtras {
  const out: AuthenticatorExtras = { validationCategory: null, bundleVersion: null };
  if (offset >= buf.length) return out;
  let ext: CborValue;
  try {
    const d = decodeCbor(buf, offset);
    if (d.end !== buf.length) throw new Error("trailing bytes");
    ext = d.value;
  } catch {
    throw new AttestError("malformed", "authenticator extensions");
  }
  if (!isMap(ext)) throw new AttestError("malformed", "authenticator extensions");
  const cat = ext.get("apple_validation_category_01");
  if (cat !== undefined) {
    // A little-endian UInt32 in a 4-byte string (Apple's sample) — accept a plain integer too.
    if (isBytes(cat) && cat.length === 4) out.validationCategory = (cat[0]! | (cat[1]! << 8) | (cat[2]! << 16) | (cat[3]! << 24)) >>> 0;
    else if (typeof cat === "number") out.validationCategory = cat;
    else throw new AttestError("malformed", "validation category");
    if (DENIED_VALIDATION_CATEGORIES.has(out.validationCategory)) throw new AttestError("bad_validation_category");
  }
  const ver = ext.get("apple_bundle_version_01");
  if (typeof ver === "string") out.bundleVersion = ver.slice(0, 64);
  return out;
}

const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;

/** Verify an attestation object (Apple's steps 1–9 plus the newer extension checks). */
export async function verifyAttestation(attestationObject: Uint8Array, opts: AttestationOptions): Promise<VerifiedAttestation> {
  let obj: CborValue;
  try {
    obj = decodeCborExact(attestationObject);
  } catch {
    throw new AttestError("malformed", "CBOR");
  }
  if (!isMap(obj) || obj.get("fmt") !== "apple-appattest") throw new AttestError("bad_format");
  const attStmt = obj.get("attStmt");
  const authData = obj.get("authData");
  if (!isMap(attStmt) || !isBytes(authData)) throw new AttestError("bad_format");
  const x5c = attStmt.get("x5c");
  const receipt = attStmt.get("receipt");
  if (!Array.isArray(x5c) || x5c.length < 2 || !x5c.every(isBytes) || !isBytes(receipt)) throw new AttestError("bad_format");

  // 1. credCert → intermediate → Apple's App Attestation Root CA.
  let leaf: Certificate, intermediate: Certificate;
  try {
    leaf = parseCertificate(x5c[0] as Uint8Array);
    intermediate = parseCertificate(x5c[1] as Uint8Array);
  } catch {
    throw new AttestError("bad_chain", "unparseable certificate");
  }
  const root = trustAnchor(opts.rootPem);
  checkCert(root, opts.now);
  checkCert(intermediate, opts.now);
  checkCert(leaf, opts.now);
  if (!isCa(intermediate) || !canSignCertificates(intermediate)) throw new AttestError("bad_chain", "intermediate is not a CA");
  if (isCa(leaf)) throw new AttestError("bad_chain", "leaf is a CA");
  if (!(await signedBy(intermediate, root))) throw new AttestError("bad_chain", "intermediate not signed by the root");
  if (!(await signedBy(leaf, intermediate))) throw new AttestError("bad_chain", "leaf not signed by the intermediate");
  if (leaf.curve !== OID.p256) throw new AttestError("bad_chain", "credential key is not P-256");

  // 2–4. nonce = SHA256(authData || clientDataHash) must equal the octet string in 1.2.840.113635.100.8.2.
  const nonce = await sha256(concat(authData, opts.clientDataHash));
  const ext = leaf.extensions.get(OID.appAttestNonce);
  if (!ext) throw new AttestError("bad_nonce", "missing nonce extension");
  let certNonce: Uint8Array;
  try {
    const seq = children(expectTag(readExact(ext.value), TAG.SEQUENCE, "nonce SEQUENCE"));
    if (seq.length !== 1 || seq[0]!.tag !== 0xa1) throw new DerError("nonce [1]");
    const inner = children(seq[0]!);
    if (inner.length !== 1) throw new DerError("nonce OCTET STRING");
    certNonce = expectTag(inner[0], TAG.OCTET_STRING, "nonce OCTET STRING").value;
  } catch {
    throw new AttestError("bad_nonce", "malformed nonce extension");
  }
  if (!equal(certNonce, nonce)) throw new AttestError("bad_nonce");

  // 5. key identifier = SHA256(public key, X9.62 uncompressed).
  let keyIdBytes: Uint8Array;
  try {
    keyIdBytes = fromBase64(opts.keyId);
  } catch {
    throw new AttestError("key_id_mismatch");
  }
  const pubKeyHash = await sha256(leaf.publicKey);
  if (!equal(pubKeyHash, keyIdBytes)) throw new AttestError("key_id_mismatch");

  // Authenticator data: rpIdHash(32) flags(1) counter(4) aaguid(16) credIdLen(2) credId(L) COSE key, extensions.
  if (authData.length < 55) throw new AttestError("malformed", "authenticator data");
  // 6. rpIdHash = SHA256(App ID).
  if (!equal(authData.subarray(0, 32), await sha256(utf8(opts.appId)))) throw new AttestError("rp_id_mismatch");
  // 7. counter = 0.
  if (u32(authData, 33) !== 0) throw new AttestError("bad_counter");
  // 8. aaguid: production or (if allowed) development.
  const aaguid = authData.subarray(37, 53);
  let environment: AttestEnvironment;
  if (equal(aaguid, AAGUID_PRODUCTION)) environment = "production";
  else if (equal(aaguid, AAGUID_DEVELOPMENT)) environment = "development";
  else throw new AttestError("bad_aaguid");
  if (environment === "development" && !opts.allowDevelopment) throw new AttestError("development_not_allowed");
  // 9. credentialId = key identifier.
  const credLen = (authData[53]! << 8) | authData[54]!;
  if (credLen !== 32 || authData.length < 55 + credLen) throw new AttestError("malformed", "credential id");
  if (!equal(authData.subarray(55, 55 + credLen), keyIdBytes)) throw new AttestError("key_id_mismatch");
  // The COSE key must be the certificate's key (consistency; Apple's steps use the certificate's).
  let coseEnd: number;
  try {
    const cose = decodeCbor(authData, 55 + credLen);
    coseEnd = cose.end;
    const m = cose.value;
    const x = isMap(m) ? m.get(-2) : undefined;
    const y = isMap(m) ? m.get(-3) : undefined;
    if (!isMap(m) || m.get(1) !== 2 || m.get(3) !== -7 || m.get(-1) !== 1 || !isBytes(x) || !isBytes(y)) throw new Error("cose");
    if (!equal(concat(new Uint8Array([4]), x, y), leaf.publicKey)) throw new Error("cose key");
  } catch {
    throw new AttestError("malformed", "credential public key");
  }
  // 10–11. validation category / bundle version extensions (newer OS versions).
  const more = extras(authData, coseEnd);

  return { keyId: toBase64(keyIdBytes), publicKey: leaf.publicKey, environment, receipt, ...more };
}

export interface AssertionOptions {
  appId: string;
  /** The key's stored public key (uncompressed P-256 point). */
  publicKey: Uint8Array;
  /** The exact client data bytes the app hashed (clientDataHash = SHA256(clientData)). */
  clientData: Uint8Array;
  /** Last accepted counter for this key (0 right after attestation). */
  previousCounter: number;
}

export interface VerifiedAssertion extends AuthenticatorExtras {
  counter: number;
}

/** Verify an assertion (Apple's steps 1–5; step 6 — the challenge inside clientData — is the caller's). */
export async function verifyAssertion(assertionObject: Uint8Array, opts: AssertionOptions): Promise<VerifiedAssertion> {
  let obj: CborValue;
  try {
    obj = decodeCborExact(assertionObject);
  } catch {
    throw new AttestError("malformed", "CBOR");
  }
  const signature = isMap(obj) ? obj.get("signature") : undefined;
  const authData = isMap(obj) ? obj.get("authenticatorData") : undefined;
  if (!isBytes(signature) || !isBytes(authData) || authData.length < 37) throw new AttestError("bad_format");

  // 1–3. signature over nonce = SHA256(authenticatorData || SHA256(clientData)), ECDSA P-256 / SHA-256.
  const nonce = await sha256(concat(authData, await sha256(opts.clientData)));
  const curve = curveFor(OID.p256)!;
  if (!verifyDigest(curve, opts.publicKey, await sha256(nonce), signature)) throw new AttestError("bad_signature");
  // 4. rpIdHash.
  if (!equal(authData.subarray(0, 32), await sha256(utf8(opts.appId)))) throw new AttestError("rp_id_mismatch");
  // 5. counter strictly increasing.
  const counter = u32(authData, 33);
  if (!(counter > opts.previousCounter)) throw new AttestError("replay");
  return { counter, ...extras(authData, 37) };
}

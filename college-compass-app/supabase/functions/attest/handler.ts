/**
 * The `attest` Edge Function's request handling (no Deno globals here, so Vitest can exercise it;
 * index.ts wires it to Deno.serve and the database).
 *
 * One endpoint, POST JSON with `op`:
 *   {op:"challenge", purpose:"attest"|"assert"}             → {challenge}            (single use, 5 min)
 *   {op:"register", key_id, attestation, challenge}          → {status:"registered", environment}
 *       attestation = attestKey(key_id, clientDataHash: SHA256(UTF-8 challenge))
 *   {op:"contribute", key_id, client_data, assertion}        → the database's contribution result
 *       client_data = JSON {"v":1,"op":"contribute","challenge":…,"payload":{…}} (sent verbatim);
 *       assertion = generateAssertion(key_id, clientDataHash: SHA256(UTF-8 client_data))
 *
 * HTTP 200 means the attested path handled the request (the body may still say the database
 * rejected the contribution for a content reason). Any other status means attestation failed or
 * was unavailable — the app then falls back to the anonymous contribute_research RPC.
 */
import { fromBase64, sha256, toBase64, toBase64Url, utf8 } from "./appattest/bytes.ts";
import { AttestError, COLLEGE_COMPASS_APP_ID, verifyAssertion, verifyAttestation } from "./appattest/verify.ts";

/** Calls a database function with the service role; resolves its JSON result, throws on HTTP errors. */
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export interface HandlerDeps {
  rpc: Rpc;
  appId?: string;
  now?: () => number;
  random?: (n: number) => Uint8Array;
  /** Tests only: another trust anchor. */
  rootPem?: string;
  log?: (msg: string) => void;
}

const MAX_BODY = 100_000;
const MAX_CLIENT_DATA = 70_000;
const KEY_ID = /^[A-Za-z0-9+/]{43}=$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Database rejections that mean "the attestation layer failed" — the app should fall back. */
const ATTESTATION_REASONS = new Set(["bad_challenge", "replay", "unknown_key", "revoked_key"]);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Max-Age": "86400",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const reject = (status: number, reason: string) => json(status, { status: "rejected", reason });

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (xff || req.headers.get("cf-connecting-ip") || "unknown").slice(0, 64);
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const appId = deps.appId ?? COLLEGE_COMPASS_APP_ID;
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  const log = deps.log ?? (() => {});

  async function challenge(body: Record<string, unknown>, req: Request): Promise<Response> {
    const purpose = body.purpose;
    if (purpose !== "attest" && purpose !== "assert") return reject(400, "bad_request");
    const c = toBase64Url(random(32));
    const r = obj(await deps.rpc("attest_new_challenge", { p_challenge: c, p_purpose: purpose, p_ip: clientIp(req) }));
    if (r?.status !== "ok") return reject(r?.reason === "rate_limited" ? 429 : 503, String(r?.reason ?? "unavailable"));
    return json(200, { challenge: c, expires_in: r.expires_in ?? 300 });
  }

  async function register(body: Record<string, unknown>): Promise<Response> {
    const { key_id, attestation, challenge: ch } = body;
    if (typeof key_id !== "string" || !KEY_ID.test(key_id)) return reject(400, "bad_request");
    if (typeof ch !== "string" || !CHALLENGE.test(ch)) return reject(400, "bad_request");
    if (typeof attestation !== "string" || attestation.length > 40_000 || !B64.test(attestation)) return reject(400, "bad_request");
    // Development keys are verified here and accepted or refused by the database setting.
    const v = await verifyAttestation(fromBase64(attestation), {
      appId,
      keyId: key_id,
      clientDataHash: await sha256(utf8(ch)),
      now: now(),
      allowDevelopment: true,
      rootPem: deps.rootPem,
    });
    const r = obj(await deps.rpc("attest_register_key", {
      p_key_id: v.keyId,
      p_public_key: toBase64(v.publicKey),
      p_environment: v.environment,
      p_receipt: toBase64(v.receipt),
      p_challenge: ch,
      p_validation_category: v.validationCategory,
      p_bundle_version: v.bundleVersion,
    }));
    if (r?.status !== "registered") return reject(r?.reason === "key_exists" ? 409 : 403, String(r?.reason ?? "unavailable"));
    return json(200, { status: "registered", environment: v.environment });
  }

  async function contribute(body: Record<string, unknown>): Promise<Response> {
    const { key_id, client_data, assertion } = body;
    if (typeof key_id !== "string" || !KEY_ID.test(key_id)) return reject(400, "bad_request");
    if (typeof client_data !== "string" || client_data.length > MAX_CLIENT_DATA) return reject(400, "bad_request");
    if (typeof assertion !== "string" || assertion.length > 4_000 || !B64.test(assertion)) return reject(400, "bad_request");
    const key = obj(await deps.rpc("attest_key_info", { p_key_id: key_id }));
    if (!key || typeof key.public_key !== "string") return reject(404, "unknown_key");
    if (key.revoked === true) return reject(403, "revoked_key");
    const v = await verifyAssertion(fromBase64(assertion), {
      appId,
      publicKey: fromBase64(key.public_key),
      clientData: utf8(client_data),
      previousCounter: Number(key.counter ?? 0),
    });
    // Step 6: the signed client data carries a fresh single-use challenge and the exact payload.
    let cd: Record<string, unknown> | null = null;
    try {
      cd = obj(JSON.parse(client_data));
    } catch {
      cd = null;
    }
    const payload = obj(cd?.payload);
    if (!cd || cd.v !== 1 || cd.op !== "contribute" || typeof cd.challenge !== "string" || !CHALLENGE.test(cd.challenge) || !payload) {
      return reject(400, "bad_client_data");
    }
    const r = obj(await deps.rpc("contribute_research_attested", { payload, p_key_id: key_id, p_counter: v.counter, p_challenge: cd.challenge }));
    if (!r) return reject(503, "unavailable");
    if (r.status === "rejected" && ATTESTATION_REASONS.has(String(r.reason))) return json(409, r);
    return json(200, { ...r, attested: true });
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return reject(405, "method_not_allowed");
    let body: Record<string, unknown> | null;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY) return reject(413, "too_large");
      body = obj(JSON.parse(text));
    } catch {
      body = null;
    }
    if (!body) return reject(400, "bad_request");
    try {
      switch (body.op) {
        case "challenge": return await challenge(body, req);
        case "register": return await register(body);
        case "contribute": return await contribute(body);
        default: return reject(400, "bad_request");
      }
    } catch (e) {
      if (e instanceof AttestError) {
        log(`attest ${String(body.op)}: ${e.reason}`);
        return reject(e.reason === "replay" ? 409 : 400, e.reason);
      }
      log(`attest ${String(body.op)} failed: ${e instanceof Error ? e.message : String(e)}`);
      return reject(503, "unavailable");
    }
  };
}

/** PostgREST RPC caller using the service key (the internal functions are not executable by anon). */
export function createRestRpc(supabaseUrl: string, serviceKey: string, doFetch: typeof fetch = fetch): Rpc {
  const headers: Record<string, string> = { apikey: serviceKey, "Content-Type": "application/json", Accept: "application/json" };
  // Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys only in apikey.
  if (serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${serviceKey}`;
  const base = supabaseUrl.replace(/\/+$/, "");
  return async (fn, args) => {
    const r = await doFetch(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
    if (!r.ok) throw new Error(`rpc ${fn}: HTTP ${r.status}`);
    return r.json();
  };
}

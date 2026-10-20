/**
 * Sign in with ChatGPT — OIDC Authorization Code + PKCE (S256) + state + nonce, entirely on device.
 *
 * Web: full-page redirect → public/callback.html → `#/auth/callback?code&state` → the UI calls
 *      `auth.completeSignIn(query)`.
 * Native (Capacitor): the authorize URL opens in SFSafariViewController; callback.html sees the
 *      `.n` state suffix and forwards to `collegecompass://auth/callback?...`; this module listens via
 *      `platform.onAuthRedirect`, completes sign-in, closes the browser and notifies subscribers.
 *
 * Native self-serve ("oss" mode — used when the build has no partner client ID): OpenAI's self-serve
 *      path for open-source, locally run apps. A 127.0.0.1 loopback listener (LoopbackAuth plugin) is
 *      started, the first sign-in registers this install with `client_id=dynamic_agent_client` +
 *      `agent_name_hint` + a stable `ext_agent_host_id`, and the issued `oaiapp_…` client ID returned on
 *      the redirect is saved and used for the exchange, refresh and later sign-ins. `signIn()` resolves
 *      only after the whole flow completes.
 *
 * All redirect/HTTP plumbing goes through src/platform so the same code runs on web and iOS.
 */
import * as platform from "../platform";
import { load, remove, save, NS } from "../lib/storage";
import { navigate } from "../lib/router";
import { AiError, type AuthApi, type AuthIssue, type ChatGPTAccount } from "../types";
import {
  AGENT_NAME_HINT, AUTHORIZE_URL, ISSUER, JWKS_URL, KEYS, MODELS_TTL_MS, MODELS_URL, NATIVE_STATE_SUFFIX,
  OIDC_DISCOVERY_URL, PENDING_TTL_MS, PLAN_USAGE_SCOPE, REFRESH_SKEW_MS, RESOURCE, SCOPE, SELF_SERVE_CLIENT_ID,
  TOKEN_URL, clientId, tokenRelay,
} from "./config";
import { createPkce, randomString } from "./pkce";
import { decodeJwt, verifyIdToken, type Jwk } from "./jwt";

// ───────────────────────────── stored shapes ─────────────────────────────

export interface PendingSignIn {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string | null;
  createdAt: number;
  redirect_uri: string;
  /** "oss" = native self-serve sign-in (loopback redirect). Absent = partner client-ID flow. */
  mode?: "oss";
  /** oss: the client_id sent to authorize (`dynamic_agent_client` on first registration). */
  client_id?: string;
  /** oss: the `ext_agent_host_id` sent to authorize. */
  host_id?: string;
}

/** Self-serve client IDs issued to this device (`cc2:issued_client_id`). */
export interface IssuedClientIds {
  /** The `ext_agent_host_id` these were issued for; ignored if the host ID changes. */
  host_id: string;
  /** Account `sub` → issued client ID (OpenAI issues one per device + account). */
  by_sub: Record<string, string>;
  /** The account that signed in last on this device. */
  last_sub: string | null;
  /** The most recently issued client ID (used before an account is known). */
  latest: string | null;
}

export interface StoredTokens {
  access_token: string;
  refresh_token: string | null;
  /** Epoch ms. */
  expires_at: number;
  /** Epoch ms, when the token endpoint sent `earliest_refresh_at`. */
  earliest_refresh_at: number | null;
  scope: string;
  client_id: string;
  claims: {
    sub: string;
    name: string | null;
    email: string | null;
    picture: string | null;
    signature_verified: boolean;
  };
  saved_at: number;
}

export interface ChatGPTAuth extends AuthApi {
  /** A valid access token, refreshed ~2 min before expiry (single-flight). Throws AiError. */
  getAccessToken(opts?: { rejected?: string }): Promise<string>;
  /** True when signed in AND the grant includes chatgpt.tokens.use.direct. */
  hasPlanUsage(): boolean;
  /** The last sign-in error (native redirect flow has no caller to throw to). */
  lastError(): string | null;
  clearError(): void;
  /** The `returnTo` passed to signIn(), consumed once after a successful sign-in. */
  takeReturnTo(): string | null;
}

interface ModelsCache {
  sub: string;
  at: number;
  models: { slug: string; display_name: string }[];
}

// ───────────────────────────── dependencies (injectable for tests) ─────────────────────────────

export interface AuthDeps {
  platform: Pick<typeof platform, "isNative" | "openAuthUrl" | "onAuthRedirect" | "closeAuthBrowser" | "postForm" | "redirectUri">
    & Partial<Pick<typeof platform, "supportsSelfServeSignIn" | "startLoopback" | "onAuthBrowserFinished">>;
  fetch: typeof fetch;
  now: () => number;
  clientId: () => string;
  tokenRelay: () => string;
  navigate: (path: string) => void;
  warn: (msg: string) => void;
  /** Random UUID for the per-device host ID (tests inject a fixed one). */
  uuid: () => string;
}

const defaultDeps = (): AuthDeps => ({
  platform,
  fetch: (...a) => platform.httpFetch(...a),
  now: () => Date.now(),
  clientId,
  tokenRelay,
  navigate: (p) => navigate(p, { replace: true }),
  warn: (m) => console.warn(m),
  uuid: () => randomUuid(),
});

function randomUuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // RFC 4122 v4 from getRandomValues (older WebKit without randomUUID).
  const b = new Uint8Array(16);
  c!.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Thrown inside the self-serve flow when the attempt should be restarted once (e.g. invalid_grant). */
class RestartSignIn extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Accepts an issued client ID from the redirect (`oaiapp_…` today; the charset check is deliberately loose). */
export function isPlausibleClientId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$/.test(v) && v !== SELF_SERVE_CLIENT_ID;
}

const HOST_ID_RE = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** OAuth error codes that mean the refresh token is unusable → clear tokens and sign in again. */
const TERMINAL_REFRESH_ERRORS = new Set([
  "invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired",
  "refresh_token_invalidated", "refresh_token_reused",
]);

/** `earliest_refresh_at` format is undocumented: accept unix seconds, epoch ms or ISO 8601. */
export function parseInstant(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return parseInstant(n);
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function oauthError(json: any): { code: string; description: string } {
  const e = json?.error;
  if (e && typeof e === "object") return { code: String(e.code ?? e.type ?? "error"), description: String(e.message ?? "") };
  return { code: typeof e === "string" ? e : "error", description: String(json?.error_description ?? json?.detail ?? "") };
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

// ───────────────────────────── factory ─────────────────────────────

export function createAuth(overrides: Partial<AuthDeps> = {}): ChatGPTAuth {
  const d: AuthDeps = { ...defaultDeps(), ...overrides };
  const listeners = new Set<() => void>();
  let lastErr: string | null = null;
  let returnTo: string | null = null;
  let refreshing: Promise<string> | null = null;
  const exchanges = new Map<string, Promise<ChatGPTAccount>>();
  let modelsMem: ModelsCache | null = null;
  let jwksMem: { at: number; keys: Jwk[] } | null = null;
  let accountCache: { raw: string; account: ChatGPTAccount | null } | null = null;

  const emit = () => {
    accountCache = null;
    for (const fn of [...listeners]) {
      try { fn(); } catch { /* listener errors are not ours */ }
    }
  };

  const readTokens = (): StoredTokens | null => {
    const t = load<StoredTokens | null>(KEYS.tokens, null);
    return t && typeof t.access_token === "string" && t.claims?.sub ? t : null;
  };

  const noteIssue = (code: string, status: number, phase: AuthIssue["phase"]) => {
    try { save<AuthIssue>(KEYS.authIssue, { at: d.now(), code: code || `http_${status}`, status, phase }); } catch { /* diagnostics only */ }
  };
  const clearTokens = () => {
    remove(KEYS.tokens);
    remove(KEYS.models);
    modelsMem = null;
  };

  // ── token endpoint (direct, then relay on web if the browser blocks it) ──
  async function tokenRequest(params: Record<string, string>): Promise<{ status: number; json: any }> {
    const body = new URLSearchParams(params);
    try {
      return await d.platform.postForm(TOKEN_URL, body);
    } catch {
      const relay = d.tokenRelay();
      if (!d.platform.isNative() && relay) {
        try {
          return await d.platform.postForm(relay, body);
        } catch {
          throw new AiError("network", "Couldn't reach ChatGPT sign-in through the token relay. Check your connection and try again.");
        }
      }
      throw new AiError(
        "network",
        d.platform.isNative()
          ? "Couldn't reach ChatGPT sign-in. Check your connection and try again."
          : "Couldn't reach ChatGPT sign-in. If you're online, this browser may be blocking the request (CORS) — the web build needs a token relay (see docs/CHATGPT_SIGNIN.md).",
      );
    }
  }

  async function getJwks({ refresh }: { refresh: boolean }): Promise<Jwk[] | null> {
    if (!refresh && jwksMem && d.now() - jwksMem.at < 60 * 60 * 1000) return jwksMem.keys;
    try {
      const res = await d.fetch(JWKS_URL, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const json = await res.json();
      const keys = Array.isArray(json?.keys) ? (json.keys as Jwk[]) : null;
      if (keys) jwksMem = { at: d.now(), keys };
      return keys;
    } catch {
      return null;
    }
  }

  function grantedScope(json: any, accessToken: string, fallback: string): string {
    if (typeof json?.scope === "string" && json.scope.trim()) return json.scope.trim();
    try {
      const s = decodeJwt(accessToken).payload.scope;
      if (typeof s === "string" && s.trim()) return s.trim();
      if (Array.isArray(s)) return s.join(" ");
    } catch { /* access token may be opaque */ }
    return fallback; // RFC 6749 §5.1: omitted scope = as requested
  }

  function toAccount(t: StoredTokens): ChatGPTAccount {
    return {
      sub: t.claims.sub,
      name: t.claims.name,
      email: t.claims.email,
      picture: t.claims.picture,
      plan_usage: t.scope.split(/\s+/).includes(PLAN_USAGE_SCOPE),
    };
  }

  // ── self-serve (native, open-source path) helpers ──
  const selfServe = () => !d.clientId() && !!d.platform.supportsSelfServeSignIn?.() && !!d.platform.startLoopback;

  /** Stable per-device `ext_agent_host_id` (`urn:uuid:…`), created once and persisted. */
  function hostId(): string {
    const existing = load<string | null>(KEYS.hostId, null);
    if (typeof existing === "string" && HOST_ID_RE.test(existing)) return existing;
    const id = `urn:uuid:${d.uuid().toLowerCase()}`;
    if (!save(KEYS.hostId, id)) throw new AiError("unsupported", "Couldn't save sign-in data on this device (storage full or blocked).");
    return id;
  }

  function readIssued(host: string): IssuedClientIds {
    const v = load<IssuedClientIds | null>(KEYS.issuedClientIds, null);
    if (v && v.host_id === host && v.by_sub && typeof v.by_sub === "object") return v;
    return { host_id: host, by_sub: {}, last_sub: null, latest: null };
  }

  /** The issued client ID to reuse for this device: the current/last account's, else the latest. */
  function issuedClientFor(host: string): string | null {
    const v = readIssued(host);
    const sub = readTokens()?.claims.sub ?? v.last_sub;
    const bySub = sub ? v.by_sub[sub] : undefined;
    if (isPlausibleClientId(bySub)) return bySub;
    return isPlausibleClientId(v.latest) ? v.latest : null;
  }

  function rememberIssued(host: string, cid: string, sub: string): void {
    const v = readIssued(host);
    save(KEYS.issuedClientIds, { ...v, by_sub: { ...v.by_sub, [sub]: cid }, last_sub: sub, latest: cid } satisfies IssuedClientIds);
  }

  /** Drop a stored issued client ID that OpenAI rejected, so the next attempt registers again. */
  function forgetIssued(host: string, cid: string): void {
    const v = readIssued(host);
    const by_sub = Object.fromEntries(Object.entries(v.by_sub).filter(([, c]) => c !== cid));
    save(KEYS.issuedClientIds, { ...v, by_sub, latest: v.latest === cid ? null : v.latest } satisfies IssuedClientIds);
  }

  /** Wait for the loopback callback, the user closing the browser, or the attempt expiring. */
  function awaitCallback(next: Promise<URLSearchParams>): Promise<URLSearchParams> {
    return new Promise<URLSearchParams>((resolve, reject) => {
      let done = false;
      let offClosed: () => void = () => {};
      const timer = setTimeout(() => finish(() => reject(new AiError("reauth_required", "Sign-in took too long and expired. Please try again."))), PENDING_TTL_MS);
      function finish(fn: () => void) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        offClosed();
        fn();
      }
      offClosed = d.platform.onAuthBrowserFinished?.(() => finish(() => reject(new AiError("reauth_required", "Sign-in was cancelled.")))) ?? (() => {});
      next.then(
        (q) => finish(() => resolve(q)),
        () => finish(() => reject(new AiError("network", "The sign-in listener stopped unexpectedly. Please try again."))),
      );
    });
  }

  /** One self-serve attempt: loopback → authorize in the in-app browser → callback → exchange. */
  async function selfServeAttempt(rt: string | undefined, forceRegistration: boolean): Promise<void> {
    const host = hostId();
    const issued = forceRegistration ? null : issuedClientFor(host);
    let session: platform.LoopbackSession;
    try {
      session = await d.platform.startLoopback!(); // listener first, browser second
    } catch {
      throw new AiError("unsupported", "Couldn't start ChatGPT sign-in on this device. Close other apps that may be signing in and try again.");
    }
    let query: URLSearchParams;
    try {
      const state = randomString(24);
      const nonce = randomString(24);
      const { verifier, challenge } = await createPkce();
      const sentClientId = issued ?? SELF_SERVE_CLIENT_ID;
      const pending: PendingSignIn = {
        state, nonce, verifier, returnTo: rt ?? null, createdAt: d.now(), redirect_uri: session.redirectUri,
        mode: "oss", client_id: sentClientId, host_id: host,
      };
      if (!save(KEYS.pending, pending)) throw new AiError("unsupported", "Couldn't save sign-in data on this device (storage full or blocked).");
      const url = new URL(AUTHORIZE_URL);
      const q = url.searchParams;
      q.set("response_type", "code");
      q.set("client_id", sentClientId);
      if (!issued) q.set("agent_name_hint", AGENT_NAME_HINT); // first registration only
      q.set("ext_agent_host_id", host);
      q.set("redirect_uri", session.redirectUri);
      q.set("scope", SCOPE);
      q.set("resource", RESOURCE);
      q.set("state", state);
      q.set("nonce", nonce);
      q.set("code_challenge", challenge);
      q.set("code_challenge_method", "S256");
      await d.platform.openAuthUrl(url.toString());
      query = await awaitCallback(session.next());
    } catch (e) {
      remove(KEYS.pending);
      throw e;
    } finally {
      await session.stop().catch(() => {});
      await d.platform.closeAuthBrowser().catch(() => {});
    }
    await completeSignIn(query);
  }

  async function signInSelfServe(rt?: string): Promise<void> {
    lastErr = null;
    let forceRegistration = false;
    for (let attempt = 0; ; attempt++) {
      try {
        await selfServeAttempt(rt, forceRegistration);
        break;
      } catch (e) {
        if (e instanceof RestartSignIn && attempt === 0) {
          d.warn(`ChatGPT sign-in restarting: ${e.reason}`);
          forceRegistration = e.reason === "client_rejected";
          lastErr = null;
          continue;
        }
        const err = e instanceof RestartSignIn
          ? new AiError("reauth_required", "ChatGPT sign-in couldn't be completed. Please try again.")
          : e;
        lastErr = err instanceof Error ? err.message : String(err);
        emit();
        throw err;
      }
    }
    const next = returnTo;
    returnTo = null;
    if (next) d.navigate(next);
  }

  // ── sign in ──
  async function signIn(rt?: string): Promise<void> {
    const cid = d.clientId();
    if (!cid && selfServe()) return signInSelfServe(rt);
    if (!cid) throw new AiError("not_connected", "ChatGPT sign-in isn't configured in this build yet.");
    lastErr = null;
    const native = d.platform.isNative();
    const state = randomString(24) + (native ? NATIVE_STATE_SUFFIX : "");
    const nonce = randomString(24);
    const { verifier, challenge } = await createPkce();
    const redirect_uri = d.platform.redirectUri();
    const pending: PendingSignIn = { state, nonce, verifier, returnTo: rt ?? null, createdAt: d.now(), redirect_uri };
    // localStorage (not sessionStorage): SFSafariViewController → app hand-off loses session storage.
    if (!save(KEYS.pending, pending)) throw new AiError("unsupported", "This browser blocks local storage, which sign-in needs. Turn off private mode and try again.");
    const url = new URL(AUTHORIZE_URL);
    const q = url.searchParams;
    q.set("response_type", "code");
    q.set("client_id", cid);
    q.set("redirect_uri", redirect_uri);
    q.set("scope", SCOPE);
    q.set("resource", RESOURCE);
    q.set("state", state);
    q.set("nonce", nonce);
    q.set("code_challenge", challenge);
    q.set("code_challenge_method", "S256");
    await d.platform.openAuthUrl(url.toString());
  }

  async function doComplete(query: URLSearchParams): Promise<ChatGPTAccount> {
    const pending = load<PendingSignIn | null>(KEYS.pending, null);
    const state = query.get("state");
    const err = query.get("error");
    if (!pending) throw new AiError("reauth_required", "This sign-in link has expired or was already used. Please tap “Continue with ChatGPT” again.");
    if (!state || state !== pending.state) {
      throw new AiError("reauth_required", "Sign-in couldn't be verified (state mismatch). Please try again.");
    }
    remove(KEYS.pending); // single use
    const oss = pending.mode === "oss";
    if (err) {
      const desc = query.get("error_description");
      // A stored issued client ID that OpenAI no longer accepts → forget it and register again (once).
      if (oss && pending.host_id && pending.client_id && pending.client_id !== SELF_SERVE_CLIENT_ID
        && (err === "invalid_client" || err === "unauthorized_client")) {
        forgetIssued(pending.host_id, pending.client_id);
        throw new RestartSignIn("client_rejected");
      }
      throw new AiError(
        "reauth_required",
        err === "access_denied" ? "Sign-in was cancelled." : `ChatGPT sign-in failed: ${desc || err}.`,
      );
    }
    if (d.now() - pending.createdAt > PENDING_TTL_MS) throw new AiError("reauth_required", "Sign-in took too long and expired. Please try again.");
    const code = query.get("code");
    if (!code) throw new AiError("reauth_required", "ChatGPT didn't return a sign-in code. Please try again.");

    // Self-serve: a new registration returns the issued client ID on the redirect; later sign-ins
    // reuse the stored one (also accept a fresh one if OpenAI sends it).
    const callbackCid = query.get("client_id");
    const cid = oss
      ? (isPlausibleClientId(callbackCid) ? callbackCid : pending.client_id !== SELF_SERVE_CLIENT_ID ? pending.client_id ?? "" : "")
      : d.clientId();
    if (!cid) throw new AiError("server", "ChatGPT didn't return a client ID for this app. Please try again.");
    const { status, json } = await tokenRequest({
      grant_type: "authorization_code",
      client_id: cid,
      code,
      code_verifier: pending.verifier,
      redirect_uri: pending.redirect_uri,
      resource: RESOURCE,
    });
    if (status !== 200 || typeof json?.access_token !== "string") {
      const e = oauthError(json);
      if (oss && e.code === "invalid_grant") throw new RestartSignIn("invalid_grant"); // discard the code, start over
      if (oss && e.code === "invalid_client" && pending.host_id) {
        forgetIssued(pending.host_id, cid);
        throw new RestartSignIn("client_rejected");
      }
      if (e.code === "invalid_client") throw new AiError("unsupported", "This app's ChatGPT client configuration was rejected. Please update the app.");
      throw new AiError(status >= 500 ? "server" : "reauth_required", `ChatGPT sign-in failed (${e.code}). Please try again.`);
    }
    if (typeof json.id_token !== "string") throw new AiError("server", "ChatGPT sign-in returned no ID token.");

    let verified;
    try {
      verified = await verifyIdToken(json.id_token, { issuer: ISSUER, audience: cid, nonce: pending.nonce, getKeys: getJwks, nowMs: d.now(), warn: d.warn });
    } catch (e) {
      throw new AiError("reauth_required", `Sign-in couldn't be verified: ${(e as Error).message}`);
    }
    const c = verified.claims;
    const now = d.now();
    const expiresIn = Number(json.expires_in);
    const tokens: StoredTokens = {
      access_token: json.access_token,
      refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : null,
      expires_at: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
      earliest_refresh_at: parseInstant(json.earliest_refresh_at),
      scope: grantedScope(json, json.access_token, SCOPE),
      client_id: cid,
      // The raw ID token is not stored (OpenAI guidance) — only the verified profile claims.
      claims: {
        sub: String(c.sub),
        name: strOrNull(c.name),
        email: strOrNull(c.email),
        picture: strOrNull(c.picture),
        signature_verified: verified.signatureVerified,
      },
      saved_at: now,
    };
    const prev = readTokens();
    if (prev && prev.claims.sub !== tokens.claims.sub) remove(KEYS.models);
    modelsMem = null;
    if (!save(KEYS.tokens, tokens)) throw new AiError("unsupported", "Couldn't save your sign-in on this device (storage full or blocked).");
    if (oss && pending.host_id) rememberIssued(pending.host_id, cid, tokens.claims.sub);
    returnTo = pending.returnTo;
    lastErr = null;
    emit();
    return toAccount(tokens);
  }

  function completeSignIn(query: URLSearchParams): Promise<ChatGPTAccount> {
    // React StrictMode runs effects twice; the same code must not be exchanged twice.
    const key = `${query.get("state") ?? ""}|${query.get("code") ?? query.get("error") ?? ""}`;
    const existing = exchanges.get(key);
    if (existing) return existing;
    const p = doComplete(query).catch((e) => {
      lastErr = e instanceof Error ? e.message : String(e);
      emit();
      throw e;
    });
    exchanges.set(key, p);
    return p;
  }

  // ── refresh ──
  function needsRefresh(t: StoredTokens): boolean {
    const now = d.now();
    if (now >= t.expires_at - 10_000) return true; // effectively expired
    if (t.earliest_refresh_at && now < t.earliest_refresh_at) return false;
    return now >= t.expires_at - REFRESH_SKEW_MS;
  }

  async function doRefresh(rejected?: string): Promise<string> {
    const t = readTokens(); // re-read: another tab may have rotated already
    if (!t) throw new AiError("not_connected", "Sign in with ChatGPT to continue.");
    if (rejected ? t.access_token !== rejected : !needsRefresh(t)) return t.access_token;
    if (!t.refresh_token) {
      if (!rejected && d.now() < t.expires_at - 10_000) return t.access_token;
      noteIssue("no_refresh_token", 0, "refresh");
      clearTokens();
      emit();
      throw new AiError("reauth_required", "Your ChatGPT session ended. Please sign in again.");
    }
    let res: { status: number; json: any };
    try {
      res = await tokenRequest({
        grant_type: "refresh_token",
        client_id: t.client_id || d.clientId(),
        refresh_token: t.refresh_token,
        resource: RESOURCE, // scope omitted → keeps the original grant
      });
    } catch (e) {
      if (!rejected && d.now() < t.expires_at - 10_000) return t.access_token; // soft-fail: still valid
      throw e;
    }
    const { status, json } = res;
    if (status === 200 && typeof json?.access_token === "string") {
      const now = d.now();
      const expiresIn = Number(json.expires_in);
      const next: StoredTokens = {
        ...t,
        access_token: json.access_token,
        refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : t.refresh_token, // rotate
        expires_at: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
        earliest_refresh_at: parseInstant(json.earliest_refresh_at),
        scope: grantedScope(json, json.access_token, t.scope),
        saved_at: now,
      };
      save(KEYS.tokens, next); // one setItem → atomic rotation
      if (next.scope !== t.scope) emit();
      return next.access_token;
    }
    const e = oauthError(json);
    if (TERMINAL_REFRESH_ERRORS.has(e.code) || status === 401) {
      noteIssue(e.code, status, "refresh");
      clearTokens();
      emit();
      throw new AiError("reauth_required", "Your ChatGPT session ended. Please sign in again.");
    }
    if (e.code === "invalid_client") throw new AiError("unsupported", "This app's ChatGPT client configuration was rejected. Please update the app.");
    if (!rejected && d.now() < t.expires_at - 10_000) return t.access_token;
    throw new AiError(status >= 500 || status === 0 ? "server" : "network", `Couldn't refresh your ChatGPT session (${e.code}). Try again shortly.`);
  }

  function refreshSingleFlight(rejected?: string): Promise<string> {
    if (refreshing) return refreshing;
    const locks = (globalThis.navigator as any)?.locks;
    const run = () => doRefresh(rejected);
    const p: Promise<string> = locks?.request ? locks.request(`${NS}chatgpt-refresh`, run) : run();
    refreshing = p.finally(() => { refreshing = null; });
    return refreshing;
  }

  /** Renew now if the access token expires within `minValidMs` (renewal can be deferred by the server). */
  async function ensureFresh(minValidMs = 20 * 60_000): Promise<void> {
    const t = readTokens();
    if (!t) return;
    const now = d.now();
    if (t.expires_at - now > minValidMs) return;
    if (t.earliest_refresh_at && now < t.earliest_refresh_at && now < t.expires_at - 10_000) return;
    try {
      await refreshSingleFlight(t.access_token);
    } catch (e) {
      // Only a session that can't be renewed is fatal; a network blip with a still-valid token isn't.
      if (e instanceof AiError && e.code === "reauth_required") throw e;
      if (d.now() >= t.expires_at - 10_000) throw e;
    }
  }

  async function getAccessToken(opts: { rejected?: string } = {}): Promise<string> {
    const t = readTokens();
    if (!t) throw new AiError("not_connected", "Sign in with ChatGPT to continue.");
    if (opts.rejected) return refreshSingleFlight(opts.rejected);
    if (!needsRefresh(t)) return t.access_token;
    return refreshSingleFlight();
  }

  // ── sign out (+ best-effort revocation) ──
  async function revoke(t: StoredTokens): Promise<void> {
    if (!t.refresh_token) return;
    try {
      let endpoint: string | null = null;
      const res = await d.fetch(OIDC_DISCOVERY_URL, { headers: { Accept: "application/json" } });
      if (res.ok) endpoint = (await res.json())?.revocation_endpoint ?? null;
      if (!endpoint) return;
      await d.platform.postForm(endpoint, new URLSearchParams({ token: t.refresh_token, token_type_hint: "refresh_token", client_id: t.client_id }));
    } catch {
      /* Not confirmed — local tokens are gone; the user can also disconnect the app in ChatGPT settings. */
    }
  }

  function signOut(): void {
    const t = readTokens();
    clearTokens();
    remove(KEYS.pending);
    lastErr = null;
    emit();
    if (t) void revoke(t);
  }

  // ── models ──
  async function listModels(): Promise<{ slug: string; display_name: string }[]> {
    const t = readTokens();
    if (!t) return [];
    const now = d.now();
    if (!modelsMem) {
      const stored = load<ModelsCache | null>(KEYS.models, null);
      if (stored && stored.sub === t.claims.sub && Array.isArray(stored.models)) modelsMem = stored;
    }
    if (modelsMem && modelsMem.sub === t.claims.sub && now - modelsMem.at < MODELS_TTL_MS && modelsMem.models.length) return modelsMem.models;

    const fetchOnce = async (token: string) =>
      d.fetch(MODELS_URL, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    try {
      let token = await getAccessToken();
      let res = await fetchOnce(token);
      if (res.status === 401) {
        token = await getAccessToken({ rejected: token });
        res = await fetchOnce(token);
        if (res.status === 401) throw new AiError("reauth_required", "Your ChatGPT session needs to be renewed. Please sign in again.");
      }
      if (!res.ok) throw new AiError(res.status >= 500 ? "server" : "network", `Couldn't load models (${res.status}).`);
      const models = parseModels(await res.json());
      modelsMem = { sub: t.claims.sub, at: now, models };
      save(KEYS.models, modelsMem);
      return models;
    } catch (e) {
      if (modelsMem && modelsMem.sub === t.claims.sub && modelsMem.models.length) return modelsMem.models; // stale is fine
      if (e instanceof AiError) throw e;
      throw new AiError("network", "Couldn't load your ChatGPT models. Check your connection.");
    }
  }

  // ── wiring ──
  if (d.platform.isNative()) {
    d.platform.onAuthRedirect((query) => {
      // A redirect without a pending attempt is stale (e.g. the launch URL re-delivered) — ignore it.
      if (!load<PendingSignIn | null>(KEYS.pending, null)) return;
      void completeSignIn(query)
        .then(() => {
          const rt = returnTo;
          returnTo = null;
          if (rt) d.navigate(rt);
        })
        .catch(() => { /* lastErr already set + emitted */ })
        .finally(() => { void d.platform.closeAuthBrowser(); });
    });
  }
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    // Another tab signed in/out or rotated tokens.
    window.addEventListener("storage", (e) => {
      if (e.key == null || e.key === NS + KEYS.tokens) emit();
    });
  }

  return {
    configured: () => !!d.clientId() || selfServe(),
    account() {
      const raw = (() => { try { return localStorage.getItem(NS + KEYS.tokens) ?? ""; } catch { return ""; } })();
      if (accountCache && accountCache.raw === raw) return accountCache.account;
      const t = readTokens();
      accountCache = { raw, account: t ? toAccount(t) : null };
      return accountCache.account;
    },
    signIn,
    completeSignIn,
    signOut,
    listModels,
    ensureFresh,
    lastIssue: () => load<AuthIssue | null>(KEYS.authIssue, null),
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    getAccessToken,
    hasPlanUsage() {
      const t = readTokens();
      return !!t && toAccount(t).plan_usage;
    },
    lastError: () => lastErr,
    clearError() { lastErr = null; emit(); },
    takeReturnTo() {
      const rt = returnTo;
      returnTo = null;
      return rt;
    },
  };
}

/** Parse GET /v1/models: ChatGPT-plan shape `models[]` (visibility=="list"), or the API-key shape `data[]`. */
export function parseModels(json: any): { slug: string; display_name: string }[] {
  const out: { slug: string; display_name: string }[] = [];
  if (Array.isArray(json?.models)) {
    for (const m of json.models) {
      if (m && m.visibility === "list" && typeof m.slug === "string" && m.slug) {
        out.push({ slug: m.slug, display_name: typeof m.display_name === "string" && m.display_name ? m.display_name : m.slug });
      }
    }
  } else if (Array.isArray(json?.data)) {
    for (const m of json.data) if (typeof m?.id === "string") out.push({ slug: m.id, display_name: m.id });
  }
  return out;
}

/** App-wide singleton. On native it starts listening for the auth redirect at import time. */
export const auth: ChatGPTAuth = createAuth();

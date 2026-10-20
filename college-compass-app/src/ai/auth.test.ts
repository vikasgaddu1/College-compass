import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "../types";
import { createAuth, parseInstant, parseModels, type AuthDeps, type StoredTokens } from "./auth";
import { JWKS_URL, MODELS_URL, TOKEN_URL } from "./config";
import { codeChallengeS256 } from "./pkce";
import { installMemoryStorage, jsonResponse, makeSigner } from "./test-helpers";

const T0 = Date.parse("2026-10-16T12:00:00Z");
const FULL_SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

async function harness(opts: { native?: boolean; relay?: string; tokenThrows?: boolean } = {}) {
  const signer = await makeSigner();
  let now = T0;
  let redirectCb: ((q: URLSearchParams) => void) | null = null;
  const opened: string[] = [];
  const posts: { url: string; body: Record<string, string> }[] = [];
  let tokenReply: (body: Record<string, string>) => Promise<{ status: number; json: any }> = async () => ({ status: 500, json: null });

  const platform: AuthDeps["platform"] = {
    isNative: () => !!opts.native,
    openAuthUrl: async (u) => { opened.push(u); },
    onAuthRedirect: (cb) => { redirectCb = cb; return () => {}; },
    closeAuthBrowser: vi.fn(async () => {}),
    redirectUri: () => "https://vikasgaddu1.github.io/College-compass/app/callback.html",
    postForm: async (url, body) => {
      const b = Object.fromEntries(body.entries());
      posts.push({ url, body: b });
      if (url === TOKEN_URL && opts.tokenThrows) throw new TypeError("Failed to fetch");
      return tokenReply(b);
    },
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === JWKS_URL) return jsonResponse(200, { keys: [signer.jwk] });
    if (url === MODELS_URL) return jsonResponse(200, { models: [{ slug: "gpt-a", display_name: "GPT A", visibility: "list" }, { slug: "hidden", visibility: "hide" }] });
    return jsonResponse(404, {});
  });
  const navigate = vi.fn();
  const auth = createAuth({
    platform,
    fetch: fetchMock as unknown as typeof fetch,
    now: () => now,
    clientId: () => "client-1",
    tokenRelay: () => opts.relay ?? "",
    navigate,
    warn: () => {},
  });

  async function idToken(nonce: string, over: Record<string, unknown> = {}) {
    return signer.sign({ iss: "https://auth.openai.com", aud: "client-1", sub: "user-1", nonce, iat: now / 1000, exp: now / 1000 + 3600, name: "Pat", email: "pat@example.com", ...over });
  }

  /** Start sign-in and return the query the provider would redirect back with. */
  async function startSignIn(returnTo?: string) {
    await auth.signIn(returnTo);
    const u = new URL(opened.at(-1)!);
    return { url: u, state: u.searchParams.get("state")!, nonce: u.searchParams.get("nonce")! };
  }

  return {
    auth, signer, opened, posts, fetchMock, navigate, platform,
    setNow: (t: number) => { now = t; },
    setTokenReply: (f: typeof tokenReply) => { tokenReply = f; },
    idToken, startSignIn,
    redirect: (q: URLSearchParams) => redirectCb?.(q),
  };
}

function stored(): StoredTokens | null {
  const raw = localStorage.getItem("cc2:chatgpt");
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  installMemoryStorage();
});

describe("signIn", () => {
  it("builds the authorize URL with PKCE S256, state, nonce, scopes and resource", async () => {
    const h = await harness();
    const { url, state } = await h.startSignIn("/list");
    const q = url.searchParams;
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe("client-1");
    expect(q.get("redirect_uri")).toBe("https://vikasgaddu1.github.io/College-compass/app/callback.html");
    expect(q.get("scope")).toBe(FULL_SCOPE);
    expect(q.get("resource")).toBe("https://api.openai.com/v1");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(state.endsWith(".n")).toBe(false);
    const pending = JSON.parse(localStorage.getItem("cc2:oauth_pending")!);
    expect(pending).toMatchObject({ state, returnTo: "/list", createdAt: T0 });
    expect(q.get("code_challenge")).toBe(await codeChallengeS256(pending.verifier));
    expect(q.get("nonce")).toBe(pending.nonce);
  });

  it("marks native sign-ins with a .n state suffix", async () => {
    const h = await harness({ native: true });
    const { state } = await h.startSignIn();
    expect(state.endsWith(".n")).toBe(true);
  });

  it("refuses when no client ID is configured", async () => {
    const a = createAuth({ clientId: () => "", platform: (await harness()).platform });
    expect(a.configured()).toBe(false);
    await expect(a.signIn()).rejects.toMatchObject({ code: "not_connected" });
  });
});

describe("completeSignIn", () => {
  it("exchanges the code, verifies the ID token and stores tokens (not the ID token)", async () => {
    const h = await harness();
    const { state, nonce } = await h.startSignIn("/list");
    h.setTokenReply(async () => ({ status: 200, json: { access_token: "at1", refresh_token: "rt1", id_token: await h.idToken(nonce), expires_in: 3600, scope: FULL_SCOPE, token_type: "Bearer" } }));
    const listener = vi.fn();
    h.auth.subscribe(listener);
    const acct = await h.auth.completeSignIn(new URLSearchParams({ code: "c1", state }));
    expect(acct).toEqual({ sub: "user-1", name: "Pat", email: "pat@example.com", picture: null, plan_usage: true });
    const post = h.posts.at(-1)!;
    expect(post.body).toMatchObject({ grant_type: "authorization_code", client_id: "client-1", code: "c1", redirect_uri: "https://vikasgaddu1.github.io/College-compass/app/callback.html", resource: "https://api.openai.com/v1" });
    expect(post.body.code_verifier).toBeTruthy();
    const t = stored()!;
    expect(t).toMatchObject({ access_token: "at1", refresh_token: "rt1", expires_at: T0 + 3600_000, scope: FULL_SCOPE });
    expect(t.claims.signature_verified).toBe(true);
    expect(JSON.stringify(t)).not.toContain("id_token");
    expect(localStorage.getItem("cc2:oauth_pending")).toBeNull();
    expect(listener).toHaveBeenCalled();
    expect(h.auth.account()?.sub).toBe("user-1");
    expect(h.auth.account()).toBe(h.auth.account()); // stable for useSyncExternalStore
    expect(h.auth.takeReturnTo()).toBe("/list");
    expect(h.auth.takeReturnTo()).toBeNull();
  });

  it("dedupes a double call with the same code (React StrictMode)", async () => {
    const h = await harness();
    const { state, nonce } = await h.startSignIn();
    h.setTokenReply(async () => ({ status: 200, json: { access_token: "at", id_token: await h.idToken(nonce), expires_in: 3600, scope: FULL_SCOPE } }));
    const q = new URLSearchParams({ code: "c", state });
    const [a, b] = await Promise.all([h.auth.completeSignIn(q), h.auth.completeSignIn(q)]);
    expect(a).toEqual(b);
    expect(h.posts.filter((p) => p.body.grant_type === "authorization_code")).toHaveLength(1);
  });

  it("rejects state mismatch, provider errors and expired attempts", async () => {
    const h = await harness();
    let s = await h.startSignIn();
    await expect(h.auth.completeSignIn(new URLSearchParams({ code: "c", state: "wrong" }))).rejects.toMatchObject({ code: "reauth_required" });
    expect(h.auth.lastError()).toMatch(/state/);
    await expect(h.auth.completeSignIn(new URLSearchParams({ error: "access_denied", state: s.state }))).rejects.toThrow(/cancelled/);
    s = await h.startSignIn();
    h.setNow(T0 + 11 * 60_000);
    await expect(h.auth.completeSignIn(new URLSearchParams({ code: "c", state: s.state }))).rejects.toThrow(/expired/);
    await expect(h.auth.completeSignIn(new URLSearchParams({ code: "c2", state: s.state }))).rejects.toThrow(/already used/);
  });

  it("rejects an ID token with the wrong nonce", async () => {
    const h = await harness();
    const { state } = await h.startSignIn();
    h.setTokenReply(async () => ({ status: 200, json: { access_token: "at", id_token: await h.idToken("other"), expires_in: 3600 } }));
    await expect(h.auth.completeSignIn(new URLSearchParams({ code: "c", state }))).rejects.toThrow(/nonce/);
    expect(stored()).toBeNull();
  });

  it("plan_usage is false when chatgpt.tokens.use.direct wasn't granted", async () => {
    const h = await harness();
    const { state, nonce } = await h.startSignIn();
    h.setTokenReply(async () => ({ status: 200, json: { access_token: "at", id_token: await h.idToken(nonce), expires_in: 3600, scope: "openid profile email" } }));
    const a = await h.auth.completeSignIn(new URLSearchParams({ code: "c", state }));
    expect(a.plan_usage).toBe(false);
    expect(h.auth.hasPlanUsage()).toBe(false);
  });

  it("falls back to the token relay on web when the browser blocks the token endpoint", async () => {
    const h = await harness({ relay: "https://relay.example.workers.dev", tokenThrows: true });
    const { state, nonce } = await h.startSignIn();
    h.setTokenReply(async () => ({ status: 200, json: { access_token: "at", id_token: await h.idToken(nonce), expires_in: 3600, scope: FULL_SCOPE } }));
    await h.auth.completeSignIn(new URLSearchParams({ code: "c", state }));
    expect(h.posts.map((p) => p.url)).toEqual([TOKEN_URL, "https://relay.example.workers.dev"]);
  });

  it("reports a CORS hint when the token endpoint is blocked and no relay is set", async () => {
    const h = await harness({ tokenThrows: true });
    const { state } = await h.startSignIn();
    await expect(h.auth.completeSignIn(new URLSearchParams({ code: "c", state }))).rejects.toMatchObject({ code: "network", message: expect.stringMatching(/relay/) });
  });

  it("native: completes from the app redirect, closes the browser and navigates to returnTo", async () => {
    const h = await harness({ native: true });
    const { state, nonce } = await h.startSignIn("/research");
    h.setTokenReply(async () => ({ status: 200, json: { access_token: "at", id_token: await h.idToken(nonce), expires_in: 3600, scope: FULL_SCOPE } }));
    h.redirect(new URLSearchParams({ code: "c", state }));
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/research"));
    expect(h.platform.closeAuthBrowser).toHaveBeenCalled();
    expect(h.auth.account()?.sub).toBe("user-1");
    // A stale re-delivered launch URL with no pending attempt is ignored.
    h.redirect(new URLSearchParams({ code: "c", state }));
    expect(h.auth.lastError()).toBeNull();
  });
});

async function signedIn(h: Awaited<ReturnType<typeof harness>>, extra: Record<string, unknown> = {}) {
  const { state, nonce } = await h.startSignIn();
  h.setTokenReply(async () => ({ status: 200, json: { access_token: "at1", refresh_token: "rt1", id_token: await h.idToken(nonce), expires_in: 3600, scope: FULL_SCOPE, ...extra } }));
  await h.auth.completeSignIn(new URLSearchParams({ code: "c", state }));
}

describe("getAccessToken / refresh", () => {
  it("returns the stored token while fresh and refreshes ~2 min before expiry, rotating the refresh token", async () => {
    const h = await harness();
    await signedIn(h);
    expect(await h.auth.getAccessToken()).toBe("at1");
    h.setNow(T0 + 3600_000 - 90_000);
    let refreshes = 0;
    h.setTokenReply(async (b) => {
      refreshes++;
      expect(b).toMatchObject({ grant_type: "refresh_token", client_id: "client-1", refresh_token: "rt1", resource: "https://api.openai.com/v1" });
      expect(b.scope).toBeUndefined();
      await new Promise((r) => setTimeout(r, 5));
      return { status: 200, json: { access_token: "at2", refresh_token: "rt2", expires_in: 3600 } };
    });
    const tokens = await Promise.all([h.auth.getAccessToken(), h.auth.getAccessToken(), h.auth.getAccessToken()]);
    expect(tokens).toEqual(["at2", "at2", "at2"]);
    expect(refreshes).toBe(1); // single-flight
    expect(stored()).toMatchObject({ access_token: "at2", refresh_token: "rt2", scope: FULL_SCOPE });
  });

  it("forces a refresh for a rejected token, but not if it already rotated", async () => {
    const h = await harness();
    await signedIn(h);
    h.setTokenReply(async () => ({ status: 200, json: { access_token: "at2", refresh_token: "rt2", expires_in: 3600 } }));
    expect(await h.auth.getAccessToken({ rejected: "at1" })).toBe("at2");
    expect(await h.auth.getAccessToken({ rejected: "at1" })).toBe("at2");
    expect(h.posts.filter((p) => p.body.grant_type === "refresh_token")).toHaveLength(1);
  });

  it("invalid_grant on refresh → signs out and throws reauth_required", async () => {
    const h = await harness();
    await signedIn(h);
    h.setNow(T0 + 3600_000);
    h.setTokenReply(async () => ({ status: 400, json: { error: "invalid_grant" } }));
    await expect(h.auth.getAccessToken()).rejects.toMatchObject({ code: "reauth_required" });
    expect(h.auth.account()).toBeNull();
  });

  it("transient refresh failures keep the session and reuse a still-valid token", async () => {
    const h = await harness();
    await signedIn(h);
    h.setNow(T0 + 3600_000 - 60_000);
    h.setTokenReply(async () => ({ status: 503, json: null }));
    expect(await h.auth.getAccessToken()).toBe("at1");
    h.setNow(T0 + 3600_000 + 1);
    await expect(h.auth.getAccessToken()).rejects.toBeInstanceOf(AiError);
    expect(h.auth.account()).not.toBeNull();
  });

  it("honors earliest_refresh_at", async () => {
    const h = await harness();
    await signedIn(h, { expires_in: 300, earliest_refresh_at: (T0 + 250_000) / 1000 });
    h.setNow(T0 + 200_000); // inside the 2-min window but before earliest_refresh_at
    expect(await h.auth.getAccessToken()).toBe("at1");
    expect(h.posts.filter((p) => p.body.grant_type === "refresh_token")).toHaveLength(0);
  });
});

describe("signOut / models", () => {
  it("signOut clears tokens and notifies", async () => {
    const h = await harness();
    await signedIn(h);
    const fn = vi.fn();
    h.auth.subscribe(fn);
    h.auth.signOut();
    expect(stored()).toBeNull();
    expect(h.auth.account()).toBeNull();
    expect(fn).toHaveBeenCalled();
  });

  it("lists visible models and caches them for an hour", async () => {
    const h = await harness();
    expect(await h.auth.listModels()).toEqual([]);
    await signedIn(h);
    expect(await h.auth.listModels()).toEqual([{ slug: "gpt-a", display_name: "GPT A" }]);
    await h.auth.listModels();
    expect(h.fetchMock.mock.calls.filter((c) => String(c[0]) === MODELS_URL)).toHaveLength(1);
    const [, init] = h.fetchMock.mock.calls.find((c) => String(c[0]) === MODELS_URL)!;
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer at1");
  });

  it("parseModels / parseInstant handle both shapes", () => {
    expect(parseModels({ data: [{ id: "gpt-5" }] })).toEqual([{ slug: "gpt-5", display_name: "gpt-5" }]);
    expect(parseModels({ models: [{ slug: "x", visibility: "list" }] })).toEqual([{ slug: "x", display_name: "x" }]);
    expect(parseModels(null)).toEqual([]);
    expect(parseInstant(1_800_000_000)).toBe(1_800_000_000_000);
    expect(parseInstant(1_800_000_000_000)).toBe(1_800_000_000_000);
    expect(parseInstant("2026-10-16T12:00:00Z")).toBe(T0);
    expect(parseInstant(null)).toBeNull();
  });
});

describe("ensureFresh (renew while the app is open) and renewal diagnostics", () => {
  it("renews ahead of time when the session expires within the window, and not otherwise", async () => {
    const h = await harness();
    await signedIn(h);
    h.setTokenReply(async () => ({ status: 200, json: { access_token: "at2", refresh_token: "rt2", expires_in: 3600 } }));
    await h.auth.ensureFresh!(20 * 60_000); // 60 min left → nothing to do
    expect(h.posts.filter((p) => p.body.grant_type === "refresh_token")).toHaveLength(0);
    h.setNow(T0 + 45 * 60_000); // 15 min left → renew now
    await h.auth.ensureFresh!(20 * 60_000);
    expect(h.posts.filter((p) => p.body.grant_type === "refresh_token")).toHaveLength(1);
    expect(stored()).toMatchObject({ access_token: "at2", refresh_token: "rt2" });
  });

  it("a network blip with a still-valid token is not fatal; an ended session is, and its reason is recorded", async () => {
    const h = await harness();
    await signedIn(h);
    h.setNow(T0 + 50 * 60_000);
    h.setTokenReply(async () => ({ status: 503, json: null }));
    await expect(h.auth.ensureFresh!()).resolves.toBeUndefined();
    expect(h.auth.account()).not.toBeNull();
    expect(h.auth.lastIssue!()).toBeNull();
    h.setTokenReply(async () => ({ status: 400, json: { error: "refresh_token_reused" } }));
    await expect(h.auth.ensureFresh!()).rejects.toMatchObject({ code: "reauth_required" });
    expect(h.auth.lastIssue!()).toMatchObject({ code: "refresh_token_reused", status: 400, phase: "refresh", at: T0 + 50 * 60_000 });
    expect(JSON.stringify(h.auth.lastIssue!())).not.toMatch(/rt1|at1/);
  });
});

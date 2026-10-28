import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth, isPlausibleClientId, type AuthDeps, type StoredTokens } from "./auth";
import { JWKS_URL, TOKEN_URL } from "./config";
import { codeChallengeS256 } from "./pkce";
import { installMemoryStorage, jsonResponse, makeSigner } from "./test-helpers";

const T0 = Date.parse("2026-10-16T12:00:00Z");
const FULL_SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const HOST = `urn:uuid:${UUID}`;
const ISSUED = "oaiapp_abc123";

/** Native self-serve harness: no partner client ID, a fake loopback listener and in-app browser. */
async function harness(opts: { clientId?: string } = {}) {
  const signer = await makeSigner();
  let now = T0;
  let port = 1455;
  const opened: string[] = [];
  const posts: { url: string; body: Record<string, string> }[] = [];
  const sessions: { redirectUri: string; stop: ReturnType<typeof vi.fn>; deliver: (q: URLSearchParams) => void }[] = [];
  let browserFinished: (() => void) | null = null;
  let tokenReply: (body: Record<string, string>) => Promise<{ status: number; json: any }> = async () => ({ status: 500, json: null });

  const platform: AuthDeps["platform"] = {
    isNative: () => true,
    supportsSelfServeSignIn: () => true,
    openAuthUrl: async (u) => { opened.push(u); },
    onAuthRedirect: () => () => {},
    onAuthBrowserFinished: (cb) => { browserFinished = cb; return () => { browserFinished = null; }; },
    closeAuthBrowser: vi.fn(async () => {}),
    redirectUri: () => "https://vikasgaddu1.github.io/College-compass/app/callback.html",
    startLoopback: vi.fn(async () => {
      let deliver!: (q: URLSearchParams) => void;
      const first = new Promise<URLSearchParams>((r) => { deliver = r; });
      const s = { redirectUri: `http://127.0.0.1:${port}/auth/callback`, stop: vi.fn(async () => {}), deliver };
      sessions.push(s);
      return { redirectUri: s.redirectUri, stop: s.stop, next: () => first };
    }),
    postForm: async (url, body) => {
      const b = Object.fromEntries(body.entries());
      posts.push({ url, body: b });
      return tokenReply(b);
    },
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === JWKS_URL) return jsonResponse(200, { keys: [signer.jwk] });
    return jsonResponse(404, {});
  });
  const navigate = vi.fn();
  const auth = createAuth({
    platform,
    fetch: fetchMock as unknown as typeof fetch,
    now: () => now,
    clientId: () => opts.clientId ?? "",
    tokenRelay: () => "",
    navigate,
    warn: () => {},
    uuid: () => UUID,
  });

  const idToken = (nonce: string, aud: string, over: Record<string, unknown> = {}) =>
    signer.sign({ iss: "https://auth.openai.com", aud, sub: "user-1", nonce, iat: now / 1000, exp: now / 1000 + 3600, name: "Pat", email: "pat@example.com", ...over });

  /** Wait until the authorize URL has been opened (attempt `n`, 1-based) and return its params. */
  async function authorizeOpened(n = 1) {
    await vi.waitFor(() => expect(opened.length).toBeGreaterThanOrEqual(n));
    const u = new URL(opened[n - 1]!);
    return { url: u, q: u.searchParams, state: u.searchParams.get("state")!, nonce: u.searchParams.get("nonce")! };
  }

  /** Answer the token endpoint with tokens whose ID token audience is `aud`. */
  function replyTokens(aud: string, nonce: string, extra: Record<string, unknown> = {}) {
    tokenReply = async (b) => {
      if (b.grant_type === "authorization_code") {
        return { status: 200, json: { access_token: "at1", refresh_token: "rt1", id_token: await idToken(nonce, aud), expires_in: 3600, scope: FULL_SCOPE, ...extra } };
      }
      return { status: 500, json: null };
    };
  }

  return {
    auth, platform, opened, posts, sessions, navigate,
    setNow: (t: number) => { now = t; },
    setPort: (p: number) => { port = p; },
    setTokenReply: (f: typeof tokenReply) => { tokenReply = f; },
    closeBrowser: () => browserFinished?.(),
    authorizeOpened, replyTokens, idToken,
  };
}

function stored(): StoredTokens | null {
  const raw = localStorage.getItem("cc2:chatgpt");
  return raw ? JSON.parse(raw) : null;
}
function issued(): any {
  const raw = localStorage.getItem("cc2:issued_client_id");
  return raw ? JSON.parse(raw) : null;
}

/** Full first registration; leaves the device signed in with ISSUED. */
async function firstRegistration(h: Awaited<ReturnType<typeof harness>>, returnTo?: string) {
  const p = h.auth.signIn(returnTo);
  const a = await h.authorizeOpened(1);
  h.replyTokens(ISSUED, a.nonce);
  h.sessions[0]!.deliver(new URLSearchParams({ code: "c1", state: a.state, client_id: ISSUED }));
  await p;
  return a;
}

beforeEach(() => {
  installMemoryStorage();
});

describe("self-serve sign-in (native, no partner client ID)", () => {
  it("is configured on native without a client ID", async () => {
    const h = await harness();
    expect(h.auth.configured()).toBe(true);
  });

  it("first registration: dynamic_agent_client + agent_name_hint + host id + loopback redirect; saves and uses the issued client_id", async () => {
    const h = await harness();
    const p = h.auth.signIn("/onboarding/1");
    const { url, q, state, nonce } = await h.authorizeOpened();

    expect(url.origin + url.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    expect(q.get("client_id")).toBe("dynamic_agent_client");
    expect(q.get("agent_name_hint")).toBe("Tierwise");
    expect(q.get("ext_agent_host_id")).toBe(HOST);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("redirect_uri")).toBe("http://127.0.0.1:1455/auth/callback");
    expect(q.get("scope")).toBe(FULL_SCOPE);
    expect(q.get("resource")).toBe("https://api.openai.com/v1");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(state.endsWith(".n")).toBe(false);
    // Listener is started before the browser opens.
    expect(h.platform.startLoopback).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("cc2:host_id")).toBe(JSON.stringify(HOST));

    const pending = JSON.parse(localStorage.getItem("cc2:oauth_pending")!);
    expect(pending).toMatchObject({ state, nonce, mode: "oss", client_id: "dynamic_agent_client", host_id: HOST, redirect_uri: "http://127.0.0.1:1455/auth/callback", createdAt: T0 });
    expect(q.get("code_challenge")).toBe(await codeChallengeS256(pending.verifier));

    h.replyTokens(ISSUED, nonce);
    h.sessions[0]!.deliver(new URLSearchParams({ code: "c1", state, client_id: ISSUED }));
    await p;

    const post = h.posts.at(-1)!;
    expect(post.url).toBe(TOKEN_URL);
    expect(post.body).toMatchObject({
      grant_type: "authorization_code", client_id: ISSUED, code: "c1", code_verifier: pending.verifier,
      redirect_uri: "http://127.0.0.1:1455/auth/callback", resource: "https://api.openai.com/v1",
    });
    expect(stored()).toMatchObject({ access_token: "at1", client_id: ISSUED, scope: FULL_SCOPE });
    expect(stored()!.claims.signature_verified).toBe(true);
    expect(issued()).toEqual({ host_id: HOST, by_sub: { "user-1": ISSUED }, last_sub: "user-1", latest: ISSUED });
    expect(h.auth.hasPlanUsage()).toBe(true);
    expect(h.sessions[0]!.stop).toHaveBeenCalled();
    expect(h.platform.closeAuthBrowser).toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledWith("/onboarding/1");
    expect(localStorage.getItem("cc2:oauth_pending")).toBeNull();
  });

  it("rejects an ID token whose audience isn't the issued client_id", async () => {
    const h = await harness();
    const p = h.auth.signIn();
    const a = await h.authorizeOpened();
    h.replyTokens("someone-else", a.nonce);
    h.sessions[0]!.deliver(new URLSearchParams({ code: "c1", state: a.state, client_id: ISSUED }));
    await expect(p).rejects.toMatchObject({ code: "reauth_required" });
    expect(stored()).toBeNull();
    expect(issued()).toBeNull();
  });

  it("re-sign-in reuses the issued client_id and host id, without agent_name_hint", async () => {
    const h = await harness();
    await firstRegistration(h);
    h.auth.signOut();
    expect(stored()).toBeNull();
    expect(issued()?.latest).toBe(ISSUED); // registration survives sign-out

    h.setPort(50123); // only the port may vary
    const p = h.auth.signIn();
    const { q, state, nonce } = await h.authorizeOpened(2);
    expect(q.get("client_id")).toBe(ISSUED);
    expect(q.has("agent_name_hint")).toBe(false);
    expect(q.get("ext_agent_host_id")).toBe(HOST);
    expect(q.get("redirect_uri")).toBe("http://127.0.0.1:50123/auth/callback");

    h.replyTokens(ISSUED, nonce);
    h.sessions[1]!.deliver(new URLSearchParams({ code: "c2", state })); // no client_id on later sign-ins
    await p;
    expect(h.posts.at(-1)!.body).toMatchObject({ grant_type: "authorization_code", client_id: ISSUED, code: "c2", redirect_uri: "http://127.0.0.1:50123/auth/callback" });
    expect(stored()?.client_id).toBe(ISSUED);
  });

  it("error=access_denied: shows the error, stops the listener and closes the browser", async () => {
    const h = await harness();
    const p = h.auth.signIn();
    const { state } = await h.authorizeOpened();
    h.sessions[0]!.deliver(new URLSearchParams({ error: "access_denied", state }));
    await expect(p).rejects.toMatchObject({ code: "reauth_required", message: expect.stringMatching(/cancelled/) });
    expect(h.auth.lastError()).toMatch(/cancelled/);
    expect(h.sessions[0]!.stop).toHaveBeenCalled();
    expect(h.platform.closeAuthBrowser).toHaveBeenCalled();
    expect(h.posts).toHaveLength(0);
    expect(stored()).toBeNull();
  });

  it("other provider errors include the description", async () => {
    const h = await harness();
    const p = h.auth.signIn();
    const { state } = await h.authorizeOpened();
    h.sessions[0]!.deliver(new URLSearchParams({ error: "server_error", error_description: "Try later", state }));
    await expect(p).rejects.toThrow(/Try later/);
  });

  it("state mismatch is rejected and nothing is exchanged", async () => {
    const h = await harness();
    const p = h.auth.signIn();
    await h.authorizeOpened();
    h.sessions[0]!.deliver(new URLSearchParams({ code: "c1", state: "forged", client_id: ISSUED }));
    await expect(p).rejects.toThrow(/state mismatch/);
    expect(h.posts).toHaveLength(0);
    expect(issued()).toBeNull();
  });

  it("closing the in-app browser cancels the attempt", async () => {
    const h = await harness();
    const p = h.auth.signIn();
    await h.authorizeOpened();
    h.closeBrowser();
    await expect(p).rejects.toThrow(/cancelled/);
    expect(h.sessions[0]!.stop).toHaveBeenCalled();
    expect(localStorage.getItem("cc2:oauth_pending")).toBeNull();
  });

  it("invalid_grant on the exchange discards the code and restarts once", async () => {
    const h = await harness();
    const p = h.auth.signIn();
    const a1 = await h.authorizeOpened(1);
    h.setTokenReply(async () => ({ status: 400, json: { error: "invalid_grant" } }));
    h.sessions[0]!.deliver(new URLSearchParams({ code: "bad", state: a1.state, client_id: ISSUED }));
    const a2 = await h.authorizeOpened(2);
    expect(a2.q.get("client_id")).toBe("dynamic_agent_client"); // nothing was saved from the failed attempt
    expect(a2.state).not.toBe(a1.state);
    h.replyTokens(ISSUED, a2.nonce);
    h.sessions[1]!.deliver(new URLSearchParams({ code: "good", state: a2.state, client_id: ISSUED }));
    await p;
    expect(h.posts.map((x) => x.body.code)).toEqual(["bad", "good"]);
    expect(stored()?.client_id).toBe(ISSUED);
  });

  it("a stored issued client_id that OpenAI rejects is forgotten and the device registers again", async () => {
    const h = await harness();
    await firstRegistration(h);
    h.auth.signOut();
    const p = h.auth.signIn();
    const a2 = await h.authorizeOpened(2);
    expect(a2.q.get("client_id")).toBe(ISSUED);
    h.sessions[1]!.deliver(new URLSearchParams({ error: "invalid_client", state: a2.state }));
    const a3 = await h.authorizeOpened(3);
    expect(a3.q.get("client_id")).toBe("dynamic_agent_client");
    expect(a3.q.get("agent_name_hint")).toBe("Tierwise");
    expect(a3.q.get("ext_agent_host_id")).toBe(HOST);
    h.replyTokens("oaiapp_new", a3.nonce);
    h.sessions[2]!.deliver(new URLSearchParams({ code: "c3", state: a3.state, client_id: "oaiapp_new" }));
    await p;
    expect(issued()).toMatchObject({ latest: "oaiapp_new", by_sub: { "user-1": "oaiapp_new" } });
  });

  it("refresh uses the stored issued client_id", async () => {
    const h = await harness();
    await firstRegistration(h);
    h.setNow(T0 + 3600_000 - 60_000);
    h.setTokenReply(async (b) => {
      expect(b).toMatchObject({ grant_type: "refresh_token", client_id: ISSUED, refresh_token: "rt1", resource: "https://api.openai.com/v1" });
      return { status: 200, json: { access_token: "at2", refresh_token: "rt2", expires_in: 3600 } };
    });
    expect(await h.auth.getAccessToken()).toBe("at2");
    expect(h.posts.at(-1)!.body.client_id).toBe(ISSUED);
  });

  it("a partner client ID, when configured, still wins on native", async () => {
    const h = await harness({ clientId: "partner-1" });
    await h.auth.signIn();
    const { q, state } = await h.authorizeOpened();
    expect(q.get("client_id")).toBe("partner-1");
    expect(q.has("ext_agent_host_id")).toBe(false);
    expect(state.endsWith(".n")).toBe(true);
    expect(h.platform.startLoopback).not.toHaveBeenCalled();
  });

  it("keeps an existing host id and rejects malformed ones", async () => {
    localStorage.setItem("cc2:host_id", JSON.stringify("urn:uuid:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"));
    const h = await harness();
    void h.auth.signIn().catch(() => {});
    const { q } = await h.authorizeOpened();
    expect(q.get("ext_agent_host_id")).toBe("urn:uuid:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    h.closeBrowser();

    installMemoryStorage();
    localStorage.setItem("cc2:host_id", JSON.stringify("not-a-urn"));
    const h2 = await harness();
    void h2.auth.signIn().catch(() => {});
    expect((await h2.authorizeOpened()).q.get("ext_agent_host_id")).toBe(HOST);
    h2.closeBrowser();
  });

  it("isPlausibleClientId", () => {
    expect(isPlausibleClientId("oaiapp_abc123")).toBe(true);
    expect(isPlausibleClientId("dynamic_agent_client")).toBe(false);
    expect(isPlausibleClientId("")).toBe(false);
    expect(isPlausibleClientId("a b")).toBe(false);
    expect(isPlausibleClientId(null)).toBe(false);
  });
});

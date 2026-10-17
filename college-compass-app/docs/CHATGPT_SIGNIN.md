# Sign in with ChatGPT: setup guide for the owner

College Compass has no backend and no database. Each student signs in with **their own ChatGPT
account**, and every AI request (planner, research agents, Ask tab) goes **from their device straight
to OpenAI**, billed to **their ChatGPT plan**. This guide covers the two sign-in modes, what you need to
set up, what it costs you (nothing per user), and what still isn't certain.

## Two sign-in modes

| | **iOS app: self-serve (open-source path)** | **Web build: partner client ID** |
|---|---|---|
| Used when | native iOS app **and** `VITE_CC_CHATGPT_CLIENT_ID` is empty | web/PWA build, or any build with `VITE_CC_CHATGPT_CLIENT_ID` set |
| Approval from OpenAI | **none** | client ID issued by OpenAI's partner program |
| Redirect | HTTP loopback `http://127.0.0.1:<port>/auth/callback` inside the app | `https://vikasgaddu1.github.io/College-compass/app/callback.html` |
| Client ID | `dynamic_agent_client` on first sign-in, then the `oaiapp_…` ID OpenAI issues to this device | the partner client ID |
| Status | **works today** | waiting for OpenAI to issue a client ID |

**Who can use it.** Any ChatGPT account can complete sign-in. Research and chat run on the account's
**plan usage**, which needs a paid plan (**ChatGPT Plus or Pro**). A Free account can sign in, but the
research and Ask features won't run on it; the app explains why (plan-usage or usage-limit message
with a "Manage usage" link).

**Eligibility of the self-serve path.** OpenAI's self-serve path is documented for **open-source,
locally run apps** (developers.openai.com/siwc/token-sharing-open-source, Oct 2026). The iOS app
qualifies on both counts: it is free and open source (public GitHub repo) and runs entirely on the
phone, with no developer server. A **paid** app, or one that runs its AI calls on a **remotely hosted**
server, does not fit that path and needs the partner interest form (§1). If the app ever becomes paid
or gains a backend, switch the iOS build to a partner client ID (set `VITE_CC_CHATGPT_CLIENT_ID`; the
native app then uses it automatically).

## Verified with a real ChatGPT account (2026-10-17)

- **Self-serve sign-in works end to end.** `client_id=dynamic_agent_client` + `agent_name_hint` + `ext_agent_host_id` → account chooser → "Connect College Compass to ChatGPT" (agent name, then profile + "Use your ChatGPT plan" consent) → redirect to `http://127.0.0.1:1455/auth/callback?code=…&state=…&client_id=oaiapp_…`. The code exchange at the token endpoint returned 200 with `access_token` (1 h), a `refresh_token`, an `id_token` whose `nonce`/`aud` matched, and the scope `chatgpt.tokens.use.direct email offline_access openid profile resource.invoke`.
- **The token endpoint allows browser CORS** (the exchange ran with `fetch` from the github.io origin).
- **api.openai.com does not.** Authenticated calls (`GET /v1/models` with a ChatGPT token, any `POST /v1/responses`) fail CORS from a web origin. So the native app sends every OpenAI request through `platform.httpFetch` → CapacitorHttp (URLSession, no CORS). Streaming responses are buffered and parsed once complete. The web build can sign in but cannot run plan-usage requests; it says so and points to the iPhone app.

## 0. iOS self-serve sign-in (how it works)

Nothing to configure: leave `VITE_CC_CHATGPT_CLIENT_ID` empty for the iOS build.

```
App: LoopbackAuth.start()  → NWListener on 127.0.0.1:1455 (or any free port if 1455 is busy)
     open SFSafariViewController(authorize?client_id=dynamic_agent_client&agent_name_hint=College Compass
                                  &ext_agent_host_id=urn:uuid:…&redirect_uri=http://127.0.0.1:1455/auth/callback…)
OpenAI login ──redirect──▶ http://127.0.0.1:1455/auth/callback?code&state&client_id=oaiapp_…
     plugin answers with a "Signed in to College Compass" page and emits `callback` to JS
App: stop listener, close browser, check state, POST /oauth/token with client_id=oaiapp_…
```

- **Listener first.** The native plugin (`ios/App/App/LoopbackAuthPlugin.swift`, registered in
  `MainViewController.swift`) binds to `127.0.0.1` only, never `localhost` or another interface. It
  tries port 1455 and falls back to an OS-assigned port. Only the port may differ between sign-ins;
  scheme, host and path never change. It answers only `GET /auth/callback?…` (anything else gets 404),
  delivers one callback per sign-in, and stops as soon as sign-in finishes. `Info.plist` sets
  `NSAllowsLocalNetworking` (arbitrary loads stay off).
- **Per-device host ID.** `ext_agent_host_id` is `urn:uuid:<uuid>`, created once with
  `crypto.randomUUID()` and kept in `cc2:host_id`. It is sent on every sign-in from this device.
- **First registration** sends `client_id=dynamic_agent_client` and `agent_name_hint=College Compass`
  (same on every install; display metadata only). The redirect returns `code`, `state` and the
  **issued `client_id`** (`oaiapp_…`).
- **Issued client ID.** It is used for the token exchange, as the expected ID-token `aud`, for every
  refresh, and for revocation. After a successful sign-in it is saved per device and account in
  `cc2:issued_client_id` (`by_sub`, `last_sub`, `latest`). Later sign-ins send it as `client_id`
  (with the same `ext_agent_host_id` and no `agent_name_hint`). Sign-out keeps it; **Delete
  everything** removes it, and the next sign-in registers again. `host_id` and `issued_client_id` are
  never exported, because they belong to this device.
- **Errors.** `error=access_denied` shows "Sign-in was cancelled."; other `error` values are shown
  with their description. A state mismatch is rejected before any exchange. `invalid_grant` on the
  exchange discards the code and restarts sign-in once. If OpenAI rejects a stored issued client ID
  (`invalid_client` / `unauthorized_client`), it is forgotten and the device registers again (once).
  Closing the in-app browser cancels the attempt; an attempt expires after 10 minutes.
- **Scopes and plan usage.** The same scopes and `resource` as the partner path. Plan usage is on
  only if the granted scope includes `chatgpt.tokens.use.direct`.
- **No cold-start recovery.** The listener lives in the app process. If iOS kills the app while the
  login page is open, the redirect has nowhere to go; the user simply taps "Continue with ChatGPT"
  again.
- **No secret, no partner key** anywhere in the app or the repo.

Code: `src/ai/auth.ts` (`signInSelfServe`), `src/platform/index.ts` (`startLoopback`,
`createLoopbackSession`, `parseLoopbackCallback`), tests in `src/ai/auth-selfserve.test.ts` and
`src/platform/platform.test.ts`.

---

# Partner client-ID path (web build)

The web/PWA build cannot open a loopback listener, so it needs a client ID from OpenAI's partner
program. Everything below applies to that path. (The native app also uses it whenever
`VITE_CC_CHATGPT_CLIENT_ID` is set.)

## 1. Request a client ID from OpenAI

The partner path is a limited trial for selected partners. Apply through the interest form linked
from <https://developers.openai.com/siwc/request-client-id>
(form: <https://openai.com/form/sign-in-with-chatgpt-interest/>).

What to tell them (copy and adapt):

> **App:** College Compass, a free college-search assistant for US high-school students
> (any field of study). It ships as a hosted web app/PWA at
> `https://vikasgaddu1.github.io/College-compass/app/` and as a native iOS app on the App Store
> (bundle id `com.gaddu.collegecompass`).
>
> **Integration:** a public OAuth client (Authorization Code + PKCE S256 + state + nonce, no client
> secret) that needs **ChatGPT plan usage**. Scopes:
> `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`,
> resource `https://api.openai.com/v1`. Inference is `POST /v1/responses` with `store:false` and
> `stream:true`, using function tools and `web_search`. Models come from `GET /v1/models`.
>
> **Architecture:** no backend. Tokens are exchanged, refreshed and stored on the user's device only.
> We operate no servers that see user data. (An optional stateless relay is only used if your token
> endpoint blocks browser CORS; see §4.)
>
> **Redirect URIs:**
> - Production (web and iOS): `https://vikasgaddu1.github.io/College-compass/app/callback.html`
> - Development: `http://localhost:5173/College-compass/app/callback.html`
>
> The iOS app opens the authorize URL in SFSafariViewController. The HTTPS callback page then
> forwards to the app's custom scheme `collegecompass://auth/callback`, so only the HTTPS URI needs
> to be registered.
>
> **Users:** students and families. Usage is a few dozen Responses calls per list (one planner call,
> then about 5 research calls with web search, plus chat).

**Ask OpenAI to confirm:**
1. That a public, browser-based or native client with **no backend** may use plan usage
   (`chatgpt.tokens.use.direct`). Their *website* guide describes a server-side code exchange for
   identity-only sign-in. Plan usage is documented mainly for local tools.
2. Whether `https://auth.openai.com/api/accounts/oauth/token` allows **CORS** from
   `https://vikasgaddu1.github.io`. If not, you need the relay in §4 for the web build.
3. Whether they want `http://127.0.0.1:5173/...` rather than `localhost` for development. Their
   loopback guidance says "do not substitute `localhost`". The app uses whatever origin it is served
   from, so you can run `npx vite --host 127.0.0.1` and register that URI instead.
4. That `revocation_endpoint` and `earliest_refresh_at` behave as described (see §7).
5. Any per-app usage limit they apply. The UI shows a "Manage usage" link either way.

## 2. Configure the build

The client ID is **public**, not a secret. It is still kept out of the repo so forks don't reuse it.

| Where | Name | Value |
|---|---|---|
| GitHub → Settings → Secrets and variables → Actions | `VITE_CC_CHATGPT_CLIENT_ID` | the client ID OpenAI issues |
| same | `VITE_CC_TOKEN_RELAY` | *(optional)* your relay URL, see §4 |
| local dev: `college-compass-app/.env.local` | `VITE_CC_CHATGPT_CLIENT_ID=…` (+ `VITE_CC_TOKEN_RELAY=…`) | |

`.github/workflows/deploy.yml` passes both secrets to the **Build app** step. Push to `main` (or run
the workflow by hand) to redeploy. The iOS build reads the same variables at `npm run build`
(`BUILD_TARGET=ios`), so set them in the iOS CI job too.

Until the client ID exists, `auth.configured()` returns `false` **on the web build**. The web app then
shows its "not configured" state, and the developer key mode (§6) still works for demos. The native
iOS app is unaffected: with no client ID it uses the self-serve path (§0) and `configured()` is `true`.

## 3. How partner sign-in works

```
Web:    App → auth.openai.com/authorize ──redirect──▶ /app/callback.html?code&state
                                                        └─ location.replace("./#/auth/callback?code&state")
                                                           └─ UI calls auth.completeSignIn(query)
iOS:    App → SFSafariViewController(authorize) ──▶ /app/callback.html?code&state=….n
                                                        └─ location.replace("collegecompass://auth/callback?…")
                                                           └─ appUrlOpen → auth completes, closes browser
```

- `state` ends with `.n` when sign-in started in the native app. That suffix is how
  `callback.html` knows to hand off to the app. The page also shows an **Open College Compass**
  button in case Safari asks before opening the app.
- The pending attempt (`state`, `nonce`, PKCE verifier, return route, timestamp) is stored in
  `localStorage` under `cc2:oauth_pending`, because session storage doesn't survive the
  SFSafariViewController hand-off. It is single-use and expires after 10 minutes.
- Code exchange: `POST https://auth.openai.com/api/accounts/oauth/token` with
  `grant_type=authorization_code, client_id, code, code_verifier, redirect_uri, resource`. On web it
  goes through `fetch`. On iOS it goes through CapacitorHttp, which has no CORS limits.
- The ID token is checked for `iss`, `aud`, `exp`, `iat` and `nonce`, plus an **RS256 signature**
  against `https://auth.openai.com/.well-known/jwks.json` using Web Crypto. If the JWKS can't be
  fetched (for example because of CORS), only the claims are checked and a console warning is logged.
  The raw ID token is **not** stored, only `sub`, `name`, `email` and `picture`.
- **Plan usage** is on only if the granted scope includes `chatgpt.tokens.use.direct`. If the user
  declined it, the app explains and offers to sign in again.
- Tokens are stored in `localStorage` as `cc2:chatgpt`
  (`{access_token, refresh_token, expires_at, scope, claims}`). The access token lasts about 1 hour and
  is refreshed about 2 minutes before expiry. Refresh sends `grant_type=refresh_token, client_id,
  refresh_token, resource` and omits `scope`, so the original grant is kept. The rotated refresh token
  is saved in a single write. Refreshes are **single-flight** (with a cross-tab lock where the browser
  supports it), so parallel research agents never race the rotating token. If a refresh fails with
  `invalid_grant` or a similar code, the tokens are cleared and the user is asked to sign in again.
  Temporary failures keep the session.
- Sign-out clears the tokens and best-effort revokes the refresh token through the discovery
  document's `revocation_endpoint`. Users can also disconnect the app in ChatGPT settings.

## 4. Do I need the token relay? (web build only)

**How to tell:** on the web build, sign in and watch DevTools → Console. If you see
`blocked by CORS policy … auth.openai.com/api/accounts/oauth/token`, the app shows *"this browser may
be blocking the request (CORS), so the web build needs a token relay"*.

**Fix:** deploy `college-compass-app/relay/`. It is a stateless Cloudflare Worker (free tier is
plenty) that forwards **only** `authorization_code` and `refresh_token` POSTs to the token endpoint,
allows only your origin, and stores and logs nothing.

```bash
cd college-compass-app/relay
npx wrangler@3 login
npx wrangler@3 deploy          # ALLOWED_ORIGIN defaults to https://vikasgaddu1.github.io
```

Set the printed `https://college-compass-token-relay.<you>.workers.dev` URL as the
`VITE_CC_TOKEN_RELAY` secret and redeploy. The app always tries OpenAI directly first and falls back
to the relay only when the browser blocks the request. The iOS app never uses the relay. Tokens pass
through the Worker in transit only. See `relay/README.md`.

## 5. Privacy model

- **No database, no accounts of our own.** The profile, research results, shortlist, notes, tokens and
  cache live only on the device under `cc2:` keys. The Settings screen can export, import and delete
  everything.
- **Prompts carry minimal student data:** stats, interests, budget band, state and preferences. They
  never include a name, email or other identifier.
- Requests go from the device to `api.openai.com` under the **student's own** ChatGPT account, with
  `store:false`. The developer (you) receives nothing.
- App Store privacy label: "Data Not Collected" by the developer. Data is sent to OpenAI by the user's
  choice, under their account.
- **Exports:** the frontend should leave `chatgpt`, `oauth_pending` and `dev_openai_key` out of the
  Settings export file. Tokens shouldn't travel in backups.

## 6. Developer API-key demo mode

Use this on the web build before OpenAI issues the client ID. Go to Settings → Developer
(hidden) and paste an OpenAI API key. It is stored only on that device (`cc2:dev_openai_key`). Requests
use the same shape, billed to **that key**, with model `gpt-5` by default (override with
`cc2:dev_openai_model`). The ChatGPT session always wins when it has plan usage. **Never ship a key in
the build.**

## 7. Limits and known uncertainties

- **Usage limits:** `subscription_sharing_usage_limit_exceeded` (429) and
  `subscription_sharing_usage_unavailable` (503, retried with backoff first) show "Usage limit
  reached" plus **Manage usage** (<https://chatgpt.com/settings/usage>). The app never silently
  switches to another billing path.
- **Tool shape:** OpenAI's preview-limitations page says function tools should be "grouped in
  namespaces or supplied through `additional_tools` input items" for plan usage. The client sends
  them in a `{type:"namespace"}` tool by default and forces the tool with `tool_choice:"required"`,
  because forcing a namespaced function by name is undocumented. If the route rejects that shape with
  `subscription_sharing_unsupported_capability`, the client automatically switches to flat function
  tools, retries, and remembers the choice on that device for 7 days. Rejected `web_search`,
  `reasoning` and forced `tool_choice` are handled the same way.
- **`web_search`** is "subject to model and account/workspace policy". If it's rejected, research
  continues without it, with lower data confidence. The researcher prompt makes the model say so in
  its notes.
- **`earliest_refresh_at`** appears in token responses, but its format isn't documented. The app
  accepts Unix seconds, milliseconds or ISO 8601, and doesn't refresh before that time unless the
  token is about to expire.
- **Self-serve path details:** the redirect parameter name for the issued ID (`client_id`) and the
  `invalid_client` / `unauthorized_client` re-registration rule are implemented from OpenAI's docs as
  of Oct 2026 and unit-tested with mocks. Verify both on a physical iPhone before submitting.
- **Token storage:** OpenAI's guidance prefers keeping tokens out of browser storage. With no backend
  there is no alternative on the web. On iOS, a Keychain or Preferences adapter would be stronger; that
  is a planned follow-up.
- **Research accuracy:** the AI can be wrong. Every college shows its data year, sources, confidence
  and notes, and the prompts forbid inventing figures (null plus a note instead).

## 8. End-to-end test (no OpenAI access needed)

`npm run e2e` builds the production web bundle with a test client ID, serves it with `vite preview`
and runs `e2e/full-flow.py` (Python Playwright, Chromium, iPhone 13 viewport). It mocks the authorize,
token and JWKS endpoints and `/v1/models` + `/v1/responses` at the network layer in the formats above
(302 redirect with code + state, PKCE S256 check, an RS256 ID token signed with a per-run key, SSE
function-call and text streams), then drives sign-in → all onboarding questions → planner → parallel
research agents (≤ 3 colleges per call, ≤ 4 in flight, overlap measured) → list → detail → Ask →
reload. Sign-in runs with the service worker already in control, which guards the redirect page
(`callback.html`) against being replaced by the cached app shell. Details: `e2e/README.md`.

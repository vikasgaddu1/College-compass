# College Compass App — build spec (v2)

A general-purpose, **iPhone-first** college-search app for **any interest** (the student picks their own majors/interests — nothing is robotics-specific), shipped to the **Apple App Store** as a native iOS app (Capacitor) and also as a web/PWA build. A high-school student signs in with their **ChatGPT account** (required — AI is the product), answers a short set of questions, and the app **researches colleges with parallel AI agents** (2–3 colleges per agent call, several calls in flight), then **ranks** them and gives honest **admission-odds bands** computed on-device from the researched Common Data Set figures plus documented heuristics.

- **No database, no accounts of our own.** Profile, research results, shortlist, notes and ChatGPT tokens live only in the browser (localStorage, `cc2:` keys). Export/import/delete in Settings.
- The existing personal dashboard (`college-dashboard/`) stays at `/College-compass/`. This app lives in `college-compass-app/` and deploys to **`https://vikasgaddu1.github.io/College-compass/app/`**.

## Folder layout (owners — do not edit another owner's files)

```
college-compass-app/
  SPEC.md, src/types.ts                  [lead]      shared contracts (read-only for others)
  package.json, configs, index.html, public/manifest|icons|sw.js,
  src/main.tsx, src/styles/base.css, src/lib/storage.ts, src/lib/router.ts   [scaffold — done]
  src/engine/**                          [engine]    pure TS: odds, price, fit, ranking, balanced list (+tests)
  src/ai/**, public/callback.html, relay/**, docs/CHATGPT_SIGNIN.md          [ai]
  src/app/**, src/components/**, src/screens/**, src/state/**, src/styles/app.css  [frontend]
```

## Native iOS / App Store (packaging)
- Capacitor 6 wraps the same React build: `ios/` Xcode project (bundle id `com.gaddu.collegecompass`, display name "College Compass"), app icons + launch screen, `NSAppTransportSecurity` defaults, portrait + iPad support, status-bar/safe-area handled by CSS.
- Platform detection via `Capacitor.isNativePlatform()`. In the native app the Vite `base` is `./` (web build keeps `/College-compass/app/`) — controlled by `BUILD_TARGET=ios`.
- ChatGPT sign-in in the native app: open the authorize URL with `@capacitor/browser` (SFSafariViewController); the registered HTTPS redirect `https://vikasgaddu1.github.io/College-compass/app/callback.html` detects a `.n` suffix on `state` and forwards to the custom scheme `collegecompass://auth/callback?...`; the app listens with `@capacitor/app` `appUrlOpen`, closes the browser and completes sign-in. Token exchange/refresh and every api.openai.com request in native use `CapacitorHttp` via `platform.httpFetch` (api.openai.com rejects CORS for authenticated calls; SSE bodies are buffered then parsed). Tokens are stored in localStorage on both platforms (a Keychain/Preferences adapter is a possible follow-up); credentials are excluded from export/import files.
- CI: GitHub Actions `macos-latest` workflow builds the web app, `npx cap sync ios`, and `xcodebuild` for the simulator on every push (compile check). A TestFlight job (fastlane) runs only when App Store secrets exist (APP_STORE_CONNECT_API_KEY_ID / ISSUER_ID / KEY_P8, signing via fastlane match or manual certs).
- App Store readiness: privacy policy + support pages (static, in `public/`), Privacy Nutrition Label notes (no data collected by developer; data stays on device; requests go to OpenAI under the user's account), age rating notes, App Review notes (demo instructions; ChatGPT account required — reviewer test path), Sign in with Apple not required (no first-party account; guideline 4.8 exception for third-party service clients) — documented in `docs/APP_STORE.md`.

## Stack
Vite 5 + React 18 + TS strict + Tailwind 3, hand-built components, vitest, a Playwright end-to-end test of the production build with OpenAI mocked (`npm run e2e`, see `e2e/README.md`), hash routing (`src/lib/router.ts`), PWA. `App` is a **named export** from `src/app/App.tsx`. `npm run build` type-checks all of `src/**`.

## Sign in with ChatGPT (no database)

Two modes:
- **iOS app — self-serve open-source path (works today, no OpenAI approval):** `client_id=dynamic_agent_client` + `agent_name_hint=College Compass` + a per-device `ext_agent_host_id` (urn:uuid) on first sign-in; OpenAI returns the issued `client_id` (oaiapp_…) with the code, which the app saves and reuses. Redirect is an HTTP loopback `http://127.0.0.1:<port>/auth/callback` served by the in-app `LoopbackAuth` Capacitor plugin (NWListener bound to 127.0.0.1, port 1455 preferred). Verified: OpenAI's authorize page accepts these parameters ("Use ChatGPT to sign in to College Compass"); CI launches the app in the iOS Simulator and checks the callback listener. ChatGPT Plus/Pro is required for plan usage.
- **Web/PWA — partner path:** needs a client ID from OpenAI's interest form (below).

### Partner path details
- OIDC Authorization Code + PKCE (S256) + state + nonce, generated in the browser (Web Crypto), kept in `localStorage` (`cc2:oauth_pending`, 10-minute expiry) until the callback — sessionStorage does not survive the hand-off back from SFSafariViewController.
- Endpoints: authorize `https://auth.openai.com/api/accounts/authorize`, token `https://auth.openai.com/api/accounts/oauth/token`, JWKS `https://auth.openai.com/.well-known/jwks.json`, issuer `https://auth.openai.com`.
- Scopes: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`.
- Client ID from build env `VITE_CC_CHATGPT_CLIENT_ID` (issued by OpenAI's Sign in with ChatGPT program; public client, no secret). Redirect URI: `https://vikasgaddu1.github.io/College-compass/app/callback.html` (static page that forwards the query to `#/auth/callback`).
- Token exchange + refresh from the browser. If OpenAI's token endpoint doesn't allow browser CORS, use the optional **stateless relay** (`relay/` — a ~60-line Cloudflare Worker that forwards only token requests and stores nothing) configured by `VITE_CC_TOKEN_RELAY`.
- Tokens (access ~1h, rotating refresh) stored on device; refresh automatically before expiry; sign-out clears them.
- Inference: `POST https://api.openai.com/v1/responses` with `Authorization: Bearer <access>`; **always `store:false`, `stream:true`**; system guidance via `instructions`; never send temperature, max_output_tokens, metadata, user, previous_response_id, etc. Supported tools: **function tools** (used for structured research output) and **web_search** (subject to account policy — retry without it if rejected). Success only on `response.completed`; handle `response.failed`/`response.incomplete`; usage-limit codes `subscription_sharing_usage_limit_exceeded` / `subscription_sharing_usage_unavailable` → friendly "Manage usage" message.
- Models: `GET https://api.openai.com/v1/models` → `models[]` with `visibility=="list"`; show `display_name`, send `slug`. Default to the first listed.
- UI copy per OpenAI guidelines: button "Continue with ChatGPT"; first sign-in sheet "You're using your ChatGPT plan" + Got it; "Manage usage" link.
- Developer-only fallback (Settings → Developer, hidden by default): OpenAI API key on device, same request shape — so the app can be demoed before OpenAI issues the client ID.

## Core flow
1. **Welcome** → "Continue with ChatGPT" (required to research). Explains: free to use with your ChatGPT plan, data stays on your phone.
2. **Questions** (one per screen): home state · grad year · GPA (UW, optional W) · SAT/ACT/none · course rigor · activities level · intended majors/interests (1–3 from a broad list covering all fields — STEM, business, health, humanities, arts, education, undecided) + optional free-text interests · budget/year + income band · regions · size · setting · public/private · plan willingness (ED ok / EA only / RD only) · first-gen · priorities · **colleges you already like (optional, free text chips)**.
3. **Research** screen: live progress — planner picks ~15 candidates if the student named none (or tops up a short list), then parallel agents research 2–3 colleges each (default 3 per call, 4 calls in flight). Cards appear as each college finishes; failures can be retried; cancel any time. Results cached locally.
4. **Your list** — balanced list (high reach / reach / target / likely / safety) with odds band, fit, est. net price, reasons, data-confidence badge. Sort/filter, add a college (triggers research of that one), save to shortlist.
5. **College detail** — your numbers vs theirs, odds band + factor breakdown, plans & deadlines, programs for your majors, cost/net price & scholarships, outcomes, sources (tappable), data notes, "Refresh research".
6. **Ask** — chat with ChatGPT about your list (profile + list summary as context).
7. **Settings** — account (ChatGPT, model picker, sign out), edit answers, re-run research, export/import, delete everything, methodology & honesty notes.

## Research agents (ai)
- **Planner** (only when needed): function tool `propose_colleges` → `CollegeCandidate[]` balanced across reach/target/likely for the profile, honoring region/size/setting/budget/major; uses web_search when available.
- **Researcher** (per batch of 2–3 names, parallel): function tool `submit_college_research` with a strict JSON schema mirroring `College` (admit rate, ED/EA/RD rates, in/out-state rates, SAT/ACT 25–75, avg GPA, test policy, COA, net price by income, tuition in/out, grad/retention, earnings, program shares estimate for the student's majors, programs[], application plans + Fall-entry deadlines, gated majors, scholarships, sources[], data_year, data_confidence, data_notes). Prefer the latest Common Data Set and official pages; never invent — null + note when unknown.
- Concurrency limiter, per-batch retry (1 retry, then split the batch), abort support, validation/normalization of model output (clamp ranges, coerce numbers), cache by normalized name (30 days).

## Odds model (engine) — heuristic, on-device, shown as a band
Start from admit rate (log-odds). Adjust for test-score position vs 25th–75th, GPA vs school average/selectivity, rigor & activities (small), residency at publics (researched in/out rates when present, else ±0.35), ED only when the college offers ED and the student is willing (researched ED vs RD rates, capped), gated-major penalty, small first-gen bump at selective schools. Clamp 1–95%; admit rate < 15% → cap at 2.5× admit rate and tier high reach. Band width by data confidence. Tiers: safety ≥85%, likely 65–85, target 35–65, reach 15–35, high reach <15.

## Fit score (engine)
Weighted by priorities: academics (program offered/strength for majors), affordability (net price for the student's band; out-of-state public adjustment; vs budget), outcomes (grad rate, earnings), location (region/size/setting/ownership), odds.

## iPhone requirements (non-negotiable)
375–430 px first. `viewport-fit=cover` + safe-area insets, `100dvh`, bottom tab bar, no horizontal scroll, no tables on mobile, tap targets ≥44 px, inputs ≥16 px, sheets for filters, sticky primary actions above the home indicator, light/dark, reduced motion, standalone PWA.

## Honesty rules
Odds are estimates, not predictions — always bands + "why". Show data year, sources and confidence for every college. Never claim ED/EA, a major or a scholarship unless the research found it.

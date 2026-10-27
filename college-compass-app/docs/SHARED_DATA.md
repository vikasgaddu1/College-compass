# Shared college data (Supabase)

Tierwise keeps **college facts** in one shared Supabase database so every student benefits from data loaded or researched once. **No student or user data is ever stored there**: no profiles, answers, searches, names, devices or ChatGPT tokens.

Project: `college-compass` (Gaddu LLC) — `https://nspbxlnocelknibrajkv.supabase.co`, East US (Ohio).

## What's in it

| Table | Contents | Written by | App can read |
|---|---|---|---|
| `colleges` | ~2,000 operating, predominantly bachelor's, public/private nonprofit institutions: name, aliases, location, type, size | Scorecard job | yes |
| `college_stats` | federal College Scorecard figures: admit rate, SAT/ACT ranges, tuition, cost of attendance, net price by family income, graduation/retention, earnings, degrees by field | Scorecard job (monthly) | yes |
| `college_research` | AI-researched facts for an admissions cycle (plans, deadlines, test policy, CDS extras, scholarships) | `contribute_research()` consensus | published rows only |
| `college_programs` | AI-researched program notes per college × major area | `contribute_research()` consensus | published rows only |
| `contributions` | raw research held in quarantine | `contribute_research()` | **no** |

Row Level Security: the app's publishable key can only `select`, and only published research. Writes come from the service key in CI, the `contribute_research()` function, and the App Attest Edge Function (see "Security: Apple App Attest"). `match_colleges(names, states)` finds the best match per name (trigram similarity + aliases, optional state).

## How the app uses it (`src/data/shared.ts`)

One lookup per research run for the colleges being researched. When research finishes a college, federal figures **fill only what research left empty** (most often net price by income, earnings, size), are cited as a source ("College Scorecard — U.S. Department of Education"), and are noted in the college's data notes. Researched values always win (they're newer and specific to the cycle). If a researched admit rate differs from federal data by more than 15 points, the app adds a visible note. If Supabase is unreachable, research continues as before.

Turn it off for a build with `VITE_CC_SHARED_DATA=off` (the mocked e2e build does). Override the project with `VITE_CC_SUPABASE_URL` / `VITE_CC_SUPABASE_KEY`.

## Jobs (`.github/workflows/supabase.yml`)

- **migrate** — `supabase db push` of `supabase/migrations/` on pushes to `main` that touch them, monthly, or manually.
- **functions** — deploys the `attest` Edge Function (App Attest verifier) after migrating; separate job, so a failed deploy never blocks migrations.
- **scorecard** — `scripts/scorecard-load.mjs`: fetches the College Scorecard API (operating, predominant degree = bachelor's, public/private nonprofit), maps and upserts. The run summary lists how many rows had each field, so a renamed Scorecard field shows as "0" instead of silently loading nulls; the job fails if key fields are entirely empty. Manual runs can be a dry run.

Secrets: `SUPABASE_ACCESS_TOKEN` (Supabase account token; the job looks up the service key through the Management API and never prints it), `SUPABASE_DB_PASSWORD`, `SCORECARD_API_KEY` (api.data.gov; optional — without it the job uses the public `DEMO_KEY`, 30 requests/hour, enough for one load). Optional variable `SUPABASE_PROJECT_REF` (defaults to the project above).

## Shared research (the flywheel)

`supabase/migrations/20261020010000_contributions.sql`. Every researched college makes the database richer; later students get it instantly with no ChatGPT usage.

**Reading.** The lookup also returns *published* research for the student's cycle and program notes per major. A college whose research for the cycle **and** program notes for every one of the student's majors are published and fresh is built from the shared record (normalized exactly like fresh research, then gap-filled from federal data) and is **not researched**. Its data notes say "Shared research verified by N students' independent results".

**Contributing.** After researching a college, the app calls `contribute_research(payload)` with whitelisted college facts and program notes (`contributionPayload` in `src/data/shared.ts`) — never data notes, CDS free-text notes, the profile, answers or anything identifying — plus a random per-install ID and the cycle. Settings → "Share research to help other students" (on by default) turns it off.

**In the database** (`security definer` function, the only write path apps have):
1. Size/shape checks; cycle must look like `Fall 20xx`.
2. Rate limit: 120 contributions per network address per hour (address stored only as a salted SHA-256, rows deleted after two days).
3. Match the name (+ state) to a federal college; unknown colleges are rejected.
4. Whitelist and range-check every field; drop URLs that aren't http(s); drop figures far from federal data (admit rate > 15 points off, SAT > 150 off, tuition outside 0.6–1.7×).
5. Store in `contributions` (apps can never read it). The install ID is stored only as a salted hash.
6. **Consensus:** publish to `college_research` when contributions from **≥ 2 different installs** in the last 180 days agree (≥ 2 comparable facts among admit rate ±2 points, test policy, SAT range ±30, application plan set and their deadlines; no conflicts). Program notes publish when 2 installs agree on whether the program is offered. Publishing **merges** into the existing record — a later contribution can update values but can never erase a published field.
7. Research stays fresh for 6 months, program notes for 18 months; after that the next student who needs it researches again and the cycle repeats.

Tested locally against Postgres 16: single-install repeats stay pending; disagreeing deadlines don't count; two agreeing installs publish (`verified_count=2`); student notes and `javascript:` URLs are dropped; a tampered admit rate is dropped and can't erase the published one; unknown colleges/bad cycles are rejected; the app role can't read contributions or the private schema; the hourly limit applies.

A reviewer-model pass to break ties is planned with the adversarial-review feature.

## Security: Apple App Attest (genuine-app check)

The weak spot of the flywheel was that anyone could call `contribute_research` with made-up install IDs and pose as "two independent students". **Apple App Attest** closes it: the iPhone app proves each contribution comes from the genuine, unmodified Tierwise app (App ID `C544LPNJ2S.com.gaddu.collegecompass`) on a real Apple device, and that the payload wasn't altered.

**Pieces.** `ios/App/App/AppAttestPlugin.swift` (`DCAppAttestService`; key in the Secure Enclave, identifier in UserDefaults) · `src/data/attest.ts` (client protocol; wired into `createSharedLookup().contribute`) · `supabase/functions/attest/` (Edge Function: `handler.ts`, verifier in `appattest/` — CBOR, DER/X.509, ECDSA P-256/P-384, no dependencies, Apple's App Attestation Root CA pinned) · `supabase/migrations/20261021010000_app_attest.sql` (tables + service-role-only functions).

**Protocol** (one endpoint, `POST {SUPABASE_URL}/functions/v1/attest`):

| Step | App | Server |
|---|---|---|
| once per install (at most one try a day) | `{op:"challenge", purpose:"attest"}` | random 32-byte challenge, stored hashed, single use, 5 minutes; ≤ 600 per network address per hour |
| | `attestKey(challenge)` → Apple attests a new key over `SHA256(challenge)`; `{op:"register", key_id, attestation, challenge}` | verifies the attestation (below), consumes the challenge, stores the key's public key with counter 0 |
| every contribution | `{op:"challenge", purpose:"assert"}`, then `client_data = {"v":1,"op":"contribute","challenge":…,"payload":<contribution>}` (sent verbatim) and `generateAssertion(SHA256(client_data))`; `{op:"contribute", key_id, client_data, assertion}` | verifies the assertion, then `contribute_research_attested(payload, key_id, counter, challenge)` |

**What is verified where.**
- *Edge Function* (Apple's documented steps): CBOR `apple-appattest` format; `x5c` credential certificate → intermediate → **pinned Apple App Attestation Root CA** (signatures, validity dates, CA flags, no unknown critical extensions); nonce `SHA256(authData ‖ clientDataHash)` equals the octet string in extension `1.2.840.113635.100.8.2`; `SHA256(public key)` = key ID = credentialId; `rpIdHash = SHA256("C544LPNJ2S.com.gaddu.collegecompass")`; counter 0; aaguid `appattest` (production) or `appattestdevelop` (sandbox); the COSE key matches the certificate; newer `apple_validation_category_01` / `apple_bundle_version_01` extensions are recorded (categories 0 and 7–9 refused). Assertions: ECDSA P-256 signature over `SHA256(authenticatorData ‖ SHA256(client_data))` with the stored key, rpIdHash, counter > stored counter, and `client_data` must carry a challenge plus the payload — the payload stored is exactly the one signed.
- *Database* (atomically, in `contribute_research_attested`): the challenge exists, is unused, unexpired and was issued for an assertion (then marked used); the key exists, isn't revoked, and its counter strictly increases (`update … where counter < new`); 120 contributions per key per hour; then the same shape checks, matching, sanitizing, federal plausibility checks and consensus as the anonymous path. Development keys are refused unless `attest_allow_development` is on. The contribution rows get `attested = true` and `attest_key_hash` (salted hash of the key ID).
- *App*: everything is best-effort and time-boxed (20 s per contribution, fire-and-forget, one at a time so counters arrive in order). Unsupported device, Simulator, web build, offline, Apple or server error → the contribution goes through the old anonymous `contribute_research` instead. A key the server doesn't know (or revoked) is dropped and re-attested; `DCError.invalidKey` (reinstall, restore, offloaded update) drops the key too. Research never waits for any of this. `VITE_CC_APP_ATTEST=off` turns the attested path off for a build.

**Monitor mode (shipped) vs enforce mode.** `cc_private.settings.require_attest` is **false** by default: the anonymous RPC works exactly as before, consensus still counts distinct installs, and every contribution records whether it was attested. Watch adoption in the SQL editor:

```sql
select date_trunc('day', created_at) as day, attested, count(*) from public.contributions
 where created_at > now() - interval '14 days' group by 1, 2 order by 1, 2;
select environment, count(*), max(last_used_at) from cc_private.app_attest_keys group by 1;
```

When nearly all recent contributions are attested (i.e. most students run an App Attest build; the web app can't attest), flip to **enforce mode**:

```sql
update cc_private.settings set require_attest = true;   -- back: = false
```

Then the anonymous RPC answers `attestation_required`, and consensus counts **distinct attested keys** (and distinct installs) among attested contributions only — older unattested contributions no longer count toward publishing. Other switches: `update cc_private.settings set attest_allow_development = true;` accepts keys from Xcode-built apps (sandbox environment; off by default), `update cc_private.app_attest_keys set revoked = true where key_id = '…';` stops one key.

**Limits.** App Attest proves "genuine app on a genuine device", not "different person": one device can get a new key by reinstalling. Consensus still needs agreeing results from two keys and two installs, plausibility checks still apply, and per-key and per-address limits stay. The stored receipt allows Apple's fraud metric (keys per device) later if needed. Apple throttles `attestKey` for very large simultaneous rollouts (guidance: < 100/s); the app attests once per install and retries at most daily.

**Privacy.** The key is created on the device for this app only; its ID is a hash of a public key and says nothing about the student or the device (Apple's App Attest returns no device identifier). The server stores the public key, counter and receipt, and contributions only a salted hash of the key ID. No App Store privacy-label change (see `docs/APP_STORE.md` §7).

**Deploy.** `.github/workflows/supabase.yml` job **functions** runs after **migrate**: `supabase functions deploy attest --no-verify-jwt` (the app sends the publishable key, which isn't a JWT; `verify_jwt = false` is also in `supabase/config.toml`). A failed deploy can't affect migrations; the app falls back while the function is missing. The function uses the project's `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (provided by Supabase); if legacy JWT keys are disabled on the project, set the function secret `CC_SERVICE_KEY` to a secret key (`supabase secrets set CC_SERVICE_KEY=… --project-ref …`).

**Tests.** `src/attest/appattest.test.ts` runs the verifier against Apple's documented sample attestation (developer.apple.com "Attestation Object Validation Guide"), two real device attestations and a real assertion (MIT-licensed vectors from node-app-attest), plus a synthetic Apple-like chain with an injected root to trip every check, and cross-checks the ECDSA code against WebCrypto. `src/attest/handler.test.ts` covers the Edge Function; `src/data/attest.test.ts` the app flow end-to-end with real crypto. The migration was exercised on Postgres 16 (monitor-mode regression, single-use challenges, replayed counters, unknown/revoked keys, development keys, enforce-mode consensus, and that `anon` can execute none of the attest functions).

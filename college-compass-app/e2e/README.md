# End-to-end test (`npm run e2e`)

`full-flow.py` drives the **real production web build** through the whole product in Chromium on an
iPhone 13 viewport (light mode), with OpenAI mocked at the network layer. No OpenAI account, client
ID or network access is needed.

```bash
cd college-compass-app
npm run e2e                      # build → vite preview :4173 → full-flow.py → stop the server
E2E_OUT=/tmp/cc-shots npm run e2e  # choose where screenshots go (default e2e/screenshots/, gitignored)
```

`run.sh` builds with `VITE_CC_CHATGPT_CLIENT_ID=oaiapp_e2e_test npm run build`, starts
`npx vite preview --port 4173 --strictPort`, runs the script and stops the server on exit. To run the
script against a server you started yourself: `python3 e2e/full-flow.py` (set `E2E_BASE_URL` if it
isn't `http://localhost:4173/College-compass/app/`).

Requirements: Python 3.10+, `playwright` (Python) with its Chromium already installed, `cryptography`,
and optionally `jsonschema` (used to check the mock's tool arguments against the app's own strict
schemas). Install missing packages with `pip install --break-system-packages cryptography jsonschema`.

## What it does

1. **Sign in.** Welcome → "Continue with ChatGPT" with the service worker already in control
   (a returning visitor) → mocked `authorize` → `callback.html` → `#/auth/callback` → token exchange →
   ID-token verification → "You're using your ChatGPT plan" sheet → Got it.
2. **Onboarding.** Answers all 17 questions through the UI (state picker → NC, class of 2027, GPA 3.8 /
   4.35, SAT 1420, rigor, activities, Nursing + Public health, "pediatrics", $30k budget + $75k–$110k
   income, South/Mid-Atlantic, large, suburb, either, EA only, not first-gen, priority sliders via
   keyboard, "University of North Carolina at Chapel Hill") and checks the saved profile.
3. **Research.** Planner (1 call) → 13 colleges → research agents in batches of 3 with 4 in flight;
   each research response is held for `E2E_RESEARCH_DELAY` (1.5 s) so overlap is measurable.
4. **List.** Tier sections, an odds band (`NN–NN%`) on every card, the student's own pick present.
5. **Detail.** "You vs. them", the odds-factor breakdown, plans & deadlines, the nursing program.
6. **Ask.** Sends a question; the streamed mock reply renders.
7. **Reload.** List and chat persist (localStorage), the plan sheet doesn't reappear, Settings shows
   the signed-in account, and `/` sends the user straight to the list.

It fails on any page error, on any request to a host other than the preview server,
`auth.openai.com` and `api.openai.com` (or to an unmocked OpenAI path), and on any mock assertion.

## The mocks (wire formats the app implements)

| Endpoint | Mock behaviour and checks |
|---|---|
| `GET auth.openai.com/api/accounts/authorize` | Checks `response_type=code`, `client_id`, all six scopes (incl. `chatgpt.tokens.use.direct`), `resource=https://api.openai.com/v1`, `code_challenge_method=S256`, `redirect_uri`, state/nonce; replies **302** to `redirect_uri?code=e2e-code&state=…`. |
| `POST auth.openai.com/api/accounts/oauth/token` | Form body: `grant_type=authorization_code`, the code, `redirect_uri`, `client_id`, and `base64url(SHA-256(code_verifier)) == code_challenge`; exchanged exactly once. Returns access/refresh tokens, `expires_in: 3600`, the granted scope and an **RS256 `id_token` signed with an RSA key generated for the run** (iss, aud = client ID, sub, email, name, nonce, iat, exp, kid). |
| `GET auth.openai.com/.well-known/jwks.json` | The matching public JWK. The test asserts the app stored `signature_verified: true` and did not store the raw ID token. |
| `GET api.openai.com/v1/models` | `{models:[{slug:"gpt-e2e", visibility:"list"}, …hidden]}`; Bearer token checked. |
| `POST api.openai.com/v1/responses` | Bearer token, `store:false`, `stream:true`, model `gpt-e2e`, no `temperature` / `max_output_tokens` / `metadata` / `user` / `previous_response_id` / `truncation`. Function tools must arrive in the `college_compass` namespace with `tool_choice:"required"`. **Planner** (`propose_colleges`) → 12 candidates. **Researcher** (`submit_college_research`) → parses the numbered college names from the input (≤ 3 per call) and returns schema-valid records from a fixture table of 14 colleges. **Chat** (no tools) → `output_text` deltas; the instructions must contain the list summary. |

Streams use the event sequence `src/ai/sse.ts` parses: `response.created`, `response.in_progress`,
`response.output_item.added` (function call with `arguments: ""`), `response.function_call_arguments.delta`
(chunked), `response.function_call_arguments.done`, `response.output_item.done`, `response.completed`
(with the final `output`); chat adds `content_part` / `output_text.delta` / `output_text.done` events.
All mocked responses carry `access-control-allow-origin: *`; `OPTIONS` preflights get a 204 if the
browser surfaces them (Chromium under Playwright interception answers preflights itself, so the
report usually shows 0).

The fixture figures are approximate and exist only to exercise the app; they are not research data.

## Output

The script prints a timing table for the research calls (start/end relative to the first call,
colleges per call, peak in flight) and the screenshot paths, then `RESULT: PASS` or `RESULT: FAIL`
(exit code 0/1). A failure also saves `zz-failure.png`.

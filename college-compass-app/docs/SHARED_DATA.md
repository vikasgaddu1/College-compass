# Shared college data (Supabase)

College Compass keeps **college facts** in one shared Supabase database so every student benefits from data loaded or researched once. **No student or user data is ever stored there**: no profiles, answers, searches, names, devices or ChatGPT tokens.

Project: `college-compass` (Gaddu LLC) — `https://nspbxlnocelknibrajkv.supabase.co`, East US (Ohio).

## What's in it

| Table | Contents | Written by | App can read |
|---|---|---|---|
| `colleges` | ~2,000 operating, predominantly bachelor's, public/private nonprofit institutions: name, aliases, location, type, size | Scorecard job | yes |
| `college_stats` | federal College Scorecard figures: admit rate, SAT/ACT ranges, tuition, cost of attendance, net price by family income, graduation/retention, earnings, degrees by field | Scorecard job (monthly) | yes |
| `college_research` | AI-researched facts for an admissions cycle (plans, deadlines, test policy, CDS extras, scholarships) | `contribute_research()` consensus | published rows only |
| `college_programs` | AI-researched program notes per college × major area | `contribute_research()` consensus | published rows only |
| `contributions` | raw research held in quarantine | `contribute_research()` | **no** |

Row Level Security: the app's publishable key can only `select`, and only published research. All writes use the service key in CI. `match_colleges(names, states)` finds the best match per name (trigram similarity + aliases, optional state).

## How the app uses it (`src/data/shared.ts`)

One lookup per research run for the colleges being researched. When research finishes a college, federal figures **fill only what research left empty** (most often net price by income, earnings, size), are cited as a source ("College Scorecard — U.S. Department of Education"), and are noted in the college's data notes. Researched values always win (they're newer and specific to the cycle). If a researched admit rate differs from federal data by more than 15 points, the app adds a visible note. If Supabase is unreachable, research continues as before.

Turn it off for a build with `VITE_CC_SHARED_DATA=off` (the mocked e2e build does). Override the project with `VITE_CC_SUPABASE_URL` / `VITE_CC_SUPABASE_KEY`.

## Jobs (`.github/workflows/supabase.yml`)

- **migrate** — `supabase db push` of `supabase/migrations/` on pushes to `main` that touch them, monthly, or manually.
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

**Not yet:** Apple App Attest (proves a request comes from the genuine app) is the next hardening step; until then, abuse is limited by per-install consensus, the per-address limit and the federal plausibility checks. A reviewer-model pass to break ties is planned with the adversarial-review feature.

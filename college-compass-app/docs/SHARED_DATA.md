# Shared college data (Supabase)

College Compass keeps **college facts** in one shared Supabase database so every student benefits from data loaded or researched once. **No student or user data is ever stored there**: no profiles, answers, searches, names, devices or ChatGPT tokens.

Project: `college-compass` (Gaddu LLC) — `https://nspbxlnocelknibrajkv.supabase.co`, East US (Ohio).

## What's in it

| Table | Contents | Written by | App can read |
|---|---|---|---|
| `colleges` | ~2,000 operating, predominantly bachelor's, public/private nonprofit institutions: name, aliases, location, type, size | Scorecard job | yes |
| `college_stats` | federal College Scorecard figures: admit rate, SAT/ACT ranges, tuition, cost of attendance, net price by family income, graduation/retention, earnings, degrees by field | Scorecard job (monthly) | yes |
| `college_research` | AI-researched facts for an admissions cycle (plans, deadlines, test policy, CDS extras, scholarships) | later: validated contributions | published rows only |
| `college_programs` | AI-researched program notes per college × major area | later: validated contributions | published rows only |
| `contributions` | raw research held in quarantine | later: edge function | **no** |

Row Level Security: the app's publishable key can only `select`, and only published research. All writes use the service key in CI. `match_colleges(names, states)` finds the best match per name (trigram similarity + aliases, optional state).

## How the app uses it (`src/data/shared.ts`)

One lookup per research run for the colleges being researched. When research finishes a college, federal figures **fill only what research left empty** (most often net price by income, earnings, size), are cited as a source ("College Scorecard — U.S. Department of Education"), and are noted in the college's data notes. Researched values always win (they're newer and specific to the cycle). If a researched admit rate differs from federal data by more than 15 points, the app adds a visible note. If Supabase is unreachable, research continues as before.

Turn it off for a build with `VITE_CC_SHARED_DATA=off` (the mocked e2e build does). Override the project with `VITE_CC_SUPABASE_URL` / `VITE_CC_SUPABASE_KEY`.

## Jobs (`.github/workflows/supabase.yml`)

- **migrate** — `supabase db push` of `supabase/migrations/` on pushes to `main` that touch them, monthly, or manually.
- **scorecard** — `scripts/scorecard-load.mjs`: fetches the College Scorecard API (operating, predominant degree = bachelor's, public/private nonprofit), maps and upserts. The run summary lists how many rows had each field, so a renamed Scorecard field shows as "0" instead of silently loading nulls; the job fails if key fields are entirely empty. Manual runs can be a dry run.

Secrets: `SUPABASE_ACCESS_TOKEN` (Supabase account token; the job looks up the service key through the Management API and never prints it), `SUPABASE_DB_PASSWORD`, `SCORECARD_API_KEY` (api.data.gov). Optional variable `SUPABASE_PROJECT_REF` (defaults to the project above).

## Not yet (needs a decision)

Contributions from students' research (filling `college_research` / `college_programs` so later students don't spend ChatGPT usage) are **off**. Before enabling: confirm with OpenAI that research generated with a student's ChatGPT plan may be shared across users; add an opt-out in Settings and update the App Store privacy answers; accept writes only through an edge function with schema checks, the automatic data checks, Apple App Attest, and quarantine until a second independent result or a review pass agrees.

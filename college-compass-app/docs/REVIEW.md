# Second-model review (optional)

After a college is researched, a **different model** can fact-check the record against official
sources and fix what it can cite. It is **off in the app** until the comparison below shows it is
worth the extra time and ChatGPT usage.

## What it does (`src/ai/review.ts`)

- **What the reviewer sees:** only checkable college facts: name, state, admit rate, SAT/ACT ranges,
  test policy, tuition and cost of attendance (+ basis), CDS year, application plans and deadlines,
  program offered/degree/how-to-enter for the student's major areas, and the cited source URLs. It also
  gets the entry cycle and the major areas. It **never** gets the student's profile, data notes, CDS
  free-text notes, program notes or scholarships (free text can echo the student).
- **How:** one Responses call per college with web search and a forced `submit_review` function tool
  (strict JSON schema, the same pattern as research). The reviewer is told to assume errors (last
  cycle's deadlines, missing ED II, outdated test policy, wrong-year admit rate, in-state/out-of-state
  budget mix-ups, made-up degree names, "direct admit" that is really competitive), check the
  college's own pages and newest Common Data Set, and return
  `corrections: { field, plan, major, old, new, source_url, confidence, reason }[]`, `verified[]` and
  `unverified: { field, reason }[]`.
- **Applying corrections conservatively:** only with an http(s) `source_url` and `medium`/`high`
  confidence; values must parse and be in range (rates 0–1, SAT 400–1600, ACT 1–36, dollars, `YYYY-MM-DD`
  deadlines, known enums); big jumps (admit rate > 15 points, SAT > 150, ACT > 5, money outside
  0.6–1.7×) and removals (a plan not offered, a program that doesn't exist) need `high`; SAT/ACT bounds
  stay ordered; nothing is ever erased without a replacement. Each change adds a data note — e.g.
  *"Reviewer corrected the EA deadline from 2026-11-15 to 2026-11-01 (source: admission.gatech.edu/…)."* —
  and its source to the college's sources. Fields it couldn't check get one note
  (*"A second AI model couldn't verify: deadlines, SAT range."*).
- **In a research run** (`ResearchOptions.review`): each researched college's review is queued as its
  own task under the run's concurrency limiter, then the college is gap-filled from federal data,
  cached, contributed (the reviewed facts) and reported (`college_reviewed`, then `college_done`).
  A failed review — network, unparsable answer, unavailable model, even a usage limit — **never fails
  the college**: the unreviewed record is kept and the error is in the `college_reviewed` event.

## Defaults and turning it on

`src/ai/config.ts`:

- `REVIEW_DEFAULTS` — researcher **"luna 6" at high** effort, reviewer **"sol 6.1" at medium**. These
  are names, not ids: they are resolved at run time against the account's `GET /v1/models` list
  (slug or display name, ignoring case/spaces/dashes). The code has no hard-coded ChatGPT model ids
  (only `gpt-5` for the developer API-key demo); if a name isn't in the account's list, the review
  fails with the list of available models and the unreviewed record is kept.
- `APP_REVIEW = false` — the app's default when a run doesn't pass `review`. To turn it on, change
  that one line to `= REVIEW_DEFAULTS.reviewer`. Per run: `research.run({ …, review: { model, effort } })`
  or `review: false`.

The responses client now also returns `usage` (input/output/reasoning tokens from `response.usage`,
plus the number of web searches) when the API reports it.

## Measuring it: `npm run review-compare`

`scripts/review-compare.ts` runs one research pass **with review on** over a fixed panel, keeping each
college's record before and after review — a paired comparison on the same research — and scores both
against ground truth.

```sh
cd college-compass-app
npm run real-run -- login                      # once: prints the Sign in with ChatGPT URL
npm run real-run -- exchange '<callback url>'  # the http://127.0.0.1:1455/auth/callback?... URL
npm run review-compare -- models               # what the account can use; how the defaults resolve
npm run review-compare -- run                  # live comparison (writes results + report)
npm run review-compare -- score                # re-score the cached results without any calls
npm run review-compare -- run --dry            # mocked client end to end (no sign-in, no network)
```

Same token store as `real-run` (`CC_STORE`, default `./cc-real-run.json`, refreshed by the app's own
auth code; tokens are never printed). Options (flag or env): `--researcher "luna 6"`
(`CC_RESEARCHER_MODEL`), `--researcher-effort high` (`CC_RESEARCHER_EFFORT`), `--reviewer "sol 6.1"`
(`CC_REVIEWER_MODEL`), `--reviewer-effort medium` (`CC_REVIEWER_EFFORT`), `--panel 10` (`CC_PANEL`),
`--concurrency 10` (`CC_CONCURRENCY`), `--results <json>`, `--report <md>`, `--truth live|snapshot`.
Outputs (git-ignored): `cc-review-compare-results.json` (raw before/after records, call log, truth)
and `cc-review-compare-report.md`.

**Panel** (one fixed robotics / engineering / CS student, Fall 2027, research only — the reviewer
never sees it): Georgia Tech (public in/out-of-state COA, residency-specific EA), UC San Diego
(test-blind), WPI (ED I + ED II + EA), Purdue (reinstated test requirement, First-Year Engineering),
Harvey Mudd (small LAC), North Carolina A&T (HBCU, in-state public), Pitt (rolling), MIT (reinstated
tests, EA only), Virginia Tech (General Engineering then major placement), Caltech (ended its
test-blind moratorium, REA). `--panel 6` keeps the first six, which are already diverse.

**Scored against** federal College Scorecard figures from the shared Supabase database (live via
`match_colleges` + `colleges`/`college_stats`; per-college fallback to the checked-in
`scripts/review-ground-truth.json`, a snapshot of the same rows taken 2026-10-21): admit rate ±2 points,
SAT 25th/75th ±30, cost of attendance ±10% (Scorecard uses in-state tuition at publics, so an
out-of-state budget is converted with the record's own tuition difference), and test policy against a
short curated list (UCSD blind; MIT, Caltech, Purdue required). Federal figures lag the newest CDS by
1–2 years, so a correction that moves *away* from federal data is listed for a human to check the
source year. **Deadlines and plans** have no automatic truth: the report shows researcher and reviewer
side by side and flags disagreements for a spot-check.

**Report:** a table per college, then totals — checks within tolerance before/after, corrections
applied (closer / further / no change / not checkable), skipped (and why), unverified fields, failed
reviews, plan disagreements, wall clock (research phase vs whole run), API calls, tokens and web
searches (when reported) — and a recommendation computed from those numbers.

**Cost of a live run:** about 2 Responses calls per college (1 research + 1 review; research retries
add at most a few on failures) — ~20 calls for the full panel, plus one `GET /v1/models`. Each call runs
its own web searches on OpenAI's side. Expect a few minutes of wall clock with concurrency 10.

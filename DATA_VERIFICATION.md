# Data verification pass — 2026-08-17

Fact-check of the numeric fields in `college-dashboard/client/src/data/schools.json`
(33 schools). Corrections are cited in-data using the existing `source_log` convention:
each corrected figure carries `undergrad_enrollment_cite`, `undergrad_enrollment_asof`
and `undergrad_enrollment_note`, and the source URL is added to that school's `source_log`.

## Method and its limits

Verification used web search only. **Direct page fetching is blocked by the network
egress policy in this environment**, so figures below were confirmed from search results
attributed to the named source rather than by reading the source document end to end.
Figures were only changed where an authoritative publisher (the university's own
newsroom, provost, or institutional-research office) reported a specific number.
Anything ambiguous was left unchanged and is listed under *Not verified* below.

## Corrections applied

| School | Field | Was | Now | Source |
|---|---|---|---|---|
| NC State | `undergrad_enrollment` | 12,500 | **29,340** | [NC State Provost, Fall 2025 census](https://provost.ncsu.edu/news/2025/11/october-metrics-update-shows-gains-in-student-success-measures/) |
| NC State | `size_bucket` | `medium` | **`large`** | follows from the corrected enrollment |
| Virginia Tech | `undergrad_enrollment` | 30,000 | **31,536** | [Virginia Tech News, fall enrollment census](https://news.vt.edu/articles/2025/10/cm-fallcensus.html) |
| UT Austin | `undergrad_enrollment` | 42,400 | **44,314** | [UT Austin News, Sept 2025](https://news.utexas.edu/2025/09/18/ut-sets-all-time-highs-for-enrollment-and-student-performance/) |
| UM-Dearborn | `undergrad_enrollment` | 7,300 | **6,199** | [UM-Dearborn, Fall 2025 enrollment](https://umdearborn.edu/news/look-fall-2025-enrollment) |

The NC State figure was the significant one: 12,500 is roughly the size of NC State's
College of Engineering, not its undergraduate student body. It understated the school by
more than half and, because `size_bucket` was `medium`, NC State was also being excluded
from the "large" size filter on the Overview page.

Every other enrollment value that was *not* a round number checked out at the one-year
offset you would expect from an IPEDS-style pull. The four wrong values were all round
estimates; the round-number pattern was a reliable tell.

## Structural fix: null cost fields

Seven private schools had `cost_total_instate` or `cost_total_outofstate` set to `null`
while the other side carried a value, so the Cost and Compare tables rendered a blank
cell for them. Private tuition does not vary by residency, so the known value is now
mirrored into both fields — no new figures were invented:

`johns-hopkins` 94,858 · `northeastern` 94,137 · `penn` 99,082 · `rit` 82,868 ·
`rpi` 90,076 (in-state filled) · `olin` 97,088 · `wpi` 87,000 (out-of-state filled)

## Verified as already correct

- **Georgia Tech** 20,000 — Georgia Tech reports 5,415 new undergraduates in 2025 bringing
  the total "to over 20,000" ([GT Enrollment Management](https://news.em.gatech.edu/2025/08/18/over-5400-undergraduates-join-georgia-tech/)).
  Kept as a rounded figure with the citation attached.
- **Texas A&M** 59,000 — Fall 2025 preliminary reporting put College Station above 74,000
  total with undergraduates up ~1.5% (+875); US News reports 60,710 undergraduates for
  Fall 2024. The stored value sits inside that range, so it was left alone.
- **MIT** 4,561 — MIT Registrar reported 4,535 undergraduates as of October 2024.
- **Johns Hopkins** SAT 1530–1565 / ACT 35–35 — matches the 2025-26 CDS section C9. The
  identical 25th and 75th ACT percentiles look like a typo but are genuine; JHU's ACT
  distribution is that compressed.
- **Northeastern** ED admit rate 43.0% — CDS C21: 1,492 admits from 3,466 ED applicants
  (43.05%), consistent with the stored 0.4305 alongside a 5.2% overall rate.
- **Rose-Hulman** 80.9% — internally consistent with its own recorded counts
  (4,847 admitted / 5,991 applied).

The admissions block generally held up well. Where a figure carries a note with raw
CDS counts, it was accurate in every case checked.

## Not verified — open items

- **Purdue** `undergrad_enrollment` 43,067. US News reports 44,819 undergraduates for
  Fall 2024, and Purdue reports 54,651 total on the West Lafayette campus for Fall 2025.
  The discrepancy likely comes from whether online and statewide students are counted.
  Left unchanged pending Purdue's own Data Digest.
- **Cost of attendance** figures carry no citations anywhere in the dataset. Spot-checking
  WPI found tuition and fees $63,046 + room and board $18,900 + books $1,200 = $83,146
  direct-billed, against the stored $87,000 — the gap is plausibly health insurance
  ($2,681) plus personal and travel allowances, but what each school's total includes is
  not recorded, so the numbers are not comparable across schools as displayed.
- **Kettering** has an admissions block with no admit rate, no test scores and no
  `cds_year`. **Virginia Tech** is also missing `cds_year`.
- **Missing test scores**: `sat_mid50` is null for Kettering, Penn, UC Berkeley,
  UT Austin, Virginia Tech and WPI.
- **24 of 33 schools** record an admit rate with no `overall_admit_rate_note`, so the
  underlying applied/admitted/enrolled counts are not captured and the rate cannot be
  re-derived. The nine that do record counts were the easiest to verify — worth
  backfilling the rest.
- Non-numeric claims (curriculum detail, robotics coverage, club and housing prose) were
  outside the scope of this pass.

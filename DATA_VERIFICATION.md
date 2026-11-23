# Data verification — October 14 and 16, 2026

The active dashboard covers exactly 16 universities, including NYU (added November 23, 2026). This replaces the old 33-school cost audit, whose figures and scope no longer described the selected robotics routes.

See [ROBOTICS_RESEARCH.md](ROBOTICS_RESEARCH.md) for the review of the original 15 major recommendations; NYU was added November 23, 2026 from official Tandon, Courant, CREO, admissions, aid and CDS sources. The machine-readable programme ledger is `college-dashboard/client/src/data/research_audit.json`; financial/CDS fetch records are in `finance_sources.json` and `admissions_source_log.json`.

## Current facts versus historical context

Official degree/curriculum, entry, scholarship and deadline sources for thirteen schools were read again on October 14. Rose-Hulman and Michigan-Dearborn were re-researched from their current catalogs, admissions, aid, Common Data Set and visit pages on October 16. Some current pages show month/day without an explicit entry year; those calendar events retain `year_inferred: true`. Exact published notification bounds are labeled “by”, while vague windows have null ISO dates rather than fabricated release days. Future seat availability and graduation schedules are never guaranteed.

Historical campus culture, Reddit/community membership, travel context and alumni/company bands retain their original compilation dates. They were not relabeled as current robotics outcomes. Historical source-log entries remain alongside the new readings.

## Costs

Published totals retain programme, residency, academic year and exclusions. Most verified full budgets are 2026–27. Georgia Tech also has an official estimated 2027–28 budget. Engineering differential tuition, transportation variation and waivable health insurance can change an individual budget.

Michigan Engineering full cost is unknown: an LSA cost cannot be substituted. Ohio State’s verified billed expenses are kept separately from its unverified full COA. Purdue’s Engineering/CS differential is not applied to Polytechnic technology programmes. Duke’s maximum COA is a range endpoint rather than an NC-specific quotation.

## Admissions and outcomes

CDS first-year counts have an explicit report and entering cohort. They are university/campus-level unless an official programme population is specified. Current RPI CDS retrieval failed; its old values are not claimed as freshly verified. NC State’s CDS contains conflicting C1 totals, retained as a source discrepancy.

The ACT-share copying error was corrected using accessible CDS tables; unknown shares became null. The old 2015 CMU college comparison and inferred GT computing estimate cannot drive current heuristics. Unspecified GPA scales cannot cause tier changes. ED/EA cohort differences do not establish causal admission advantages.

Aid/net-price population denominators and years remain explicit. Historical IPEDS averages are not personalized aid estimates. Career reports distinguish mean from median, CS from Engineering/university-wide scope, cohort year and response coverage. No CS salary is represented as a robotics salary.

## Validation

The selected list is 15 schools: Cornell and Johns Hopkins were restored with their October 14 review, alongside Rose-Hulman and Michigan-Dearborn. The two additions were re-researched on October 16, 2026 from official pages (and College Navigator / College Scorecard data for net price). Facts that could not be confirmed stay null with a note naming who to ask: for example Rose-Hulman's annual snowfall normal and C7 factor checkboxes, and Michigan-Dearborn's Greek and housing percentages (UM-Dearborn does not publish a current Common Data Set) and whether its 3.0 GPA admission guarantee covers out-of-state applicants. Dearborn campus descriptions avoid unsourced commuter or quiet-campus claims. Neither new school has an application round chosen yet.


## NYU (added November 23, 2026)

New York University was added with a Tandon School of Engineering focus (recommended route: B.S. Computer Engineering + Robotics minor), plus a note that Courant offers a separate B.A. in Computer Science in CAS. Official sources were read November 23, 2026.

Verified and recorded:

- Application plans (month/day published; cycle year inferred): Early Decision I November 1 (decision December 15); Early Decision II January 1 (decision February 15); Regular Decision January 5 (decision April 1). Source: [NYU first-year applicants](https://www.nyu.edu/admissions/undergraduate-admissions/how-to-apply/all-freshmen-applicants.html). A Tandon FAQ on join.nyu.edu has listed Regular Decision as January 6; the university first-year page and the Tandon CS program page list January 5, which is what the dashboard uses.
- Aid: CSS Profile November 10 (ED I), January 10 (ED II), February 1 (Regular Decision). NYU recommends filing the FAFSA by the same date. Source: [How to Apply for Financial Aid](https://www.nyu.edu/admissions/financial-aid-and-scholarships/applying-as-a-prospective-undergraduate-student.html).
- 2026-27 Tandon estimated COA $100,998 (tuition and fees $68,576, food and housing $26,438, books $1,492, transportation $2,438, personal $2,054). NYU has no in-state rate. Amounts are not officially approved until July 2026. Source: [Cost of Attendance](https://www.nyu.edu/admissions/financial-aid-and-scholarships/cost-of-attendance.html).
- CDS 2025-26: 114,125 applied / 10,340 admitted / 5,662 enrolled (9.1% university-wide); SAT mid-50 1480–1550 (27% submitted); ACT mid-50 34–35 (10% submitted); test-optional through 2027-28; degree-seeking undergraduates 29,046; first-year retention 96.10%; 2019-cohort six-year graduation about 87.9% (displayed as 88) and four-year 74%; need-based grant share and averages from H2/H2A as recorded in outcomes.json.

Left unverified or null on purpose:

- Tandon- or major-specific admit rate; Early Decision admit counts (not found in the extracted CDS text).
- CDS C7 factor checkboxes (PDF layout could not be mapped reliably).
- Average high school GPA (distribution published; average not clearly reported).
- International undergraduate share (CDS B2 table not cleanly extracted).
- Official College Scorecard / IPEDS net-price income bands (left null rather than copied from a secondary compilation).
- Need-blind status; official robotics or Tandon starting-salary report.
- Undergraduate access rules for CREO labs; internal transfer requirements between Tandon and CAS.
- Days below freezing; a sampled airfare band from RDU.
- Supplemental essay prompts for the current Common App; FIRST-specific scholarship (none found on official aid pages).
- Reddit sentiment and company-alumni bands (not compiled for NYU; left empty / n.a.).

Anurag's application round is pending. ED I has passed. ED II is binding and only an option if Carnegie Mellon releases him.

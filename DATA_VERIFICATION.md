# Data verification — October 14 and 16, 2026

The active dashboard covers exactly 15 universities. This replaces the old 33-school cost audit, whose figures and scope no longer described the selected robotics routes.

See [ROBOTICS_RESEARCH.md](ROBOTICS_RESEARCH.md) for the complete review and all 15 major recommendations. The machine-readable programme ledger is `college-dashboard/client/src/data/research_audit.json`; financial/CDS fetch records are in `finance_sources.json` and `admissions_source_log.json`.

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

# Data verification — October 14, 2026

The active dashboard covers exactly 13 universities. This replaces the old 33-school cost audit, whose figures and scope no longer described the selected robotics routes.

See [ROBOTICS_RESEARCH.md](ROBOTICS_RESEARCH.md) for the complete review and all 13 major recommendations. The machine-readable programme ledger is `college-dashboard/client/src/data/research_audit.json`; financial/CDS fetch records are in `finance_sources.json` and `admissions_source_log.json`.

## Current facts versus historical context

Official degree/curriculum, entry, scholarship and deadline sources for the eleven retained schools were read again in the October refresh. Rose-Hulman and Michigan-Dearborn use corrected August 2026 evidence with current checks pending. Some current pages show month/day without an explicit entry year; those calendar events retain `year_inferred: true`. Exact published notification bounds are labeled “by”, while vague windows have null ISO dates rather than fabricated release days. Future seat availability and graduation schedules are never guaranteed.

Historical campus culture, Reddit/community membership, travel context and alumni/company bands retain their original compilation dates. They were not relabeled as current robotics outcomes. Historical source-log entries remain alongside the new readings.

## Costs

Published totals retain programme, residency, academic year and exclusions. Most verified full budgets are 2026–27. Georgia Tech also has an official estimated 2027–28 budget. Engineering differential tuition, transportation variation and waivable health insurance can change an individual budget.

Michigan Engineering full cost is unknown: an LSA cost cannot be substituted. Ohio State’s verified billed expenses are kept separately from its unverified full COA. Purdue’s Engineering/CS differential is not applied to Polytechnic technology programmes. Duke’s maximum COA is a range endpoint rather than an NC-specific quotation.

## Admissions and outcomes

CDS first-year counts have an explicit report and entering cohort. They are university/campus-level unless an official programme population is specified. Current RPI CDS retrieval failed; its old values are not claimed as freshly verified. NC State’s CDS contains conflicting C1 totals, retained as a source discrepancy.

The ACT-share copying error was corrected using accessible CDS tables; unknown shares became null. The old 2015 CMU college comparison and inferred GT computing estimate cannot drive current heuristics. Unspecified GPA scales cannot cause tier changes. ED/EA cohort differences do not establish causal admission advantages.

Aid/net-price population denominators and years remain explicit. Historical IPEDS averages are not personalized aid estimates. Career reports distinguish mean from median, CS from Engineering/university-wide scope, cohort year and response coverage. No CS salary is represented as a robotics salary.

## Validation

The selected list now includes Rose-Hulman and Michigan-Dearborn in place of Cornell and Johns Hopkins. These two entries use audited August 2026 university-source records, not fresh October retrievals. Their unknown current budgets, scholarship amounts, application deadlines, major-entry guarantees and campus/social figures remain null or explicitly unconfirmed. Dearborn's earlier commuter, student-origin and quiet-campus claims were removed because no supporting citation could be traced. New application plans remain pending until rounds and dates are selected and verified.

Run `npm test`, `npm run check` and `npm run build` from `college-dashboard`. Automated regressions check roster consistency, distinct credential/campus routes, route-specific scoring and source scope, preserved application plans, and calendar behavior. Browser checks exercise all existing routes and representative interactive flows. Source access failures and curriculum/advising conflicts are documented instead of replaced with invented facts.

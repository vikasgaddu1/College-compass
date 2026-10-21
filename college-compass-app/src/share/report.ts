/**
 * "Share my list as a PDF": builds the print-ready HTML the native side (SharePdfPlugin.swift) or
 * the browser turns into a PDF. Pure and dependency-light on purpose:
 *
 * - Self-contained document: inline CSS only, system font stack, no images/scripts/web fonts.
 * - Simple block + table layout so WebKit's UIMarkupTextPrintFormatter (which supports less than
 *   Chromium: no flex/grid guarantees, little @page support) paginates it the same way.
 * - Every piece of student / AI text goes through `esc()` — names, notes and reasons can contain
 *   `<`, `&` and quotes.
 * - Honest wording: chances are estimate bands, costs are estimates, figures come from public data
 *   and AI research.
 *
 * Formatting helpers are copied from `store.tsx` (`fmt`) rather than imported, so this module never
 * pulls React or the store into tests or the native bundle.
 */
import type { ApplicationFacts, BalancedList, College, MajorArea, RankedCollege, StudentProfile, Tier } from "@/types";
import { INCOME_BANDS, TIER_ORDER, majorLabel, regionLabel, stateName, tierInfo } from "@/state/catalog";

export interface ReportOptions {
  /** GPA, SAT/ACT, AP/IB count and class rank in the student snapshot. Default true. */
  grades: boolean;
  /** Family budget + income band, and the student's own net-price estimates. Default false (keeps finances private). */
  budget: boolean;
  /** The student's own note on each college. Default true. */
  notes: boolean;
  /** Compact table of researched colleges that didn't make the balanced picks. Default false. */
  others: boolean;
}

export const DEFAULT_REPORT_OPTIONS: Readonly<ReportOptions> = { grades: true, budget: false, notes: true, others: false };

export interface ReportInput {
  /** Name of the list, e.g. "Robotics Northeast". Falls back to "College list". */
  listName: string;
  profile: StudentProfile;
  /** Balanced picks per tier, in the app's order inside each tier. */
  balanced: BalancedList;
  /** Researched colleges that didn't make the balanced picks (shown only with `options.others`). */
  others?: RankedCollege[];
  /** Shortlisted (starred) college ids. */
  shortlist?: string[];
  /** The student's notes by college id. */
  notes?: Record<string, string>;
  /** When the report was generated. Default: now. */
  generatedAt?: Date | string | number;
}

export const REPORT_DISCLAIMER = "Estimates from public data and AI research — confirm details with each college.";
const APP_NAME = "College Compass";

// ───────────────────────────── small helpers ─────────────────────────────

/** HTML-escape text for element content and double-quoted attribute values. */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const fmt = {
  usd(n: number | null | undefined): string {
    return n == null || !Number.isFinite(n) ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
  },
  pct(p: number | null | undefined): string {
    return p == null || !Number.isFinite(p) ? "—" : `${Math.round(p * 100)}%`;
  },
  band(low: number, high: number): string {
    return `${Math.round(low * 100)}–${Math.round(high * 100)}%`;
  },
  num(n: number | null | undefined): string {
    return n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US");
  },
};

function toDate(d: ReportInput["generatedAt"]): Date {
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? new Date() : d;
  if (d == null) return new Date();
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function longDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** Local calendar date as YYYY-MM-DD (the student's "today", not UTC). */
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function cleanListName(name: string | null | undefined): string {
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  return n || "College list";
}

/**
 * Filesystem-safe PDF file name, e.g. "College list - Robotics Northeast - 2026-10-20.pdf".
 * Characters that are illegal or awkward in file names (/ \ : * ? " < > |, control characters,
 * leading/trailing dots) are replaced; the list name is capped so the whole name stays short.
 */
export function reportFileName(listName: string | null | undefined, date: Date | string | number = new Date()): string {
  const d = toDate(date);
  let safe = cleanListName(listName)
    .replace(/[\\/:*?"<>|]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .trim();
  if (safe.length > 60) safe = safe.slice(0, 60).trim();
  const middle = safe && safe.toLowerCase() !== "college list" ? ` - ${safe}` : "";
  return `College list${middle} - ${ymd(d)}.pdf`;
}

function firstName(profile: StudentProfile): string | null {
  const n = (profile.name ?? "").trim();
  if (!n) return null;
  return n.split(/\s+/)[0] ?? null;
}

/** "Fall 2027 entry" from the graduation year, else the cycle the research used, else null. */
function entryCycle(profile: StudentProfile, colleges: RankedCollege[]): string | null {
  const y = Number(profile.grad_year);
  if (Number.isInteger(y) && y > 2000 && y < 2100) return `Fall ${y} entry`;
  const fromResearch = colleges.map((r) => r.college.application?.cycle).find((c) => !!c && c.trim());
  return fromResearch?.trim() ?? null;
}

const TEST_POLICY: Record<College["test_policy"], string> = {
  required: "Tests required",
  optional: "Test-optional",
  blind: "Test-blind",
  considered: "Tests considered",
  unknown: "Test policy —",
};

const PLAN_LABEL: Record<ApplicationFacts["plans"][number]["plan"], string> = {
  ED: "Early Decision",
  ED2: "Early Decision II",
  EA: "Early Action",
  REA: "Restrictive Early Action",
  RD: "Regular Decision",
  Rolling: "Rolling",
  Priority: "Priority",
};

function satRange(c: College): string {
  if (c.sat_25 == null && c.sat_75 == null) return "—";
  if (c.sat_25 != null && c.sat_75 != null) return `${c.sat_25}–${c.sat_75}`;
  return String(c.sat_25 ?? c.sat_75);
}

function ownershipLabel(c: College): string {
  return c.ownership === "public" ? "Public" : "Private";
}

function gpaText(p: StudentProfile): string | null {
  const parts: string[] = [];
  if (p.gpa_unweighted != null) parts.push(`${p.gpa_unweighted} unweighted`);
  if (p.gpa_weighted != null) parts.push(`${p.gpa_weighted} weighted`);
  return parts.length ? parts.join(" · ") : null;
}

function incomeLabel(p: StudentProfile): string {
  return INCOME_BANDS.find((b) => b.id === p.income_band)?.label ?? "Not shared";
}

/** Net-price cell for a college, honouring the budget option (never reveals income when it's off). */
function netPrice(r: RankedCollege, options: ReportOptions): { label: string; value: string; note: string | null } {
  if (options.budget) {
    return {
      label: "Est. net price / yr",
      value: fmt.usd(r.est_net_price),
      note: r.est_net_price != null && r.est_net_price_note ? r.est_net_price_note : null,
    };
  }
  return { label: "Avg. net price / yr (all families)", value: fmt.usd(r.college.avg_net_price), note: null };
}

/**
 * Engine reasons/watchouts such as "Est. $24k/yr — within your budget" or "Over your budget by about
 * $4k/yr" reveal the family's budget and income-based estimate; drop them when the budget option is off.
 */
const PRIVATE_LINE = /your budget|est\. \$|lower cost/i;
function privateFilter(lines: string[] | undefined, options: ReportOptions): string[] {
  const out = (lines ?? []).filter((x) => typeof x === "string" && x.trim());
  return options.budget ? out : out.filter((x) => !PRIVATE_LINE.test(x));
}

function programNotes(c: College, majors: MajorArea[]): { major: string; text: string }[] {
  const out: { major: string; text: string }[] = [];
  for (const m of majors) {
    if (m === "undecided") continue;
    const p = c.programs?.find((x) => x.major === m);
    if (!p) continue;
    if (!p.offered) {
      out.push({ major: majorLabel(m), text: "not offered as a major" });
      continue;
    }
    // Degree + how you get in; the longer research notes stay in the app.
    const bits: string[] = [];
    if (p.degree) bits.push(p.degree);
    if (p.how_to_enter) bits.push(p.how_to_enter);
    out.push({ major: majorLabel(m), text: bits.join(" — ") || "offered" });
  }
  return out;
}

function plansText(c: College): string | null {
  const plans = c.application?.plans?.filter((p) => p && p.plan) ?? [];
  if (!plans.length) return null;
  return plans
    .map((p) => {
      const label = PLAN_LABEL[p.plan] ?? p.plan;
      const when = p.deadline ? ` ${esc(p.deadline)}` : p.plan === "Rolling" ? "" : ' <span class="muted">(deadline not found)</span>';
      const note = p.notes ? ` <span class="muted">(${esc(p.notes)})</span>` : "";
      return `<span class="plan"><b>${esc(label)}</b>${when}${note}</span>`;
    })
    .join('<span class="sep"> · </span>');
}

// ───────────────────────────── sections ─────────────────────────────

function snapshotRows(profile: StudentProfile, options: ReportOptions, cycle: string | null): [string, string][] {
  const rows: [string, string][] = [];
  if (options.grades) {
    const gpa = gpaText(profile);
    if (gpa) rows.push(["GPA", gpa]);
    if (profile.sat != null) rows.push(["SAT", String(profile.sat)]);
    if (profile.act != null) rows.push(["ACT", String(profile.act)]);
    if (profile.ap_ib_count != null) rows.push(["AP / IB courses", String(profile.ap_ib_count)]);
    if (profile.class_rank_pct != null) rows.push(["Class rank", `Top ${profile.class_rank_pct}%`]);
  }
  const majors = (profile.majors ?? []).map(majorLabel);
  if (majors.length) rows.push(["Intended majors", majors.join(", ")]);
  if (profile.home_state) rows.push(["Home state", stateName(profile.home_state)]);
  rows.push(["Regions", profile.regions?.length ? profile.regions.map(regionLabel).join(", ") : "Anywhere in the US"]);
  if (cycle) rows.push(["Entry", cycle]);
  if (options.budget) {
    rows.push(["Family budget / yr", profile.budget_per_year != null ? fmt.usd(profile.budget_per_year) + " after aid" : "Not sure yet"]);
    rows.push(["Family income", incomeLabel(profile)]);
  }
  return rows;
}

function snapshotHtml(rows: [string, string][]): string {
  if (!rows.length) return "";
  // Two label/value pairs per table row: reads well on Letter, needs no flex/grid.
  const cells: string[] = [];
  for (let i = 0; i < rows.length; i += 2) {
    const a = rows[i];
    const b = rows[i + 1];
    cells.push(
      `<tr><th scope="row">${esc(a[0])}</th><td>${esc(a[1])}</td>` +
        (b ? `<th scope="row">${esc(b[0])}</th><td>${esc(b[1])}</td>` : `<th></th><td></td>`) +
        `</tr>`,
    );
  }
  return `<section class="snapshot"><h2>Student snapshot</h2><table class="facts">${cells.join("")}</table></section>`;
}

function collegeHtml(r: RankedCollege, ctx: { options: ReportOptions; starred: Set<string>; notes: Record<string, string>; majors: MajorArea[] }): string {
  const { college: c, odds } = r;
  const t = tierInfo(odds.tier);
  const price = netPrice(r, ctx.options);
  const plans = plansText(c);
  const programs = programNotes(c, ctx.majors);
  const reasons = privateFilter(r.reasons, ctx.options).slice(0, 2);
  const watchouts = privateFilter(r.watchouts, ctx.options).slice(0, 2);
  const note = ctx.options.notes ? (ctx.notes[c.id] ?? "").trim() : "";
  const star = ctx.starred.has(c.id) ? `<span class="star" title="Shortlisted">&#9733; Shortlisted</span>` : "";
  const size = c.undergrad_size != null ? ` · ${fmt.num(c.undergrad_size)} undergrads` : "";
  const location = [c.city, c.state].filter((x) => x && x !== "--" && x !== "Unknown").join(", ");
  const coa = c.cost_of_attendance != null ? fmt.usd(c.cost_of_attendance) : "—";
  const coaBasis = c.ownership === "public" && c.cost_of_attendance != null && c.cost_of_attendance_basis && c.cost_of_attendance_basis !== "same" ? ` <span class="muted">(${c.cost_of_attendance_basis === "in_state" ? "in-state" : "out-of-state"})</span>` : "";

  const rows: string[] = [];
  rows.push(`<tr>
    <th>Estimated chance</th><th>Admit rate</th><th>SAT middle 50%</th><th>Testing</th>
  </tr><tr>
    <td><b>${fmt.band(odds.low, odds.high)}</b> <span class="muted">${esc(t.label.toLowerCase())}</span></td>
    <td>${fmt.pct(c.admit_rate)}</td>
    <td>${esc(satRange(c))}</td>
    <td>${esc(TEST_POLICY[c.test_policy] ?? "—")}</td>
  </tr>`);
  rows.push(`<tr>
    <th>Cost of attendance / yr</th><th colspan="2">${esc(price.label)}</th><th>Data</th>
  </tr><tr>
    <td>${coa}${coaBasis}</td>
    <td colspan="2"><b>${esc(price.value)}</b>${price.note ? ` <span class="muted">${esc(price.note)}</span>` : ""}</td>
    <td class="muted">${esc(c.data_year || "—")}${c.data_confidence ? ` · ${esc(c.data_confidence)} confidence` : ""}</td>
  </tr>`);

  const lines: string[] = [];
  if (plans) lines.push(`<p class="line"><span class="k">Apply</span> ${plans}</p>`);
  for (const p of programs) lines.push(`<p class="line"><span class="k">${esc(p.major)}</span> ${esc(p.text)}</p>`);
  if (reasons.length) lines.push(`<p class="line"><span class="k">Why it's here</span> ${reasons.map(esc).join(" · ")}</p>`);
  if (watchouts.length) lines.push(`<p class="line"><span class="k">Watch out</span> ${watchouts.map(esc).join(" · ")}</p>`);
  if (note) lines.push(`<p class="line note"><span class="k">Student's note</span> <span class="pre">${esc(note)}</span></p>`);

  return `<article class="college">
  <h3>${esc(c.name)}${star}</h3>
  <p class="meta">${esc(location || "Location not found")} · ${ownershipLabel(c)}${size}</p>
  <table class="stats"><colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"></colgroup>${rows.join("")}</table>
  ${lines.join("\n  ")}
</article>`;
}

function tierSectionHtml(tier: Tier, items: RankedCollege[], ctx: Parameters<typeof collegeHtml>[1]): string {
  if (!items.length) return "";
  const t = tierInfo(tier);
  return `<section class="tier" data-tier="${esc(tier)}">
<h2>${esc(t.label)} <span class="range">estimated chance ${esc(t.range)} · ${items.length}</span></h2>
${items.map((r) => collegeHtml(r, ctx)).join("\n")}
</section>`;
}

function othersHtml(others: RankedCollege[], options: ReportOptions, starred: Set<string>): string {
  if (!others.length) return "";
  const priceHead = options.budget ? "Est. net price / yr" : "Avg. net price / yr";
  const rows = others
    .map((r) => {
      const c = r.college;
      const t = tierInfo(r.odds.tier);
      const star = starred.has(c.id) ? " &#9733;" : "";
      const price = options.budget ? fmt.usd(r.est_net_price) : fmt.usd(c.avg_net_price);
      const location = [c.city, c.state].filter((x) => x && x !== "--" && x !== "Unknown").join(", ");
      return `<tr><td>${esc(c.name)}${star}</td><td>${esc(location)}</td><td>${ownershipLabel(c)}</td><td>${esc(t.label)}</td><td class="num">${fmt.band(r.odds.low, r.odds.high)}</td><td class="num">${fmt.pct(c.admit_rate)}</td><td class="num">${price}</td></tr>`;
    })
    .join("");
  return `<section class="others">
<h2>Other colleges researched <span class="range">not in the balanced picks · ${others.length}</span></h2>
<table class="compact">
<thead><tr><th>College</th><th>Location</th><th>Type</th><th>Tier</th><th class="num">Est. chance</th><th class="num">Admit rate</th><th class="num">${priceHead}</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</section>`;
}

// ───────────────────────────── document ─────────────────────────────

const CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  @page { size: Letter; margin: 0.6in 0.6in 0.7in; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    color: #111; font: 10.5pt/1.4 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .doc { max-width: 7.4in; margin: 0 auto; }
  h1, h2, h3, p, table { margin: 0; }
  .muted { color: #666; }
  .num { text-align: right; white-space: nowrap; }
  .pre { white-space: pre-wrap; }

  header.top { border-bottom: 2px solid #111; padding-bottom: 8pt; margin-bottom: 12pt; }
  header.top h1 { font-size: 20pt; font-weight: 700; letter-spacing: -0.01em; line-height: 1.15; }
  header.top .sub { margin-top: 4pt; font-size: 10.5pt; color: #333; }
  header.top .prepared { margin-top: 2pt; font-size: 9pt; color: #666; }

  section.snapshot { margin-bottom: 14pt; }
  h2 { font-size: 13pt; font-weight: 700; margin: 0 0 6pt; padding-top: 4pt; }
  h2 .range { font-size: 9.5pt; font-weight: 400; color: #666; margin-left: 6pt; }
  table.facts { width: 100%; border-collapse: collapse; font-size: 10pt; }
  table.facts th, table.facts td { text-align: left; vertical-align: top; padding: 3pt 8pt 3pt 0; border-bottom: 0.5pt solid #ddd; }
  table.facts th { width: 18%; font-weight: 600; color: #444; white-space: nowrap; }
  table.facts td { width: 32%; }

  section.tier { margin-top: 10pt; }
  section.tier h2 { border-bottom: 0.75pt solid #999; padding-bottom: 3pt; margin-bottom: 8pt; }
  section.tier h2 { page-break-after: avoid; break-after: avoid; }

  article.college {
    border: 0.75pt solid #cfcfcf; border-radius: 6pt; padding: 7pt 10pt 6pt; margin: 0 0 7pt;
    page-break-inside: avoid; break-inside: avoid;
  }
  article.college h3 { font-size: 12pt; font-weight: 700; line-height: 1.2; }
  article.college .star { font-size: 8.5pt; font-weight: 600; color: #8a5a00; border: 0.75pt solid #d8b25a; border-radius: 3pt; padding: 0 4pt; margin-left: 6pt; vertical-align: 1pt; white-space: nowrap; }
  article.college .meta { font-size: 9.5pt; color: #555; margin-top: 1pt; }
  table.stats { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 6pt 0 5pt; font-size: 9.5pt; }
  table.stats col.c1 { width: 27%; } table.stats col.c2 { width: 15%; } table.stats col.c3 { width: 24%; } table.stats col.c4 { width: 34%; }
  table.stats th { text-align: left; font-weight: 600; font-size: 8pt; color: #666; text-transform: uppercase; letter-spacing: 0.03em; padding: 3pt 8pt 0 0; vertical-align: bottom; }
  table.stats td { text-align: left; padding: 0 8pt 3pt 0; vertical-align: top; border-bottom: 0.5pt solid #e6e6e6; }
  table.stats tr:last-child td { border-bottom: 0; }
  .line { font-size: 9.5pt; margin-top: 2.5pt; color: #222; }
  .line .k { font-weight: 600; color: #111; }
  .line .k::after { content: ":"; }
  .line .plan b { font-weight: 600; }
  .line.note { background: #f6f6f6; border-left: 2pt solid #bbb; padding: 3pt 6pt; margin-top: 5pt; }

  section.others { margin-top: 14pt; }
  table.compact { width: 100%; border-collapse: collapse; font-size: 9pt; }
  table.compact th { text-align: left; font-weight: 600; color: #444; border-bottom: 0.75pt solid #999; padding: 3pt 6pt 3pt 0; }
  table.compact td { padding: 3pt 6pt 3pt 0; border-bottom: 0.5pt solid #e3e3e3; vertical-align: top; }
  table.compact tr { page-break-inside: avoid; break-inside: avoid; }

  section.about { margin-top: 16pt; padding-top: 8pt; border-top: 0.75pt solid #999; font-size: 8.5pt; color: #555; page-break-inside: avoid; break-inside: avoid; }
  section.about p { margin-top: 3pt; }
  footer.end { margin-top: 10pt; font-size: 8.5pt; color: #666; text-align: center; }
`;

/**
 * Build the complete, self-contained HTML document for the shared list.
 * Deterministic for a given input + `generatedAt`.
 */
export function buildReportHtml(input: ReportInput, options: Partial<ReportOptions> = {}): string {
  const opts: ReportOptions = { ...DEFAULT_REPORT_OPTIONS, ...options };
  const listName = cleanListName(input.listName);
  const profile = input.profile;
  const date = toDate(input.generatedAt);
  const starred = new Set(input.shortlist ?? []);
  const notes = input.notes ?? {};
  const majors = Array.isArray(profile.majors) ? profile.majors : [];
  const all = TIER_ORDER.flatMap((t) => input.balanced[t] ?? []);
  const cycle = entryCycle(profile, all);
  const name = firstName(profile);
  const ctx = { options: opts, starred, notes, majors };

  const subParts: string[] = [];
  if (name) subParts.push(`Prepared for ${esc(name)}`);
  if (cycle) subParts.push(esc(cycle));
  subParts.push(`${all.length} ${all.length === 1 ? "college" : "colleges"}`);
  const counts = TIER_ORDER.map((t) => ({ t, n: (input.balanced[t] ?? []).length })).filter((x) => x.n > 0);
  if (counts.length) subParts.push(counts.map((x) => `${x.n} ${tierInfo(x.t).label.toLowerCase()}`).join(", "));

  const tiers = TIER_ORDER.map((t) => tierSectionHtml(t, input.balanced[t] ?? [], ctx)).join("\n");
  const others = opts.others ? othersHtml(input.others ?? [], opts, starred) : "";

  const aboutBits = [
    `<p><b>How to read this.</b> "Estimated chance" is a band from ${APP_NAME}'s admissions model (admit rate, test scores, GPA, rigor, residency and application plan). It is an estimate for planning, not a prediction or a promise — real decisions depend on essays, recommendations, the applicant pool and institutional priorities.</p>`,
    opts.budget
      ? `<p><b>Costs.</b> "Est. net price" is what this family might pay per year after grants, estimated from each college's reported average for the family's income band and residency. Published cost of attendance is the sticker price before aid. Use each college's net price calculator for a real figure.</p>`
      : `<p><b>Costs.</b> "Avg. net price" is the federal average for all aided families and may be far from this family's figure; published cost of attendance is the sticker price before aid. Use each college's net price calculator for a real figure.</p>`,
    `<p><b>Sources.</b> Admission, cost and outcome figures come from public data (Common Data Set, IPEDS / College Scorecard) and AI-assisted research of college websites, as of the data year shown on each college. Deadlines and policies change — confirm with each college before applying.</p>`,
  ].join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(listName)} — ${APP_NAME}</title>
<style>${CSS}</style>
</head>
<body>
<div class="doc">
<header class="top">
  <h1>${esc(listName)}</h1>
  <p class="sub">${subParts.join(" · ")}</p>
  <p class="prepared">Prepared ${esc(longDate(date))} with ${APP_NAME}</p>
</header>
${snapshotHtml(snapshotRows(profile, opts, cycle))}
${all.length ? tiers : `<p class="muted">No colleges on this list yet.</p>`}
${others}
<section class="about">${aboutBits}</section>
<footer class="end">${esc(REPORT_DISCLAIMER)}</footer>
</div>
</body>
</html>
`;
}

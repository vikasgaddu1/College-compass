/**
 * Ranking, reasons/watchouts, the balanced list and a compact AI-context summary.
 * Soft filtering only: nothing the student researched is dropped; mismatches become watchouts.
 */
import type { BalancedList, College, RankedCollege, StudentProfile, Tier } from "../types";
import { estimateOdds, isGatedMajor, isInState, programFor } from "./odds";
import { estimateNetPrice } from "./price";
import { cleanMajors, locationChecks, scoreFit, shareFor } from "./fit";
import { bestSat } from "./concordance";
import { fmtK, fmtPct, rate, usd } from "./math";
import { majorLabel, normName, TIER_LABELS } from "./labels";

export const TIER_ORDER: readonly Tier[] = ["high_reach", "reach", "target", "likely", "safety"];

export type BalancedSpec = Record<Tier, number>;
export const DEFAULT_BALANCED_SPEC: Readonly<BalancedSpec> = {
  high_reach: 2, reach: 4, target: 5, likely: 4, safety: 2,
};
/** Minimum affordable likely/safety options when a budget is set. */
export const MIN_AFFORDABLE_LIKELY = 2;

export interface BorrowedPick {
  id: string;
  name: string;
  /** The college's real tier (from its odds). */
  from: Tier;
  /** The bucket it was placed in to fill a gap. */
  to: Tier;
}

export type BalancedListResult = BalancedList & {
  /** Plain-English notes on what's missing (e.g. no affordable safeties). */
  gaps: string[];
  /** Colleges placed in a neighboring bucket because their own tier had no room / the bucket was short. */
  borrowed: BorrowedPick[];
};

// ───────────────────────────── Ranking ─────────────────────────────

function isWanted(c: College, profile: StudentProfile): boolean {
  const wanted = Array.isArray(profile.wanted_colleges) ? profile.wanted_colleges : [];
  const names = [normName(c.name), normName(c.short)].filter(Boolean);
  return wanted.some((w) => {
    const n = normName(w);
    return n.length > 0 && names.some((x) => x === n || (n.length >= 6 && (x.includes(n) || n.includes(x))));
  });
}

function compareRanked(a: RankedCollege, b: RankedCollege): number {
  if (b.fit.total !== a.fit.total) return b.fit.total - a.fit.total;
  const an = normName(a.college.name);
  const bn = normName(b.college.name);
  if (an !== bn) return an < bn ? -1 : 1;
  const ai = String(a.college.id ?? "");
  const bi = String(b.college.id ?? "");
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

/** Keep one record per college (by id, else normalized name), preferring the most recently researched. */
function dedupe(colleges: College[]): College[] {
  const byKey = new Map<string, College>();
  for (const c of colleges) {
    if (!c || typeof c !== "object" || !c.name) continue;
    const key = normName(c.name) || String(c.id);
    const prev = byKey.get(key);
    if (!prev || String(c.researched_at ?? "") > String(prev.researched_at ?? "")) byKey.set(key, c);
  }
  return [...byKey.values()];
}

export function rankOne(college: College, profile: StudentProfile): RankedCollege {
  const odds = estimateOdds(college, profile);
  const price = estimateNetPrice(college, profile);
  const fit = scoreFit(college, profile, odds, price.value);
  const base: RankedCollege = {
    college,
    odds,
    fit,
    est_net_price: price.value,
    est_net_price_note: price.note,
    reasons: [],
    watchouts: [],
  };
  base.reasons = buildReasons(base, profile);
  base.watchouts = buildWatchouts(base, profile);
  return base;
}

export function rankColleges(colleges: College[], profile: StudentProfile): RankedCollege[] {
  const list = dedupe(Array.isArray(colleges) ? colleges : []);
  return list.map((c) => rankOne(c, profile)).sort(compareRanked);
}

// ───────────────────────────── Reasons & watchouts ─────────────────────────────

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildReasons(r: RankedCollege, profile: StudentProfile): string[] {
  const c = r.college;
  const out: string[] = [];
  const majors = cleanMajors(profile);
  const primary = majors[0]!;
  const budget = usd(profile.budget_per_year);

  if (isWanted(c, profile)) out.push("On your list of colleges you like");

  // Academics — only claim a program when research found it.
  if (primary !== "undecided") {
    const note = programFor(c, primary);
    const sh = shareFor(c, primary);
    if (note?.offered && note.degree) out.push(`Offers ${note.degree}`);
    else if (note?.offered) out.push(`Has a ${majorLabel(primary)} program`);
    else if (sh?.exact && sh.share >= 0.08) out.push(`Big in ${majorLabel(primary)} — about ${fmtPct(sh.share)} of grads`);
  } else if (r.fit.academics >= 0.75) {
    out.push("Wide range of majors — good if you're still deciding");
  }

  if (r.est_net_price != null && budget != null && budget > 0 && r.est_net_price <= budget) {
    out.push(`Est. ${fmtK(r.est_net_price)}/yr — within your budget`);
  } else if (r.est_net_price != null && budget == null && r.est_net_price <= 20000) {
    out.push(`Lower cost — est. ${fmtK(r.est_net_price)}/yr`);
  }

  const band = `${fmtPct(r.odds.low)}–${fmtPct(r.odds.high)}`;
  if (r.odds.tier === "safety" || r.odds.tier === "likely") out.push(`Good chance of getting in (about ${band})`);
  else if (r.odds.tier === "target") out.push(`Realistic target for your profile (about ${band})`);

  const grad = rate(c.grad_rate_6yr);
  const earn = usd(c.median_earnings_10yr);
  if (grad != null && grad >= 0.85) out.push(`Most students graduate (${fmtPct(grad)} within 6 years)`);
  else if (earn != null && earn >= 75000) out.push(`Grads earn about ${fmtK(earn)} ten years after starting`);

  if (c.ownership === "public" && isInState(c, profile) === true) out.push("In-state public — lower tuition for you");

  const loc = locationChecks(c, profile);
  if (loc.region === true && loc.setting === true) out.push("In a region and setting you picked");
  else if (loc.size === true && loc.setting === true) out.push("The size and setting you asked for");

  if (Array.isArray(c.scholarships) && c.scholarships.length && c.scholarships[0]?.name) {
    out.push(`Scholarships to look at, e.g. ${c.scholarships[0].name}`);
  }

  // Factual fallbacks so every college has at least two reasons.
  if (out.length < 2) {
    const kind = c.ownership === "public" ? "Public" : "Private";
    const where = [c.city, c.state].filter(Boolean).join(", ");
    out.push(`${kind} college${where ? ` in ${where}` : ""}`);
  }
  if (out.length < 2) {
    if (r.fit.outcomes >= 0.6) out.push("Solid graduation and earnings record");
    else if (r.fit.academics >= 0.6) out.push(`Reasonable match for ${majorLabel(primary)}`);
    else out.push(`Fit score ${Math.round(r.fit.total)} of 100 for your priorities`);
  }
  return [...new Set(out)].slice(0, 4);
}

function buildWatchouts(r: RankedCollege, profile: StudentProfile): string[] {
  const c = r.college;
  const out: string[] = [];
  const primary = cleanMajors(profile)[0]!;
  const budget = usd(profile.budget_per_year);

  if (c.test_policy === "required" && bestSat(profile) == null) out.push("Test-required and you haven't listed a score");

  if (r.est_net_price != null && budget != null && r.est_net_price > budget) {
    const over = r.est_net_price - budget;
    if (over >= 1000) out.push(`Over your budget by about ${fmtK(over)}/yr`);
  }

  const admit = rate(c.admit_rate);
  if (admit != null && admit < 0.15) out.push("Very selective — nobody is a sure admit");
  else if (r.odds.tier === "high_reach") out.push("A long shot with your current numbers");

  if (primary !== "undecided") {
    const note = programFor(c, primary);
    if (note && note.offered === false) out.push(`Doesn't appear to offer ${majorLabel(primary)}`);
    else if (isGatedMajor(c, primary)) out.push(`${cap(majorLabel(primary))} is a limited-entry major here`);
  }

  const loc = locationChecks(c, profile);
  if (loc.distance && !loc.distance.within) out.push(`About ${Math.round(loc.distance.miles / 50) * 50} miles from home — farther than you wanted`);
  else if (loc.region === false) out.push("Outside the regions you picked");
  if (loc.ownership === false) out.push(c.ownership === "public" ? "Public, and you preferred private" : "Private, and you preferred public");
  if (loc.size === false) out.push("Not the campus size you asked for");
  if (loc.setting === false) out.push("Not the setting you asked for");

  if (r.est_net_price == null) out.push("Cost data missing — check their net price calculator");
  else if (c.ownership === "public" && isInState(c, profile) === false && budget == null) {
    out.push("Out-of-state public — costs more for you");
  }

  if (r.odds.confidence === "low") out.push("Limited data — these numbers are rough estimates");

  return [...new Set(out)].slice(0, 3);
}

// ───────────────────────────── Balanced list ─────────────────────────────

/** Which neighboring buckets may lend colleges to fill a short bucket (nearest first). */
const NEIGHBORS: Readonly<Record<Tier, readonly Tier[]>> = {
  safety: ["likely"],
  likely: ["safety", "target"],
  target: ["likely", "reach"],
  reach: ["target", "high_reach"],
  high_reach: ["reach"],
};
/** Gap-filling order: the bottom of the list matters most. */
const FILL_ORDER: readonly Tier[] = ["safety", "likely", "target", "reach", "high_reach"];

function affordable(r: RankedCollege, budget: number): boolean {
  return r.est_net_price != null && r.est_net_price <= budget;
}

export function buildBalancedList(
  ranked: RankedCollege[],
  spec: Partial<BalancedSpec> = DEFAULT_BALANCED_SPEC,
  /** Family budget (USD/yr) or the profile — enables the "≥2 affordable likely/safety" rule. */
  budget?: number | null | Pick<StudentProfile, "budget_per_year">,
): BalancedListResult {
  const sorted = [...ranked].sort(compareRanked);
  const want: BalancedSpec = { ...DEFAULT_BALANCED_SPEC };
  for (const t of TIER_ORDER) {
    const v = spec?.[t];
    if (typeof v === "number" && Number.isFinite(v)) want[t] = Math.max(0, Math.floor(v));
  }
  const buckets: Record<Tier, RankedCollege[]> = { high_reach: [], reach: [], target: [], likely: [], safety: [] };
  const used = new Set<RankedCollege>();
  const borrowed: BorrowedPick[] = [];
  const gaps: string[] = [];

  // 1) Best-fit within each tier.
  for (const t of TIER_ORDER) {
    for (const r of sorted) {
      if (buckets[t].length >= want[t]) break;
      if (r.odds.tier === t && !used.has(r)) { buckets[t].push(r); used.add(r); }
    }
  }

  // 2) Fill short buckets from neighbors' leftovers (flagged).
  for (const t of FILL_ORDER) {
    for (const n of NEIGHBORS[t]) {
      for (const r of sorted) {
        if (buckets[t].length >= want[t]) break;
        if (r.odds.tier === n && !used.has(r)) {
          buckets[t].push(r);
          used.add(r);
          borrowed.push({ id: r.college.id, name: r.college.name, from: n, to: t });
        }
      }
    }
  }

  // 3) Affordable likely/safety options when a budget is set.
  const b = usd(typeof budget === "object" && budget !== null ? budget.budget_per_year : budget);
  if (b != null && b > 0) {
    const countAff = () => [...buckets.likely, ...buckets.safety].filter((r) => affordable(r, b)).length;
    const extras = sorted.filter((r) => !used.has(r) && (r.odds.tier === "likely" || r.odds.tier === "safety") && affordable(r, b));
    for (const r of extras) {
      if (countAff() >= MIN_AFFORDABLE_LIKELY) break;
      const t = r.odds.tier;
      const bucket = buckets[t];
      // Swap out the lowest-fit unaffordable pick in that bucket if it's full; else add.
      if (bucket.length >= want[t]) {
        for (let i = bucket.length - 1; i >= 0; i--) {
          if (!affordable(bucket[i]!, b)) {
            used.delete(bucket[i]!);
            bucket.splice(i, 1);
            break;
          }
        }
      }
      bucket.push(r);
      used.add(r);
      bucket.sort(compareRanked);
    }
    const n = countAff();
    if (n < MIN_AFFORDABLE_LIKELY) {
      gaps.push(
        n === 0
          ? `No likely or safety college is within your ${fmtK(b)}/yr budget yet — add an in-state public or a college with strong merit aid.`
          : `Only ${n} likely or safety college fits your ${fmtK(b)}/yr budget — add one or two more affordable options.`,
      );
    }
  }

  for (const t of TIER_ORDER) {
    const short = want[t] - buckets[t].length;
    if (short > 0) {
      const label = TIER_LABELS[t].toLowerCase();
      gaps.push(
        buckets[t].length === 0
          ? `No ${label} colleges yet${t === "safety" || t === "likely" ? " — add a college with a high admit rate you'd be happy to attend" : ""}.`
          : `Only ${buckets[t].length} ${label} college${buckets[t].length === 1 ? "" : "s"} (aim for ${want[t]}).`,
      );
    }
  }

  for (const t of TIER_ORDER) buckets[t].sort(compareRanked);
  return { ...buckets, gaps, borrowed };
}

// ───────────────────────────── AI summary ─────────────────────────────

export const AI_SUMMARY_MAX_CHARS = 1500;

export function summarizeListForAi(ranked: RankedCollege[], maxChars = AI_SUMMARY_MAX_CHARS): string {
  const sorted = [...ranked].sort(compareRanked);
  const header = `${sorted.length} colleges, best fit first (tier | odds band | fit/100 | est. net $/yr):`;
  const lines: string[] = [header];
  let len = header.length;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!;
    const c = r.college;
    const name = (c.short || c.name || "?").slice(0, 28);
    const price = r.est_net_price != null ? fmtK(r.est_net_price) : "?";
    const flags: string[] = [];
    if (r.watchouts[0]) flags.push(r.watchouts[0]);
    if (r.odds.confidence === "low" && !flags.some((f) => f.startsWith("Limited data"))) flags.push("low data");
    const line = `${i + 1}. ${name} (${c.state || "?"}) | ${TIER_LABELS[r.odds.tier]} | ${fmtPct(r.odds.low)}-${fmtPct(r.odds.high)} | ${Math.round(r.fit.total)} | ${price}${flags.length ? ` | ${flags.join("; ")}` : ""}`;
    const more = `… +${sorted.length - i} more`;
    if (len + 1 + line.length > maxChars - (i < sorted.length - 1 ? more.length + 1 : 0)) {
      if (len + 1 + more.length <= maxChars) lines.push(more);
      break;
    }
    lines.push(line);
    len += 1 + line.length;
  }
  return lines.join("\n").slice(0, maxChars);
}

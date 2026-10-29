/**
 * Deadline proof check: is each researched deadline actually on the college's own page?
 *
 * Research (ChatGPT) returns, per application plan, the page it read the date from (`source_url`) and
 * the sentence or table row with the date (`quote`). Deadlines drive reminders, so a wrong date is the
 * worst kind of error — this module fetches that page and looks for the date itself:
 *
 *   verified   the page is on the college's own domain and states the plan's month + day next to the
 *              quote (fuzzy) or next to the plan's name ("Early Action", "EA", …);
 *   mismatch   the page loaded but the date isn't on it (or not anywhere near the plan) — likely wrong;
 *   unchecked  nothing to check against: no page, a page off the college's domain, or a page that
 *              couldn't be read (blocked, timed out, not HTML, needs JavaScript). Honest, not an error.
 *
 * Pure logic plus an injected `fetch` (the app passes the platform's HTTP; see ./check.ts). Requests
 * are plain GETs with no cookies and nothing about the student. Pages are deduped per college, at most
 * `maxPages` distinct pages per college, `concurrency` fetches at a time across all colleges.
 */
import type { ApplicationPlan, College, DeadlineCheck, PlanKind } from "@/types";
import { parseDeadline } from "./deadlines";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface VerifyOptions {
  fetch: FetchLike;
  now?: () => Date;
  /** Per page. Default 8 s. */
  timeoutMs?: number;
  /** Per page. Default 2 MB of text. */
  maxBytes?: number;
  /** Distinct pages fetched per college. Default 3. */
  maxPages?: number;
  /** Fetches in flight at once (shared across colleges by default: 4). */
  limit?: <T>(task: () => Promise<T>) => Promise<T>;
  signal?: AbortSignal;
  /** Re-check plans that already carry a result. Default: only missing or retryable stale ones. */
  force?: boolean;
}

export const VERIFY_TIMEOUT_MS = 8_000;
export const VERIFY_MAX_BYTES = 2 * 1024 * 1024;
export const VERIFY_MAX_PAGES = 3;
export const VERIFY_CONCURRENCY = 4;
/** How close (characters of page text) the date must be to the quote or the plan's name. */
export const NEAR_CHARS = 300;
/** Fraction of the quote's words that must appear in a window of the page for a fuzzy quote match. */
export const QUOTE_OVERLAP = 0.8;
/** A transient failure is retried after this long. */
const RETRY_AFTER_MS = 24 * 3600_000;
const RETRYABLE = new Set(["fetch_failed", "timeout", "blocked"]);

// ───────────────────────────── concurrency ─────────────────────────────

export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= max) return;
    const run = queue.shift();
    if (run) run();
  };
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}

const sharedLimiter = createLimiter(VERIFY_CONCURRENCY);

// ───────────────────────────── domains ─────────────────────────────

/** Second-level labels under which a two-letter country code hosts registrations ("ac.uk", "edu.au"). */
const COUNTRY_SECOND = new Set(["ac", "co", "com", "edu", "gov", "net", "org"]);

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

/**
 * The college's registrable domain from its website: "https://www.gatech.edu/" → "gatech.edu",
 * "https://admissions.purdue.edu" → "purdue.edu", "https://www.ox.ac.uk" → "ox.ac.uk". Null when unusable.
 */
export function siteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const host = hostOf(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  if (!host || !host.includes(".") || /^[\d.]+$/.test(host)) return null;
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  const tld = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  const n = tld.length === 2 && COUNTRY_SECOND.has(second) && labels.length >= 3 ? 3 : 2;
  return labels.slice(-n).join(".");
}

/** True when `url` is https and its host is `domain` or a subdomain of it (never a look-alike like gatech.edu.evil.com). */
export function onSite(url: string, domain: string | null): boolean {
  if (!domain) return false;
  let host: string | null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    host = u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  return host === domain || host.endsWith(`.${domain}`);
}

/** "admission.gatech.edu" for display. */
export function displayHost(url: string): string {
  return (hostOf(url) ?? url).replace(/^www\./, "");
}

// ───────────────────────────── HTML → text ─────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML page: no script/style/noscript, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\s   ]+/g, " ")
    .trim();
}

/** A page whose markup carried no readable content (a JavaScript shell, an error stub). */
export function looksEmpty(text: string): boolean {
  if (text.length < 200) return true;
  return text.length < 800 && /enable javascript|requires javascript|javascript is (required|disabled)/i.test(text);
}

// ───────────────────────────── dates ─────────────────────────────

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Month and day of a stored deadline ("2026-11-02", "Nov 2", "11/2/2026"); null when it isn't a date. */
export function monthDay(deadline: string | null | undefined, now: Date): { month: number; day: number } | null {
  const key = parseDeadline(deadline, now);
  if (!key) return null;
  const [, m, d] = key.split("-").map(Number) as [number, number, number];
  return { month: m, day: d };
}

/**
 * Matches the common written forms of a month + day, with or without a year: "November 2", "Nov. 2",
 * "Nov 2", "November 2nd", "Nov 02", "2 November", "11/2", "11/02", "11/2/2026", "2026-11-02".
 */
export function dateRegex(month: number, day: number): RegExp {
  const full = MONTH_NAMES[month - 1]!;
  const abbr = full.slice(0, 3);
  const names = `(?:${full}|${abbr}t?\\.?)`; // "sept." too
  const dd = `0?${day}(?:st|nd|rd|th)?`;
  const m = `0?${month}`;
  // No lookbehind (older WebKit): group 1 is the one character before the date, re-matched by the caller.
  return new RegExp(
    [
      `\\b${names}\\s+${dd}(?!\\d)`, // November 2 / Nov. 2nd
      `(^|[^\\d])${dd}\\s+${names}\\b`, // 2 November
      `(^|[^\\d/])${m}/0?${day}(?:/\\d{2,4})?(?![\\d/])`, // 11/2, 11/02/2026
      `(^|[^\\d])\\d{4}-${m}-0?${day}(?!\\d)`, // 2026-11-02
    ].join("|"),
    "gi",
  );
}

/** Start offsets of every occurrence of the month + day in `text`. */
export function findDates(text: string, month: number, day: number): number[] {
  const out: number[] = [];
  const re = dateRegex(month, day);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const lead = m[1] ?? m[2] ?? m[3] ?? "";
    out.push(m.index + lead.length);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

// ───────────────────────────── plan names ─────────────────────────────

const PLAN_PATTERNS: Record<PlanKind, RegExp[]> = {
  EA: [/early action/gi, /\bEA\b/g],
  ED: [/early decision(?!\s*(?:ii|2)\b)/gi, /\bED\b(?!\s*(?:II|2)\b)/g],
  ED2: [/early decision\s*(?:ii|2)\b/gi, /\bED\s*(?:II|2)\b/g],
  REA: [/restrictive early action|single[- ]choice early action/gi, /\b(?:REA|SCEA)\b/g],
  RD: [/regular (?:decision|admission|deadline|action)/gi, /\bRD\b/g],
  Rolling: [/rolling/gi],
  Priority: [/priority/gi],
};

/** Start offsets of the plan's name on the page ("Early Action", "EA"; acronyms case-sensitively). */
export function findPlanName(text: string, plan: PlanKind): number[] {
  return planMentions(text, plan).map((m) => m.start);
}

interface Mention { plan: PlanKind; start: number; end: number }

function planMentions(text: string, plan: PlanKind): Mention[] {
  const out: Mention[] = [];
  for (const re of PLAN_PATTERNS[plan] ?? []) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      out.push({ plan, start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Characters between a date at `pos` and a mention (0 when inside it). */
function gap(pos: number, m: Mention): number {
  return pos < m.start ? m.start - pos : pos > m.end ? pos - m.end : 0;
}

/**
 * The plan whose name is nearest to the date at `pos` (any plan kind), with the distance — so a
 * date that sits next to "Early Action" is not claimed by a "Regular Decision" row further away
 * (on deadline tables the notification dates of one plan are close to the next plan's name).
 */
export function nearestPlan(text: string, pos: number, mentions?: Mention[]): { plan: PlanKind; distance: number } | null {
  const all = mentions ?? (Object.keys(PLAN_PATTERNS) as PlanKind[]).flatMap((k) => planMentions(text, k));
  let best: { plan: PlanKind; distance: number } | null = null;
  for (const m of all) {
    const d = gap(pos, m);
    if (!best || d < best.distance) best = { plan: m.plan, distance: d };
  }
  return best;
}

// ───────────────────────────── quotes ─────────────────────────────

interface Tokens { words: string[]; offsets: number[] }

function tokenize(s: string): Tokens {
  const words: string[] = [];
  const offsets: number[] = [];
  const re = /[a-z0-9]+/g;
  const lower = s.toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower))) {
    words.push(m[0]);
    offsets.push(m.index);
  }
  return { words, offsets };
}

/**
 * Where the quote appears on the page, as a character span — exact first (case, whitespace and
 * punctuation don't matter), else the best window of the same number of words that shares at least
 * `QUOTE_OVERLAP` of the quote's words. Null when the quote isn't there.
 */
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const q = tokenize(quote).words;
  if (!q.length) return null;
  const t = tokenize(text);
  const n = q.length;
  if (t.words.length < Math.max(1, Math.ceil(n * QUOTE_OVERLAP))) return null;
  const span = (i: number, len: number) => ({ start: t.offsets[i]!, end: t.offsets[i + len - 1]! + t.words[i + len - 1]!.length });

  // Exact word sequence.
  outer: for (let i = 0; i + n <= t.words.length; i++) {
    for (let j = 0; j < n; j++) if (t.words[i + j] !== q[j]) continue outer;
    return span(i, n);
  }
  if (n < 4) return null; // too short to match loosely without false positives

  // Fuzzy: a window of n page words sharing ≥ 80% of the quote's distinct words.
  const qset = new Set(q);
  const need = Math.ceil(qset.size * QUOTE_OVERLAP);
  let best: { i: number; hits: number } | null = null;
  const windowLen = Math.min(n + 2, t.words.length); // a little slack for words the page puts in between
  for (let i = 0; i + windowLen <= t.words.length; i++) {
    if (!qset.has(t.words[i]!)) continue;
    const seen = new Set<string>();
    for (let j = 0; j < windowLen; j++) {
      const w = t.words[i + j]!;
      if (qset.has(w)) seen.add(w);
    }
    if (seen.size >= need && (!best || seen.size > best.hits)) best = { i, hits: seen.size };
  }
  return best ? span(best.i, windowLen) : null;
}

// ───────────────────────────── judgement ─────────────────────────────

export type Judgement = { status: "verified" } | { status: "mismatch"; reason: "no_date" | "not_near_plan" };

/** How far (characters) outside the matched quote the date may still count as "in the quote". */
export const QUOTE_SLACK_CHARS = 40;

/**
 * Given a page's text, verified when the plan's month + day is on it in the plan's own context:
 * - inside the matched quote (± a few words) AND the nearest plan label to that date is this plan —
 *   or no plan label at all within `NEAR_CHARS` (a page that doesn't use the standard labels); a
 *   fuzzy quote match alone never decides, since a quote can loosely match a neighbouring table row;
 * - or within `NEAR_CHARS` of this plan's name and nearer to it than to any other plan's name.
 * Otherwise mismatch.
 */
export function judgePage(text: string, plan: Pick<ApplicationPlan, "plan" | "deadline" | "quote">, now: Date): Judgement | null {
  const md = monthDay(plan.deadline, now);
  if (!md) return null;
  const dates = findDates(text, md.month, md.day);
  if (!dates.length) return { status: "mismatch", reason: "no_date" };
  const mentions = (Object.keys(PLAN_PATTERNS) as PlanKind[]).flatMap((k) => planMentions(text, k));
  const claimedBy = (p: number) => {
    const near = nearestPlan(text, p, mentions);
    return !near || near.distance > NEAR_CHARS ? null : near.plan; // which plan's label the date sits next to
  };
  const q = plan.quote ? findQuote(text, plan.quote) : null;
  if (q) {
    for (const p of dates) {
      if (p < q.start - QUOTE_SLACK_CHARS || p > q.end + QUOTE_SLACK_CHARS) continue;
      const owner = claimedBy(p);
      if (owner === null || owner === plan.plan) return { status: "verified" };
    }
  }
  for (const p of dates) if (claimedBy(p) === plan.plan) return { status: "verified" };
  return { status: "mismatch", reason: "not_near_plan" };
}

// ───────────────────────────── fetching ─────────────────────────────

type Page = { ok: true; text: string } | { ok: false; reason: "timeout" | "fetch_failed" | "blocked" | "not_html" | "empty_page" | "off_site" | "aborted" };

async function fetchPage(url: string, domain: string, opts: VerifyOptions): Promise<Page> {
  if (opts.signal?.aborted) return { ok: false, reason: "aborted" };
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, opts.timeoutMs ?? VERIFY_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let res: Response;
    try {
      res = await opts.fetch(url, {
        method: "GET",
        headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" },
        credentials: "omit",
        redirect: "follow",
        signal: ctl.signal,
      });
    } catch {
      if (opts.signal?.aborted) return { ok: false, reason: "aborted" };
      return { ok: false, reason: timedOut ? "timeout" : "fetch_failed" };
    }
    // Followed a redirect off the college's domain. Web fetch reports the final URL; the iOS NativeHttp
    // plugin returns it too (nativeFetch sets Response.url). An empty url means no redirect was reported.
    if (res.url && res.url !== url && !onSite(res.url, domain)) return { ok: false, reason: "off_site" };
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 451) return { ok: false, reason: "blocked" };
    if (!res.ok) return { ok: false, reason: "fetch_failed" };
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type && !/html|xml|text\/plain/.test(type)) return { ok: false, reason: "not_html" };
    let body: string;
    try {
      body = await res.text();
    } catch {
      if (opts.signal?.aborted) return { ok: false, reason: "aborted" };
      return { ok: false, reason: timedOut ? "timeout" : "fetch_failed" };
    }
    const max = opts.maxBytes ?? VERIFY_MAX_BYTES;
    if (body.length > max) body = body.slice(0, max);
    const text = htmlToText(body);
    if (looksEmpty(text)) return { ok: false, reason: "empty_page" };
    return { ok: true, text };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

// ───────────────────────────── wording ─────────────────────────────

export interface CheckText {
  status: DeadlineCheck["status"];
  /** Plain words for the marker, e.g. "Checked on gatech.edu". */
  label: string;
  /** The page to open: the checked page, else the researcher's source page, else null. */
  url: string | null;
  host: string | null;
}

/** What to tell the student about a deadline's proof status. A plan with no result counts as unchecked. */
/** Anything carrying a plan's proof fields: an ApplicationPlan or a Deadline. */
export type ProofFields = { check?: DeadlineCheck | null; source_url?: string | null };

export function checkText(plan: ProofFields): CheckText {
  const c = plan.check;
  if (c?.status === "verified" && c.url) return { status: "verified", label: `Checked on ${c.host ?? displayHost(c.url)}`, url: c.url, host: c.host ?? displayHost(c.url) };
  if (c?.status === "mismatch" && c.url) {
    const host = c.host ?? displayHost(c.url);
    return { status: "mismatch", label: `Couldn't find this date on ${host} — confirm`, url: c.url, host };
  }
  const url = c?.url ?? plan.source_url ?? null;
  return { status: "unchecked", label: "Not checked — confirm on the college's site", url, host: url ? displayHost(url) : null };
}

// ───────────────────────────── per college ─────────────────────────────

/** Plans whose date still needs checking: a deadline with no result, or a transient failure older than a day. */
export function shouldCheck(plan: ApplicationPlan, now: Date, force = false): boolean {
  if (!plan.deadline) return false;
  if (force || !plan.check) return true;
  const c = plan.check;
  if (c.status !== "unchecked" || !c.reason || !RETRYABLE.has(c.reason)) return false;
  const at = Date.parse(c.checkedAt);
  return !Number.isFinite(at) || now.getTime() - at > RETRY_AFTER_MS;
}

/** True when any plan of the college still needs a check (what callers test before spending a fetch). */
export function needsDeadlineCheck(college: College, now: Date = new Date()): boolean {
  return (college.application?.plans ?? []).some((p) => shouldCheck(p, now));
}

/**
 * Check every deadline of a college against its proof page. Returns a new College with a `check` on
 * each plan that was checked; plans without a deadline are left alone. Never throws.
 */
export async function verifyCollegeDeadlines(college: College, opts: VerifyOptions): Promise<College> {
  const app = college.application;
  if (!app?.plans?.length) return college;
  const now = opts.now?.() ?? new Date();
  const checkedAt = now.toISOString();
  const domain = siteDomain(college.url);
  const limit = opts.limit ?? sharedLimiter;
  const pages = new Map<string, Promise<Page>>();
  const maxPages = opts.maxPages ?? VERIFY_MAX_PAGES;

  const getPage = (url: string): Promise<Page> | null => {
    let p = pages.get(url);
    if (!p) {
      if (pages.size >= maxPages) return null;
      p = limit(() => fetchPage(url, domain!, opts)).catch((): Page => ({ ok: false, reason: "fetch_failed" }));
      pages.set(url, p);
    }
    return p;
  };

  const plans = await Promise.all(
    app.plans.map(async (plan): Promise<ApplicationPlan> => {
      if (!shouldCheck(plan, now, opts.force)) return plan;
      const unchecked = (reason: string, withUrl = false): ApplicationPlan => ({
        ...plan,
        check: { status: "unchecked", reason, checkedAt, ...(withUrl && plan.source_url ? { url: plan.source_url, host: displayHost(plan.source_url) } : {}) },
      });
      if (!monthDay(plan.deadline, now)) return unchecked("no_date");
      if (!plan.source_url) return unchecked("no_source");
      if (!domain) return unchecked("no_site");
      if (!onSite(plan.source_url, domain)) return unchecked("off_site");
      if (opts.signal?.aborted) return plan;
      const pending = getPage(plan.source_url);
      if (!pending) return unchecked("too_many_pages", true);
      const page = await pending;
      if (!page.ok && page.reason === "aborted") return plan; // the caller gave up: leave it for next time
      if (!page.ok) return unchecked(page.reason, page.reason !== "off_site");
      const j = judgePage(page.text, plan, now);
      if (!j) return unchecked("no_date");
      const check: DeadlineCheck = { status: j.status, url: plan.source_url, host: displayHost(plan.source_url), checkedAt };
      if (j.status === "mismatch") check.reason = j.reason;
      return { ...plan, check };
    }),
  );
  return { ...college, application: { ...app, plans } };
}

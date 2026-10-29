/**
 * Deadline proof check against HTML modeled on real admissions pages:
 * Georgia Tech (EA1 Oct 15 for Georgia students, EA2 Nov 2 for everyone else, RD Jan 6),
 * WPI (ED I / EA Round I Nov 1, EA Round II / ED II Jan 5, RD Feb 1) and Purdue (EA Nov 1).
 */
import { describe, expect, it, vi } from "vitest";
import type { ApplicationPlan, College } from "@/types";
import { DEMO_COLLEGES } from "@/state/fixtures";
import { normalizeCollege } from "@/ai/normalize";
import { sharedResearchRecord, type SharedCollege } from "@/data/shared";
import {
  checkText, createLimiter, dateRegex, decodeEntities, findDates, findPlanName, findQuote, htmlToText, judgePage, looksEmpty, monthDay,
  needsDeadlineCheck, onSite, shouldCheck, siteDomain, verifyCollegeDeadlines, type FetchLike,
} from "./verify";

const NOW = new Date(2026, 9, 21, 14, 30);

// ───────────────────────────── fixtures ─────────────────────────────

const GATECH_HTML = `<!doctype html><html><head><title>Deadlines &amp; Decisions | Undergraduate Admission</title>
<script>window.dataLayer=[];</script><style>.x{color:red}</style></head>
<body><nav><a href="/">Home</a></nav>
<main><h1>First-Year Deadlines</h1>
<p>Georgia Tech offers two Early Action rounds and Regular Decision. Early Action 1 is&nbsp;for Georgia residents only.</p>
<table class="deadlines">
<thead><tr><th>Plan</th><th>Who</th><th>Application deadline</th><th>Decision release</th></tr></thead>
<tbody>
<tr><td>Early Action 1</td><td>Georgia students</td><td>October 15</td><td>Early December</td></tr>
<tr><td>Early Action 2</td><td>Non-Georgia students</td><td>November 2</td><td>Late January</td></tr>
<tr><td>Regular Decision</td><td>All students</td><td>January 6</td><td>Mid-March</td></tr>
</tbody></table>
<p>All materials are due by 11:59 p.m. ET on the deadline date.</p>
</main><footer>&copy; Georgia Institute of Technology</footer></body></html>`;

const WPI_HTML = `<html><body><h1>Application Deadlines</h1>
<table><tr><th>Plan</th><th>Deadline</th><th>Notification</th></tr>
<tr><td>Early Decision I</td><td>Nov. 1</td><td>Dec. 15</td></tr>
<tr><td>Early Action Round I</td><td>Nov. 1</td><td>Jan. 15</td></tr>
<tr><td>Early Action Round II</td><td>Jan. 5</td><td>Feb. 15</td></tr>
<tr><td>Early Decision II</td><td>Jan. 5</td><td>Feb. 15</td></tr>
<tr><td>Regular Decision</td><td>Feb. 1</td><td>April 1</td></tr>
</table></body></html>`;

const PURDUE_HTML = `<html><body><nav>Apply · Visit · Cost &amp; Aid · Majors · Contact</nav><h1>Application Deadlines &amp; Timeline</h1>
<p>Purdue uses the Common App and the Coalition App. First-year applicants choose one of two deadlines; both are considered for admission to the university and to the major listed first on the application.</p>
<h2>Deadlines</h2>
<ul><li><strong>Early Action:</strong> Apply by November 1st, 2026 for priority consideration for all majors and scholarships.</li>
<li><strong>Regular Decision:</strong> January 15</li></ul>
<p>Decisions are released on a rolling basis beginning in mid-December. Last updated 09/15/2026.</p></body></html>`;

const JS_SHELL = `<!doctype html><html><head><script src="/app.js"></script></head><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>`;

function plan(over: Partial<ApplicationPlan> & Pick<ApplicationPlan, "plan">): ApplicationPlan {
  return { deadline: null, ...over };
}

function college(url: string | null, plans: ApplicationPlan[]): College {
  const base = DEMO_COLLEGES[0]!;
  return { ...base, id: "t", url, application: { cycle: "Fall 2027 entry", plans, test_policy_note: null, essays_note: null, fee: null } };
}

/** A fetch that serves fixture pages by URL (status 200, text/html) and 404s the rest. */
function fetchOf(pages: Record<string, string | Response | (() => Promise<Response>)>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const f = async (url: string): Promise<Response> => {
    calls.push(url);
    const hit = pages[url];
    if (!hit) return new Response("not here", { status: 404 });
    if (typeof hit === "function") return hit();
    if (hit instanceof Response) return hit;
    return new Response(hit, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  };
  return Object.assign(f, { calls });
}

const GT = "https://admission.gatech.edu/first-year/deadlines";
const WPI = "https://www.wpi.edu/admissions/undergraduate/deadlines";
const PUR = "https://www.admissions.purdue.edu/apply/deadlines.php";

// ───────────────────────────── domains ─────────────────────────────

describe("siteDomain / onSite", () => {
  it("takes the registrable domain of the college's website", () => {
    expect(siteDomain("https://www.gatech.edu/")).toBe("gatech.edu");
    expect(siteDomain("https://admissions.purdue.edu")).toBe("purdue.edu");
    expect(siteDomain("gatech.edu")).toBe("gatech.edu");
    expect(siteDomain("https://www.ox.ac.uk/")).toBe("ox.ac.uk");
    expect(siteDomain(null)).toBeNull();
    expect(siteDomain("not a url")).toBeNull();
    expect(siteDomain("https://10.0.0.1/")).toBeNull();
  });

  it("accepts the domain and its subdomains, rejects look-alikes, other sites and http", () => {
    expect(onSite("https://admission.gatech.edu/deadlines", "gatech.edu")).toBe(true);
    expect(onSite("https://gatech.edu/", "gatech.edu")).toBe(true);
    expect(onSite("https://gatech.edu.evil.com/deadlines", "gatech.edu")).toBe(false);
    expect(onSite("https://notgatech.edu/", "gatech.edu")).toBe(false);
    expect(onSite("https://www.collegeboard.org/gatech", "gatech.edu")).toBe(false);
    expect(onSite("http://admission.gatech.edu/deadlines", "gatech.edu")).toBe(false);
    expect(onSite("https://admission.gatech.edu/", null)).toBe(false);
  });
});

// ───────────────────────────── text + dates ─────────────────────────────

describe("htmlToText", () => {
  it("drops script/style/noscript, decodes entities and collapses whitespace", () => {
    const t = htmlToText(GATECH_HTML);
    expect(t).not.toContain("dataLayer");
    expect(t).not.toContain("color:red");
    expect(t).toContain("Early Action 1 is for Georgia residents only.");
    expect(t).toContain("© Georgia Institute of Technology");
    expect(t).toContain("Early Action 2 Non-Georgia students November 2 Late January");
    expect(decodeEntities("Nov.&nbsp;2 &ndash; 11:59 &#112;.m. &#x45;T &unknown;")).toBe("Nov. 2 – 11:59 p.m. ET &unknown;");
  });

  it("recognises a JavaScript-only shell as empty", () => {
    expect(looksEmpty(htmlToText(JS_SHELL))).toBe(true);
    expect(looksEmpty(htmlToText(GATECH_HTML))).toBe(false);
  });
});

describe("dates", () => {
  it("reads month and day from the stored deadline forms", () => {
    expect(monthDay("2026-11-02", NOW)).toEqual({ month: 11, day: 2 });
    expect(monthDay("Nov 2", NOW)).toEqual({ month: 11, day: 2 });
    expect(monthDay("11/2/2026", NOW)).toEqual({ month: 11, day: 2 });
    expect(monthDay("Early November", NOW)).toBeNull();
    expect(monthDay(null, NOW)).toBeNull();
  });

  it("matches the common written forms with or without a year, and not other days", () => {
    const re = (s: string) => findDates(s, 11, 2).length;
    for (const s of ["November 2", "Nov. 2", "Nov 2", "November 2nd", "Nov 2nd, 2026", "November 02", "11/2", "11/02", "11/2/2026", "11/02/26", "2026-11-02", "2 November", "2nd Nov.", "Due NOVEMBER 2."]) {
      expect(re(s), s).toBe(1);
    }
    for (const s of ["November 20", "Nov. 21", "November 12", "11/20", "11/12", "1/11/2", "2026-11-20", "12 November", "Nov 2026", "11/2026"]) {
      expect(re(s), s).toBe(0);
    }
    expect(findDates("Sept. 1 and September 1st", 9, 1)).toHaveLength(2);
    expect(dateRegex(1, 5).test("Jan 5")).toBe(true);
    expect(findDates("11/5 and 1/5", 1, 5)).toHaveLength(1);
  });

  it("reports the date's own offset, not the character before it", () => {
    const text = "Apply by 11/2 please";
    expect(findDates(text, 11, 2)).toEqual([text.indexOf("11/2")]);
  });
});

describe("findPlanName", () => {
  it("finds plan names and acronyms without false positives", () => {
    const t = "Early Action and EA are the same; read about ED II and Regular Decision (RD). We read a lot.";
    expect(findPlanName(t, "EA")).toEqual([t.indexOf("Early Action"), t.indexOf("EA are")]);
    expect(findPlanName(t, "ED2")).toEqual([t.indexOf("ED II")]);
    expect(findPlanName(t, "ED")).toEqual([]); // "ED II" is not "ED"
    expect(findPlanName(t, "RD")).toEqual([t.indexOf("Regular Decision"), t.indexOf("RD)")]);
  });
});

describe("findQuote", () => {
  const text = htmlToText(GATECH_HTML);
  it("matches exactly regardless of case, punctuation and whitespace", () => {
    const span = findQuote(text, "early action 2 | non-georgia students | NOVEMBER 2");
    expect(span).not.toBeNull();
    expect(text.slice(span!.start, span!.end)).toBe("Early Action 2 Non-Georgia students November 2");
  });
  it("matches loosely when most of the words are there (≥ 80%)", () => {
    const span = findQuote(text, "Early Action 2 — non-Georgia students — November 2, 2026");
    expect(span).not.toBeNull();
    expect(text.slice(span!.start, span!.end)).toContain("November 2");
  });
  it("does not match a quote from another page", () => {
    expect(findQuote(text, "Regular Decision applications are due February 1 with notification in April")).toBeNull();
    expect(findQuote(text, "")).toBeNull();
    expect(findQuote(text, "Deadline Nov")).toBeNull(); // short quotes must match exactly
  });
});

// ───────────────────────────── judgement ─────────────────────────────

describe("judgePage", () => {
  const gt = htmlToText(GATECH_HTML);
  const wpi = htmlToText(WPI_HTML);
  const purdue = htmlToText(PURDUE_HTML);

  it("verifies a date next to its quote (table row) and next to the plan name", () => {
    expect(judgePage(gt, plan({ plan: "EA", deadline: "2026-11-02", quote: "Early Action 2 | Non-Georgia students | November 2" }), NOW)).toEqual({ status: "verified" });
    expect(judgePage(gt, plan({ plan: "RD", deadline: "2027-01-06" }), NOW)).toEqual({ status: "verified" }); // no quote: "Regular Decision … January 6"
    expect(judgePage(wpi, plan({ plan: "EA", deadline: "2026-11-01", quote: "Early Action Round I Nov. 1" }), NOW)).toEqual({ status: "verified" });
    expect(judgePage(wpi, plan({ plan: "ED2", deadline: "2027-01-05" }), NOW)).toEqual({ status: "verified" });
    expect(judgePage(purdue, plan({ plan: "EA", deadline: "2026-11-01", quote: "Early Action: Apply by November 1st, 2026" }), NOW)).toEqual({ status: "verified" }); // ordinal + year
  });

  it("verifies numeric and abbreviated forms", () => {
    expect(judgePage("Early Action deadline: 11/01/2026.", plan({ plan: "EA", deadline: "2026-11-01" }), NOW)).toEqual({ status: "verified" });
    expect(judgePage("EA: Nov. 1 · RD: Jan. 15", plan({ plan: "RD", deadline: "2027-01-15" }), NOW)).toEqual({ status: "verified" });
    expect(judgePage("Apply EA by 11/1.", plan({ plan: "EA", deadline: "Nov 1" }), NOW)).toEqual({ status: "verified" });
  });

  it("is a mismatch when the date is nowhere on the page", () => {
    // Georgia Tech EA given as Oct 15 is a real date on the page (EA1), so it verifies — the prompt, not
    // the verifier, must pick the right round. A date that is not there at all is caught:
    expect(judgePage(gt, plan({ plan: "EA", deadline: "2026-11-01", quote: "Early Action 2 November 1" }), NOW)).toEqual({ status: "mismatch", reason: "no_date" });
    expect(judgePage(wpi, plan({ plan: "RD", deadline: "2027-01-20" }), NOW)).toEqual({ status: "mismatch", reason: "no_date" });
  });

  it("does not let a plan claim a date that sits next to another plan's name (WPI's EA notification Jan. 15 is not an RD deadline)", () => {
    expect(judgePage(wpi, plan({ plan: "RD", deadline: "2027-01-15" }), NOW)).toEqual({ status: "mismatch", reason: "not_near_plan" });
    // WPI EA given as Jan 5 (that is Round II) is a date on the page next to "Early Action", so it passes — the
    // prompt asks for the earliest round; the verifier only proves the date is really the college's.
    expect(judgePage(wpi, plan({ plan: "EA", deadline: "2027-01-05" }), NOW)).toEqual({ status: "verified" });
  });

  it("is a mismatch when the date is on the page but far from the quote and the plan name", () => {
    const far = `Early Action applications are due in the fall. ${"Lorem ipsum dolor sit amet. ".repeat(20)} Campus tours resume November 2.`;
    expect(judgePage(far, plan({ plan: "EA", deadline: "2026-11-02", quote: "Early Action applications are due November 2" }), NOW)).toEqual({ status: "mismatch", reason: "not_near_plan" });
  });

  it("returns null for a deadline that isn't a date", () => {
    expect(judgePage(gt, plan({ plan: "Rolling", deadline: "Rolling" }), NOW)).toBeNull();
  });
});

// ───────────────────────────── verifyCollegeDeadlines ─────────────────────────────

describe("verifyCollegeDeadlines", () => {
  const opts = (fetch: FetchLike, extra: Partial<Parameters<typeof verifyCollegeDeadlines>[1]> = {}) => ({ fetch, now: () => NOW, limit: createLimiter(4), ...extra });

  it("marks each plan verified / mismatch / unchecked and records the page", async () => {
    const fetch = fetchOf({ [GT]: GATECH_HTML });
    const c = college("https://www.gatech.edu/", [
      plan({ plan: "EA", deadline: "2026-11-02", source_url: GT, quote: "Early Action 2 Non-Georgia students November 2", notes: "EA2 (non-Georgia)" }),
      plan({ plan: "RD", deadline: "2027-01-15", source_url: GT, quote: "Regular Decision January 15" }), // wrong: page says Jan 6
      plan({ plan: "ED", deadline: "2026-11-01" }), // no page
      plan({ plan: "Rolling", deadline: null }),
    ]);
    const out = await verifyCollegeDeadlines(c, opts(fetch));
    const [ea, rd, ed, rolling] = out.application!.plans;
    expect(ea!.check).toEqual({ status: "verified", url: GT, host: "admission.gatech.edu", checkedAt: NOW.toISOString() });
    expect(rd!.check).toEqual({ status: "mismatch", reason: "no_date", url: GT, host: "admission.gatech.edu", checkedAt: NOW.toISOString() });
    expect(ed!.check).toEqual({ status: "unchecked", reason: "no_source", checkedAt: NOW.toISOString() });
    expect(rolling!.check).toBeUndefined();
    expect(fetch.calls).toEqual([GT]); // one page, fetched once for both plans
    expect(c.application!.plans[0]!.check).toBeUndefined(); // input untouched
  });

  it("rejects proof pages off the college's domain and look-alike domains without fetching", async () => {
    const fetch = fetchOf({});
    const c = college("https://www.gatech.edu/", [
      plan({ plan: "EA", deadline: "2026-11-02", source_url: "https://www.collegevine.com/gatech-deadlines" }),
      plan({ plan: "RD", deadline: "2027-01-06", source_url: "https://gatech.edu.evil.com/deadlines" }),
      plan({ plan: "ED", deadline: "2026-11-01", source_url: "https://admission.gatech.edu/x" }),
    ]);
    const out = await verifyCollegeDeadlines(c, opts(fetch));
    expect(out.application!.plans[0]!.check).toMatchObject({ status: "unchecked", reason: "off_site" });
    expect(out.application!.plans[0]!.check!.url).toBeUndefined();
    expect(out.application!.plans[1]!.check).toMatchObject({ status: "unchecked", reason: "off_site" });
    expect(out.application!.plans[2]!.check).toMatchObject({ status: "unchecked", reason: "fetch_failed", url: "https://admission.gatech.edu/x" }); // 404
    expect(fetch.calls).toEqual(["https://admission.gatech.edu/x"]);
  });

  it("accepts a subdomain of the college's site and uses the Scorecard-style URL", async () => {
    const fetch = fetchOf({ [PUR]: PURDUE_HTML });
    const c = college("https://www.purdue.edu/", [plan({ plan: "EA", deadline: "2026-11-01", source_url: PUR, quote: "Early Action: Apply by November 1st, 2026" })]);
    const out = await verifyCollegeDeadlines(c, opts(fetch));
    expect(out.application!.plans[0]!.check).toMatchObject({ status: "verified", host: "admissions.purdue.edu" });
  });

  it("is unchecked without a college website, on a timeout, on a block, for non-HTML and for a JavaScript shell", async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    const slow = college("https://www.wpi.edu", [plan({ plan: "EA", deadline: "2026-11-01", source_url: WPI })]);
    const t = await verifyCollegeDeadlines(slow, opts(hang, { timeoutMs: 20 }));
    expect(t.application!.plans[0]!.check).toMatchObject({ status: "unchecked", reason: "timeout", url: WPI, host: "wpi.edu" });

    const blocked = fetchOf({ [WPI]: new Response("", { status: 403 }) });
    expect((await verifyCollegeDeadlines(slow, opts(blocked))).application!.plans[0]!.check).toMatchObject({ status: "unchecked", reason: "blocked" });

    const pdf = fetchOf({ [WPI]: new Response("%PDF-1.7", { status: 200, headers: { "Content-Type": "application/pdf" } }) });
    expect((await verifyCollegeDeadlines(slow, opts(pdf))).application!.plans[0]!.check).toMatchObject({ status: "unchecked", reason: "not_html" });

    const shell = fetchOf({ [WPI]: JS_SHELL });
    expect((await verifyCollegeDeadlines(slow, opts(shell))).application!.plans[0]!.check).toMatchObject({ status: "unchecked", reason: "empty_page" });

    const thrown: FetchLike = async () => { throw new TypeError("Failed to fetch"); }; // CORS on the web
    expect((await verifyCollegeDeadlines(slow, opts(thrown))).application!.plans[0]!.check).toMatchObject({ status: "unchecked", reason: "fetch_failed" });

    const noSite = college(null, [plan({ plan: "EA", deadline: "2026-11-01", source_url: WPI })]);
    const fetch = fetchOf({ [WPI]: WPI_HTML });
    expect((await verifyCollegeDeadlines(noSite, opts(fetch))).application!.plans[0]!.check).toMatchObject({ status: "unchecked", reason: "no_site" });
    expect(fetch.calls).toEqual([]);
  });

  it("leaves plans alone when the caller aborts", async () => {
    const ctl = new AbortController();
    const hang: FetchLike = (_url, init) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    const c = college("https://www.wpi.edu", [plan({ plan: "EA", deadline: "2026-11-01", source_url: WPI })]);
    const p = verifyCollegeDeadlines(c, opts(hang, { signal: ctl.signal }));
    ctl.abort();
    expect((await p).application!.plans[0]!.check).toBeUndefined();
  });

  it("fetches at most three distinct pages per college and dedupes them", async () => {
    const pages: Record<string, string> = {};
    const plans: ApplicationPlan[] = [];
    const kinds = ["ED", "EA", "ED2", "RD", "Priority"] as const;
    kinds.forEach((k, i) => {
      const url = `https://www.wpi.edu/p${i % 4}`;
      pages[url] = WPI_HTML;
      plans.push(plan({ plan: k, deadline: "2026-11-01", source_url: url }));
    });
    const fetch = fetchOf(pages);
    const out = await verifyCollegeDeadlines(college("https://www.wpi.edu", plans), opts(fetch));
    expect(new Set(fetch.calls).size).toBe(3);
    expect(out.application!.plans[3]!.check).toMatchObject({ status: "unchecked", reason: "too_many_pages" });
    expect(out.application!.plans[4]!.check!.status).not.toBe("unchecked"); // p0 again: already fetched
  });

  it("runs at most `concurrency` fetches at a time", async () => {
    let active = 0;
    let peak = 0;
    const fetch: FetchLike = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return new Response(WPI_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    };
    const limit = createLimiter(2);
    const colleges = Array.from({ length: 4 }, (_, i) => college("https://www.wpi.edu", [plan({ plan: "EA", deadline: "2026-11-01", source_url: `https://www.wpi.edu/c${i}` })]));
    await Promise.all(colleges.map((c) => verifyCollegeDeadlines(c, { fetch, now: () => NOW, limit })));
    expect(peak).toBe(2);
  });

  it("skips plans that already have a result unless the failure is transient and a day old", () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    expect(shouldCheck(plan({ plan: "EA", deadline: "2026-11-01" }), NOW)).toBe(true);
    expect(shouldCheck(plan({ plan: "EA", deadline: null }), NOW)).toBe(false);
    expect(shouldCheck(plan({ plan: "EA", deadline: "2026-11-01", check: { status: "verified", url: WPI, checkedAt: at(0) } }), NOW)).toBe(false);
    expect(shouldCheck(plan({ plan: "EA", deadline: "2026-11-01", check: { status: "mismatch", url: WPI, checkedAt: at(0) } }), NOW)).toBe(false);
    expect(shouldCheck(plan({ plan: "EA", deadline: "2026-11-01", check: { status: "unchecked", reason: "off_site", checkedAt: at(0) } }), NOW)).toBe(false);
    expect(shouldCheck(plan({ plan: "EA", deadline: "2026-11-01", check: { status: "unchecked", reason: "fetch_failed", checkedAt: at(3600_000) } }), NOW)).toBe(false);
    expect(shouldCheck(plan({ plan: "EA", deadline: "2026-11-01", check: { status: "unchecked", reason: "timeout", checkedAt: at(25 * 3600_000) } }), NOW)).toBe(true);
    expect(shouldCheck(plan({ plan: "EA", deadline: "2026-11-01", check: { status: "verified", url: WPI, checkedAt: at(0) } }), NOW, true)).toBe(true);
    expect(needsDeadlineCheck(college("https://www.wpi.edu", [plan({ plan: "EA", deadline: "2026-11-01", check: { status: "verified", url: WPI, checkedAt: at(0) } })]), NOW)).toBe(false);
    expect(needsDeadlineCheck(DEMO_COLLEGES[0]!, NOW)).toBe(true);
  });

  it("never throws when fetch misbehaves", async () => {
    const weird: FetchLike = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: () => { throw new Error("boom"); }, url: "" }) as unknown as Response;
    const c = college("https://www.wpi.edu", [plan({ plan: "EA", deadline: "2026-11-01", source_url: WPI })]);
    expect((await verifyCollegeDeadlines(c, opts(weird))).application!.plans[0]!.check).toMatchObject({ status: "unchecked", reason: "fetch_failed" });
    const spy = vi.fn();
    await verifyCollegeDeadlines(c, opts(weird)).then(spy);
    expect(spy).toHaveBeenCalled();
  });
});

describe("shared research → local check", () => {
  it("re-checks a shared row's deadline on this device: a bogus shared 'verified' for a date not on the page ends up mismatch", async () => {
    const page = WPI;
    const row: SharedCollege = {
      unitid: "1", name: "Worcester Polytechnic Institute", city: "Worcester", state: "MA", lat: null, lon: null, locale: null, url: "https://www.wpi.edu", undergrad_size: 5000,
      hbcu: false, women_only: false, religious: false, stats: null,
      research: [{ cycle: "Fall 2027", data: { application: { cycle: "Fall 2027 entry", plans: [
        { plan: "EA", deadline: "2027-01-05", source_url: page, quote: "Early Action Round II Jan. 5", check: { status: "verified", url: page, host: "wpi.edu", checkedAt: "2026-10-01T00:00:00.000Z" } }, // on the page (Round II) → verifies here too
        { plan: "RD", deadline: "2027-01-20", source_url: page, quote: "Regular Decision Jan. 20", check: { status: "verified", url: page, host: "wpi.edu", checkedAt: "2026-10-01T00:00:00.000Z" } }, // tampered: not on the page
      ], test_policy_note: null, essays_note: null, fee: null } }, verified_count: 1, researched_at: "2026-10-01T00:00:00Z", stale_after: "2099-01-01T00:00:00Z" }],
      programs: [],
    };
    const rec = sharedResearchRecord(row, "Fall 2027 entry", [], Date.parse("2026-10-21T00:00:00Z"))!;
    const c = normalizeCollege(rec.raw, { cycle: "Fall 2027 entry", now: NOW })!;
    expect(c.application!.plans.every((p) => p.check === undefined)).toBe(true);
    expect(needsDeadlineCheck(c, NOW)).toBe(true);
    const out = await verifyCollegeDeadlines(c, { fetch: fetchOf({ [page]: WPI_HTML }), now: () => NOW, limit: createLimiter(4) });
    expect(out.application!.plans[0]!.check).toMatchObject({ status: "verified", host: "wpi.edu" });
    expect(out.application!.plans[1]!.check).toMatchObject({ status: "mismatch", reason: "no_date", host: "wpi.edu" });
  });
});

describe("checkText", () => {
  it("words each status for the student", () => {
    expect(checkText({ check: { status: "verified", url: GT, host: "admission.gatech.edu", checkedAt: "2026-10-21T00:00:00Z" } })).toEqual({ status: "verified", label: "Checked on admission.gatech.edu", url: GT, host: "admission.gatech.edu" });
    expect(checkText({ check: { status: "mismatch", url: GT, checkedAt: "2026-10-21T00:00:00Z" } }).label).toBe("Couldn't find this date on admission.gatech.edu — confirm");
    expect(checkText({ check: { status: "unchecked", reason: "fetch_failed", url: GT, checkedAt: "2026-10-21T00:00:00Z" } })).toMatchObject({ status: "unchecked", label: "Not checked — confirm on the college's site", url: GT });
    expect(checkText({ source_url: WPI })).toMatchObject({ status: "unchecked", url: WPI, host: "wpi.edu" });
    expect(checkText({})).toEqual({ status: "unchecked", label: "Not checked — confirm on the college's site", url: null, host: null });
  });
});

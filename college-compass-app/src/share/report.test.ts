import { describe, expect, it } from "vitest";
import type { BalancedList, College, RankedCollege, StudentProfile } from "@/types";
import { rankColleges, rankOne, buildBalancedList, TIER_ORDER } from "@/engine";
import { DEMO_COLLEGES, DEMO_PROFILE } from "@/state/fixtures";
import { DEFAULT_REPORT_OPTIONS, REPORT_DISCLAIMER, buildReportHtml, esc, reportFileName, ymd } from "./report";
import { AI_NOTICE_FULL, AI_NOTICE_SHORT } from "@/legal/notice";

const DATE = new Date(2026, 9, 20, 15, 30); // Oct 20, 2026, local time

function demo() {
  const ranked = rankColleges(DEMO_COLLEGES, DEMO_PROFILE);
  const balanced = buildBalancedList(ranked, undefined, DEMO_PROFILE);
  const picks: BalancedList = { high_reach: balanced.high_reach, reach: balanced.reach, target: balanced.target, likely: balanced.likely, safety: balanced.safety };
  const used = new Set(TIER_ORDER.flatMap((t) => picks[t]));
  const others = ranked.filter((r) => !used.has(r));
  return { ranked, picks, others };
}

function emptyList(): BalancedList {
  return { high_reach: [], reach: [], target: [], likely: [], safety: [] };
}

/** Strip tags so assertions can look at visible text only. */
function text(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

describe("esc", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(esc(`<b>"Tom" & 'Jerry'</b>`)).toBe("&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;");
    expect(esc(null)).toBe("");
    expect(esc(42)).toBe("42");
  });
});

describe("reportFileName", () => {
  it("builds 'College list - <name> - YYYY-MM-DD.pdf'", () => {
    expect(reportFileName("Robotics Northeast", DATE)).toBe("College list - Robotics Northeast - 2026-10-20.pdf");
    expect(ymd(DATE)).toBe("2026-10-20");
  });

  it("strips characters that are unsafe in file names and collapses whitespace", () => {
    expect(reportFileName('  Fall/2027: "best" <picks>?  ', DATE)).toBe("College list - Fall 2027 best picks - 2026-10-20.pdf");
    expect(reportFileName("a\u0000b\tc", DATE)).toBe("College list - a b c - 2026-10-20.pdf");
  });

  it("falls back to a plain name when the list has none and caps very long names", () => {
    expect(reportFileName("", DATE)).toBe("College list - 2026-10-20.pdf");
    expect(reportFileName("College list", DATE)).toBe("College list - 2026-10-20.pdf");
    expect(reportFileName(undefined, DATE)).toBe("College list - 2026-10-20.pdf");
    const long = reportFileName("x".repeat(200), DATE);
    expect(long.length).toBeLessThan(100);
    expect(long.endsWith(" - 2026-10-20.pdf")).toBe(true);
  });
});

describe("buildReportHtml: document", () => {
  const { picks, others } = demo();

  it("is a complete self-contained document with the list name, student, date and disclaimer", () => {
    const html = buildReportHtml({ listName: "Robotics Northeast", profile: DEMO_PROFILE, balanced: picks, others, generatedAt: DATE });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Robotics Northeast — Tierwise</title>");
    expect(html).toContain("<h1>Robotics Northeast</h1>");
    expect(html).toContain("Prepared for Demo");
    expect(html).toContain("Fall 2027 entry");
    expect(html).toContain("Prepared October 20, 2026 with Tierwise");
    expect(html).toContain(esc(REPORT_DISCLAIMER));
    // Self-contained: no external resources or scripts.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/@import|url\(/);
  });

  it("closes with the AI-assistance notice in full, and the short line as the footer", () => {
    const html = buildReportHtml({ listName: "Robotics Northeast", profile: DEMO_PROFILE, balanced: picks, others, generatedAt: DATE });
    const about = html.slice(html.indexOf('<section class="about">'), html.indexOf("</section>", html.indexOf('<section class="about">')));
    expect(about).toContain("<b>About Tierwise.</b> " + esc(AI_NOTICE_FULL));
    expect(about).toContain("College Board, ACT, or the Common Application.");
    // Once in full, not repeated; the explanatory paragraphs stay.
    expect(about.split("AI can make mistakes.").length).toBe(2);
    expect(about).toContain("<b>How to read this.</b>");
    expect(about).toContain("<b>Costs.</b>");
    expect(about).toContain("<b>Sources.</b>");
    expect(REPORT_DISCLAIMER).toBe(AI_NOTICE_SHORT);
    expect(html).toContain(`<footer class="end">${esc(AI_NOTICE_SHORT)}</footer>`);
    // Prints well: college blocks never split across pages.
    expect(html).toContain("break-inside: avoid");
  });

  it("falls back to 'College list' when the list has no name and omits the student line when unnamed", () => {
    const html = buildReportHtml({ listName: "  ", profile: { ...DEMO_PROFILE, name: undefined }, balanced: picks, generatedAt: DATE });
    expect(html).toContain("<h1>College list</h1>");
    expect(html).not.toContain("Prepared for");
  });

  it("groups colleges by tier in the app's order with the tier labels and counts", () => {
    const html = buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: picks, generatedAt: DATE });
    const order = TIER_ORDER.filter((t) => picks[t].length > 0);
    expect(order.length).toBeGreaterThan(2);
    const positions = order.map((t) => html.indexOf(`data-tier="${t}"`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain("<h2>High reach <span");
    expect(html).toContain(`estimated chance under 15% · ${picks.high_reach.length}`);
    // Each college sits inside its own tier section.
    for (const t of order) {
      const start = html.indexOf(`data-tier="${t}"`);
      const end = html.indexOf("</section>", start);
      for (const r of picks[t]) {
        const at = html.indexOf(`<h3>${esc(r.college.name)}`);
        expect(at).toBeGreaterThan(start);
        expect(at).toBeLessThan(end);
      }
    }
  });

  it("shows per-college facts: chance band, admit rate, SAT range, test policy, cost, plans, programs, reasons", () => {
    const html = buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: picks, generatedAt: DATE });
    const mit = picks.high_reach.find((r) => r.college.short === "MIT") ?? demo().ranked.find((r) => r.college.short === "MIT")!;
    const band = `${Math.round(mit.odds.low * 100)}–${Math.round(mit.odds.high * 100)}%`;
    const t = text(html);
    expect(t).toContain("Massachusetts Institute of Technology");
    expect(t).toContain("Cambridge, MA · Private · 4,600 undergrads");
    expect(t).toContain(band);
    expect(t).toContain("1520–1580");
    expect(t).toContain("Tests required");
    expect(t).toContain("$85,960");
    expect(t).toContain("Early Action Nov 1, 2026");
    expect(t).toContain("Regular Decision Jan 6, 2027");
    expect(t).toContain("S.B. in Computer Science and Engineering (6-3)");
    expect(t).toContain("Declare any major in spring of first year");
    expect(t).toContain("Why it's here");
    expect(t).toContain("Watch out");
  });

  it("marks shortlisted colleges and nothing else", () => {
    const first = picks.target[0] ?? picks.reach[0];
    const html = buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: picks, shortlist: [first.college.id], generatedAt: DATE });
    expect(html.match(/&#9733; Shortlisted/g)?.length).toBe(1);
    const at = html.indexOf(`<h3>${esc(first.college.name)}`);
    expect(html.indexOf("&#9733; Shortlisted", at) - at).toBeLessThan(200);
    expect(buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: picks, generatedAt: DATE })).not.toContain("Shortlisted");
  });

  it("renders an empty list honestly", () => {
    const html = buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: emptyList(), generatedAt: DATE });
    expect(html).toContain("No colleges on this list yet.");
    expect(html).toContain("0 colleges");
  });
});

describe("buildReportHtml: options", () => {
  const { picks, others } = demo();

  it("defaults: grades on, budget off, notes on, others off", () => {
    expect(DEFAULT_REPORT_OPTIONS).toEqual({ grades: true, budget: false, notes: true, others: false });
  });

  it("grades on: GPA, SAT, AP/IB and class rank; grades off: none of them", () => {
    const on = text(buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: picks, generatedAt: DATE }, { grades: true }));
    expect(on).toContain("GPA 3.8 unweighted · 4.3 weighted");
    expect(on).toContain("SAT 1420");
    expect(on).toContain("AP / IB courses 7");
    expect(on).toContain("Class rank Top 10%");
    const off = text(buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: picks, generatedAt: DATE }, { grades: false }));
    expect(off).not.toContain("GPA 3.8");
    expect(off).not.toContain("3.8 unweighted");
    expect(off).not.toContain("1420");
    expect(off).not.toContain("AP / IB");
    expect(off).not.toContain("Class rank");
    expect(off).not.toContain("Top 10%");
    // Non-grade snapshot rows stay.
    expect(off).toContain("Intended majors Computer science, Film & media");
    expect(off).toContain("Home state North Carolina");
    expect(off).toContain("Regions South Atlantic, Mid-Atlantic, Midwest");
  });

  it("budget off (default) hides budget, income and every student-specific net price; shows the federal average instead", () => {
    const html = buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: picks, others, generatedAt: DATE });
    const t = text(html);
    expect(t).not.toContain("Family budget");
    expect(t).not.toContain("$30,000 after aid");
    expect(t).not.toContain("Family income");
    expect(t).not.toContain("$75k – $110k");
    expect(t).not.toContain("families earning");
    expect(t).not.toContain("your budget");
    expect(t).not.toContain("Est. net price");
    expect(t).toContain("Avg. net price / yr (all families)");
    for (const r of TIER_ORDER.flatMap((x) => picks[x])) {
      if (r.est_net_price != null && r.est_net_price !== r.college.avg_net_price) {
        expect(t).not.toContain(`$${Math.round(r.est_net_price).toLocaleString("en-US")}`);
      }
      if (r.college.avg_net_price != null) expect(t).toContain(`$${r.college.avg_net_price.toLocaleString("en-US")}`);
    }
  });

  it("budget on shows budget, income band and the student's estimated net price with its note", () => {
    const html = buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: picks, generatedAt: DATE }, { budget: true });
    const t = text(html);
    expect(t).toContain("Family budget / yr $30,000 after aid");
    expect(t).toContain("Family income $75k – $110k");
    expect(t).toContain("Est. net price / yr");
    const mit = TIER_ORDER.flatMap((x) => picks[x]).find((r) => r.college.short === "MIT")!;
    expect(mit.est_net_price).not.toBeNull();
    expect(t).toContain(`$${Math.round(mit.est_net_price!).toLocaleString("en-US")}`);
    expect(t).toContain(mit.est_net_price_note);
  });

  it("notes on includes the student's note (escaped, newlines kept); notes off omits it", () => {
    const r = picks.target[0] ?? picks.reach[0];
    const notes = { [r.college.id]: "Loved the <robotics> lab & the honors college.\nAsk about merit aid." };
    const on = buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: picks, notes, generatedAt: DATE }, { notes: true });
    expect(on).toContain("Student's note");
    expect(on).toContain("Loved the &lt;robotics&gt; lab &amp; the honors college.\nAsk about merit aid.");
    expect(on).not.toContain("<robotics>");
    const off = buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: picks, notes, generatedAt: DATE }, { notes: false });
    expect(off).not.toContain("Student's note");
    expect(off).not.toContain("robotics&gt; lab");
  });

  it("others off (default) omits the extra table; others on lists them compactly", () => {
    const extra = picks.likely.slice(0, 1).concat(others);
    const trimmed: BalancedList = { ...picks, likely: picks.likely.slice(1) };
    const off = buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: trimmed, others: extra, generatedAt: DATE });
    expect(off).not.toContain("Other colleges researched");
    expect(off).not.toContain(esc(extra[0].college.name));
    const on = buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: trimmed, others: extra, generatedAt: DATE }, { others: true });
    expect(on).toContain(`Other colleges researched <span class="range">not in the balanced picks · ${extra.length}</span>`);
    expect(on).toContain('<table class="compact">');
    expect(on).toContain(`<td>${esc(extra[0].college.name)}</td>`);
    expect(on).toContain("Avg. net price / yr</th>");
    const budget = buildReportHtml({ listName: "L", profile: DEMO_PROFILE, balanced: trimmed, others: extra, generatedAt: DATE }, { others: true, budget: true });
    expect(budget).toContain("Est. net price / yr</th>");
  });
});

describe("buildReportHtml: escaping", () => {
  it("escapes every piece of student and AI text", () => {
    const hostile: College = {
      ...DEMO_COLLEGES[0],
      id: "x1",
      name: `Evil <script>alert("x")</script> & Sons`,
      short: "Evil",
      city: `<City>`,
      application: { cycle: "Fall 2027 entry", plans: [{ plan: "EA", deadline: `<Nov> 1`, notes: `a & "b"` }], test_policy_note: null, essays_note: null, fee: null },
      programs: [{ major: "computer_science", offered: true, degree: `B.S. <CS>`, how_to_enter: `declare & go`, notes: null }],
    };
    const profile: StudentProfile = { ...DEMO_PROFILE, name: `<Ann> & Co` };
    const r: RankedCollege = { ...rankOne(hostile, profile), reasons: [`<why>`], watchouts: [`<watch> & out`] };
    const balanced = emptyList();
    balanced[r.odds.tier].push(r);
    const html = buildReportHtml({ listName: `My <list> & "stuff"`, profile, balanced, shortlist: ["x1"], notes: { x1: `<note>` }, generatedAt: DATE }, { notes: true });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<City>");
    expect(html).not.toContain("<Nov>");
    expect(html).not.toContain("<CS>");
    expect(html).not.toContain("<why>");
    expect(html).not.toContain("<watch>");
    expect(html).not.toContain("<note>");
    expect(html).not.toContain("<Ann>");
    expect(html).not.toContain("<list>");
    expect(html).toContain("Evil &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Sons");
    expect(html).toContain("<title>My &lt;list&gt; &amp; &quot;stuff&quot; — Tierwise</title>");
    expect(html).toContain("Prepared for &lt;Ann&gt;");
    expect(html).toContain("B.S. &lt;CS&gt; — declare &amp; go");
    expect(html).toContain("&lt;watch&gt; &amp; out");
  });
});

import { describe, expect, it } from "vitest";
import { extractJsonObject, namesMatch, normalizeCollege, normalizeName, shortName, toDeadline, toNumber, toPlanKind, toRate } from "./normalize";
import { rawCollege } from "./test-helpers";

const NOW = new Date("2026-10-16T12:00:00Z");

describe("coercion helpers", () => {
  it("parses messy numbers", () => {
    expect(toNumber("$12,345")).toBe(12345);
    expect(toNumber(" 1,200 ")).toBe(1200);
    expect(toNumber("27%")).toBe(27);
    expect(toNumber("$45k")).toBe(45000);
    expect(toNumber("1200-1400")).toBeNull();
    expect(toNumber("N/A")).toBeNull();
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  it("turns percentages into 0–1 rates and rejects nonsense", () => {
    expect(toRate(0.27)).toBe(0.27);
    expect(toRate(27)).toBe(0.27);
    expect(toRate("27%")).toBe(0.27);
    expect(toRate("0.5%")).toBe(0.005);
    expect(toRate(1)).toBe(1);
    expect(toRate(250)).toBeNull();
    expect(toRate(-0.1)).toBeNull();
  });

  it("normalizes plan names and deadlines", () => {
    expect(toPlanKind("Early Decision")).toBe("ED");
    expect(toPlanKind("ED II")).toBe("ED2");
    expect(toPlanKind("early decision 2")).toBe("ED2");
    expect(toPlanKind("Restrictive Early Action")).toBe("REA");
    expect(toPlanKind("SCEA")).toBe("REA");
    expect(toPlanKind("EA")).toBe("EA");
    expect(toPlanKind("Regular Decision")).toBe("RD");
    expect(toPlanKind("rolling admission")).toBe("Rolling");
    expect(toPlanKind("bogus")).toBeNull();
    expect(toDeadline("2026-11-1")).toBe("2026-11-01");
    expect(toDeadline("11/01/2026")).toBe("2026-11-01");
    expect(toDeadline("November 1, 2026")).toBe("2026-11-01");
    expect(toDeadline("Nov 1")).toBe("Nov 1");
    expect(toDeadline("n/a")).toBeNull();
  });
});

describe("names", () => {
  it("normalizes and matches names", () => {
    expect(normalizeName("The University of North Carolina at Chapel Hill")).toBe("university of north carolina at chapel hill");
    expect(normalizeName("Texas A&M Univ.")).toBe("texas a and m university");
    expect(normalizeName("St. Olaf College")).toBe("saint olaf college");
    expect(namesMatch("UNC Chapel Hill", "University of North Carolina at Chapel Hill")).toBe(false); // nickname → positional fallback
    expect(namesMatch("Purdue", "Purdue University")).toBe(true);
    expect(namesMatch("University of Michigan", "University of Michigan-Ann Arbor")).toBe(true);
    expect(namesMatch("Miami University", "University of Miami")).toBe(true); // same tokens; the state disambiguates upstream
    expect(namesMatch("Ohio State University", "Ohio University")).toBe(false);
    expect(namesMatch("Duke University", "Rice University")).toBe(false);
  });

  it("shortens long names", () => {
    expect(shortName("Duke University")).toBe("Duke University");
    expect(shortName("Massachusetts Institute of Technology")).toBe("Massachusetts Tech");
    expect(shortName("The Pennsylvania State University")).toBe("Pennsylvania State");
    expect(shortName("University of California, Los Angeles").length).toBeLessThanOrEqual(22);
  });
});

describe("normalizeCollege", () => {
  it("normalizes a messy researcher record", () => {
    const c = normalizeCollege(
      {
        name: "  University of  Washington ",
        short: "UW",
        city: "Seattle",
        state: "Washington",
        ownership: "Public",
        locale: "Urban",
        url: "www.washington.edu",
        lat: "47.655",
        lon: -122.30,
        undergrad_size: "36,872",
        admit_rate: "43%",
        sat_25: "1,330",
        sat_75: 1250, // swapped
        act_25: 40, // out of range
        act_75: "33",
        test_policy: "Test-optional",
        tuition_in_state: "$12,973",
        tuition_out_of_state: 43209,
        cost_of_attendance: "36,000",
        avg_net_price: -5,
        net_price_by_income: { "0_30k": "4,500", "30_48k": null, "48_75k": "n/a", "75_110k": 16000.6, "110k_plus": "$28k" },
        grad_rate_6yr: 84,
        retention_rate: "0.94",
        median_earnings_10yr: "$74,000",
        program_share: [
          { major: "nursing", share: "3%" },
          { major: "public health", share: 0.02 },
          { major: "undecided", share: 0.5 },
          { major: "astrology", share: 0.1 },
        ],
        hbcu: "no",
        women_only: false,
        religious: 0,
        cds: { cds_year: "2025-2026", ed_admit_rate: null, offers_ea: "no", avg_gpa: 3.84, gated_majors: ["nursing", "computer_science", "bogus"], source_url: "https://www.washington.edu/cds.pdf" },
        application: {
          cycle: "Fall 2027 entry",
          plans: [
            { plan: "Regular Decision", deadline: "November 15, 2026", notes: "Based on last cycle — confirm" },
            { plan: "regular", deadline: "2026-11-15", notes: null },
            { plan: "Priority", deadline: null, notes: "" },
          ],
          test_policy_note: "Optional",
          essays_note: null,
          fee: "$80",
        },
        programs: [
          { major: "nursing", offered: "yes", degree: "BSN", how_to_enter: "Apply to major after prerequisites (competitive)", notes: null },
          { major: "nursing", offered: true, degree: "dup", how_to_enter: null, notes: null },
          { major: "basket weaving", offered: true, degree: "x", how_to_enter: null, notes: null },
        ],
        scholarships: [{ name: "Purple & Gold", amount: "$2,000", note: null }, { name: "", amount: "x", note: null }],
        sources: [
          { title: "Admissions", url: "https://admit.washington.edu/" },
          { title: "dup", url: "https://admit.washington.edu/" },
          { title: "bad", url: "javascript:alert(1)" },
          "https://collegescorecard.ed.gov/school/?236948",
        ],
        data_year: "2025-26 CDS",
        data_confidence: "HIGH",
        data_notes: ["Net price is from 2023-24 Scorecard.", ""],
      },
      { requestedName: "UW", now: NOW },
    )!;

    expect(c.name).toBe("University of Washington");
    expect(c.id).toBe("ai-university-of-washington-wa");
    expect(c.short).toBe("UW");
    expect(c.state).toBe("WA");
    expect(c.region).toBe("pacific");
    expect(c.ownership).toBe("public");
    expect(c.locale).toBe("city");
    expect(c.url).toBe("https://www.washington.edu/");
    expect(c.lat).toBe(47.655);
    expect(c.undergrad_size).toBe(36872);
    expect(c.admit_rate).toBe(0.43);
    expect([c.sat_25, c.sat_75]).toEqual([1250, 1330]);
    expect(c.act_25).toBeNull();
    expect(c.act_75).toBe(33);
    expect(c.test_policy).toBe("optional");
    expect(c.tuition_in_state).toBe(12973);
    expect(c.avg_net_price).toBeNull();
    expect(c.net_price_by_income).toEqual({ "0_30k": 4500, "30_48k": null, "48_75k": null, "75_110k": 16001, "110k_plus": 28000 });
    expect(c.grad_rate_6yr).toBe(0.84);
    expect(c.retention_rate).toBe(0.94);
    expect(c.median_earnings_10yr).toBe(74000);
    expect(c.program_share).toEqual({ nursing: 0.03, public_health: 0.02 });
    expect(c.hbcu).toBe(false);
    expect(c.religious).toBe(false);
    expect(c.cds).toMatchObject({ cds_year: "2025-2026", offers_ea: false, avg_gpa: 3.84, gated_majors: ["nursing", "computer_science"] });
    expect(c.application?.plans).toEqual([
      { plan: "RD", deadline: "2026-11-15", notes: "Based on last cycle — confirm" },
      { plan: "Priority", deadline: null },
    ]);
    expect(c.programs).toEqual([{ major: "nursing", offered: true, degree: "BSN", how_to_enter: "Apply to major after prerequisites (competitive)", notes: null }]);
    expect(c.scholarships).toEqual([{ name: "Purple & Gold", amount: "$2,000", note: null }]);
    expect(c.sources.map((s) => s.url)).toEqual([
      "https://www.washington.edu/cds.pdf",
      "https://admit.washington.edu/",
      "https://collegescorecard.ed.gov/school/?236948",
    ]);
    expect(c.source).toBe("ai_research");
    expect(c.researched_at).toBe(NOW.toISOString());
    expect(c.data_confidence).toBe("high");
    expect(c.data_notes).toContain("Net price is from 2023-24 Scorecard.");
    expect(c.data_notes.some((n) => /ACT/.test(n))).toBe(true);
    expect(c.data_notes.some((n) => /net price/.test(n))).toBe(true);
  });

  it("marks ED/EA as offered when plans list them", () => {
    const c = normalizeCollege(rawCollege("Wake Forest University", "NC", {
      ownership: "private", cds: { offers_ed: null }, application: { plans: [{ plan: "ED I", deadline: "2026-11-15" }, { plan: "ED2", deadline: "2027-01-01" }] },
    }), { now: NOW })!;
    expect(c.cds?.offers_ed).toBe(true);
    expect(c.ownership).toBe("private_nonprofit");
    expect(c.tuition_in_state).toBe(9000); // copied from model output, both present
  });

  it("caps confidence when the data doesn't support it and fills missing fields", () => {
    const c = normalizeCollege({ name: "Mystery College", data_confidence: "high" }, { requestedState: "VT", cycle: "Fall 2027 entry", now: NOW })!;
    expect(c.state).toBe("VT");
    expect(c.region).toBe("new_england");
    expect(c.data_confidence).toBe("low");
    expect(c.test_policy).toBe("unknown");
    expect(c.sources).toEqual([]);
    expect(c.data_notes.some((n) => /No sources/.test(n))).toBe(true);
    expect(c.data_notes.some((n) => /Public\/private/.test(n))).toBe(true);
    expect(c.program_share).toEqual({});
    expect(c.application).toBeUndefined();
  });

  it("uses the requested name when the model omits it, and rejects non-objects without a name", () => {
    expect(normalizeCollege({ state: "OH" }, { requestedName: "Kenyon College", now: NOW })?.name).toBe("Kenyon College");
    expect(normalizeCollege(null)).toBeNull();
    expect(normalizeCollege("garbage")).toBeNull();
  });

  it("drops non-US coordinates and old-SAT scores", () => {
    const c = normalizeCollege(rawCollege("X University", "NC", { lat: 51.5, lon: 0.1, sat_25: 1900, sat_75: 2200 }), { now: NOW })!;
    expect(c.lat).toBeNull();
    expect(c.sat_25).toBeNull();
    expect(c.sat_75).toBeNull();
  });
});

describe("extractJsonObject", () => {
  it("finds JSON in prose or fences", () => {
    expect(extractJsonObject('Sure! ```json\n{"a": {"b": "}"}}\n``` done')).toEqual({ a: { b: "}" } });
    expect(extractJsonObject('Here: {"colleges": []} thanks')).toEqual({ colleges: [] });
    expect(extractJsonObject("no json")).toBeNull();
    expect(extractJsonObject("{broken")).toBeNull();
  });
});

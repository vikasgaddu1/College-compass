import { describe, expect, it } from "vitest";
import type { Deadline } from "./deadlines";
import { deadlineUid, deadlinesToIcs, foldLine, icsFileName, icsStamp, icsText } from "./ics";

const NOW = new Date(Date.UTC(2026, 9, 21, 18, 30, 0));
const d = (over: Partial<Deadline> = {}): Deadline => ({ collegeId: "198419", collegeName: "Duke University", short: "Duke", url: "https://duke.edu", plan: "ED", planLabel: "Early Decision", date: "2026-11-01", notes: null, starred: false, ...over });

describe("ics", () => {
  it("escapes text and folds long lines at 75 octets", () => {
    expect(icsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const long = "DESCRIPTION:" + "x".repeat(200);
    const folded = foldLine(long);
    const lines = folded.split("\r\n");
    expect(lines.length).toBe(3);
    expect(lines[0]!.length).toBe(75);
    expect(lines[1]!.startsWith(" ")).toBe(true);
    expect(lines.slice(1).every((l) => l.length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(long); // unfolding restores the line
    expect(foldLine("short")).toBe("short");
    expect(icsStamp(NOW)).toBe("20261021T183000Z");
  });

  it("writes one all-day event per deadline with an alert at 9:00 the day before", () => {
    const ics = deadlinesToIcs([d(), d({ collegeId: "166683", collegeName: "Massachusetts Institute of Technology", short: "MIT", plan: "EA", planLabel: "Early Action", notes: "Portfolio optional", url: null, date: "2026-12-31" })], { calendarName: "Robotics deadlines", now: NOW });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("X-WR-CALNAME:Robotics deadlines");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("UID:cc-198419-ED-20261101@collegecompass");
    expect(ics).toContain("DTSTAMP:20261021T183000Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261101");
    expect(ics).toContain("DTEND;VALUE=DATE:20261102");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101"); // across the year end
    expect(ics).toContain("SUMMARY:Duke · Early Decision deadline");
    expect(ics).toContain("URL:https://duke.edu");
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("Portfolio optional");
    expect(unfolded).toContain("Confirm the date on the college's admissions site");
    expect(unfolded).toContain("DESCRIPTION:Duke University\\nNot checked — confirm on the college's site\\nFrom Tierwise research.");
    expect(ics.match(/BEGIN:VALARM\r\nACTION:DISPLAY\r\n/g)).toHaveLength(2);
    // The proof check's verdict and page travel with the event.
    const checked = deadlinesToIcs([d({ check: { status: "verified", url: "https://admissions.duke.edu/deadlines", host: "admissions.duke.edu", checkedAt: "2026-10-20T00:00:00.000Z" } })], { now: NOW }).replace(/\r\n /g, "");
    expect(checked).toContain("Checked on admissions.duke.edu — https://admissions.duke.edu/deadlines");
    const doubtful = deadlinesToIcs([d({ check: { status: "mismatch", url: "https://admissions.duke.edu/deadlines", checkedAt: "2026-10-20T00:00:00.000Z" } })], { now: NOW }).replace(/\r\n /g, "");
    expect(doubtful).toContain("Couldn't find this date on admissions.duke.edu — confirm");
    expect(ics.match(/TRIGGER:-PT15H/g)).toHaveLength(2);
    // Every physical line fits the 75-octet limit and lines end with CRLF only.
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      expect(line).not.toContain("\n");
    }
  });

  it("names the file after the list and keeps ids filesystem-safe", () => {
    expect(icsFileName("Robotics · New England")).toBe("College deadlines - Robotics · New England.ics");
    expect(icsFileName("a/b:c")).toBe("College deadlines - a b c.ics");
    expect(icsFileName("")).toBe("College deadlines.ics");
    expect(deadlineUid({ collegeId: "x y", plan: "ED2", date: "2027-01-02" })).toBe("cc-x-y-ED2-20270102@collegecompass");
  });
});

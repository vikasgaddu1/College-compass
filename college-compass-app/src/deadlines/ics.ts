/**
 * "Add to Calendar": deadlines as an iCalendar (.ics) file of all-day events, each with an alert the
 * morning before (9:00). Pure text generation (RFC 5545): CRLF line ends, 75-octet folding, escaped text.
 */
import type { Deadline } from "./deadlines";
import { REMINDER_HOUR, shiftDay } from "./deadlines";

export const ICS_PRODID = "-//College Compass//Deadlines//EN";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYYMMDD` of a day key. */
function icsDate(day: string): string {
  return day.replace(/-/g, "");
}

/** `YYYYMMDDTHHMMSSZ` of a moment, in UTC. */
export function icsStamp(at: Date): string {
  return `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`;
}

/** Escape a TEXT value: backslash, semicolon, comma and newlines. */
export function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold a content line to 75 octets per RFC 5545 (continuation lines start with a space). */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (curBytes + n > limit) {
      out.push(cur);
      cur = " ";
      curBytes = 1;
      limit = 75;
    }
    cur += ch;
    curBytes += n;
  }
  if (cur) out.push(cur);
  return out.join("\r\n");
}

export interface IcsOptions {
  /** Shown in the calendar name (X-WR-CALNAME). */
  calendarName?: string;
  /** DTSTAMP / UID stability for tests. */
  now?: Date;
  /** Appended to each event's description. */
  disclaimer?: string;
}

export function deadlineUid(d: Pick<Deadline, "collegeId" | "plan" | "date">): string {
  return `cc-${d.collegeId}-${d.plan}-${icsDate(d.date)}@collegecompass`.replace(/[^A-Za-z0-9@.\-]/g, "-");
}

/**
 * One VEVENT per deadline: all-day on the deadline day, with a display alarm at 9:00 the day before
 * (expressed relative to the all-day start: 24h − 9h = 15h earlier).
 */
export function deadlinesToIcs(items: Deadline[], opts: IcsOptions = {}): string {
  const now = opts.now ?? new Date();
  const stamp = icsStamp(now);
  const disclaimer = opts.disclaimer ?? "From College Compass research. Confirm the date on the college's admissions site.";
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${ICS_PRODID}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (opts.calendarName) lines.push(`X-WR-CALNAME:${icsText(opts.calendarName)}`);
  for (const d of items) {
    const summary = `${d.short} · ${d.planLabel} deadline`;
    const desc = [d.collegeName, d.notes, disclaimer].filter(Boolean).join("\n");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${deadlineUid(d)}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(d.date)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(shiftDay(d.date, 1))}`);
    lines.push(`SUMMARY:${icsText(summary)}`);
    lines.push(`DESCRIPTION:${icsText(desc)}`);
    if (d.url) lines.push(`URL:${d.url}`);
    lines.push("TRANSP:TRANSPARENT");
    lines.push("BEGIN:VALARM");
    lines.push("ACTION:DISPLAY");
    lines.push(`DESCRIPTION:${icsText(`${d.short} ${d.planLabel} deadline is tomorrow`)}`);
    lines.push(`TRIGGER:-PT${24 - REMINDER_HOUR}H`);
    lines.push("END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** A safe file name for the export, e.g. `College deadlines - Robotics NE.ics`. */
export function icsFileName(listName: string): string {
  const clean = listName.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return `College deadlines${clean ? ` - ${clean}` : ""}.ics`;
}

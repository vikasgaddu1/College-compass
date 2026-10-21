/**
 * Application deadlines, from the researched colleges of a list.
 *
 * Pure functions, no DOM: parse the deadline strings research stored (`College.application.plans[].deadline`,
 * see `toDeadline` in src/ai/normalize.ts and the sample values in src/state/fixtures.ts), keep the ones still
 * ahead, filter them by the student's plan willingness, group them by day and turn them into reminder
 * notifications. Dates are calendar days in the phone's local time zone; a deadline "Nov 1" means the day,
 * never a moment.
 */
import type { ApplicationFacts, College, PlanWillingness, StudentProfile } from "@/types";

export type Plan = ApplicationFacts["plans"][number]["plan"];

export const PLAN_LABEL: Record<Plan, string> = {
  ED: "Early Decision",
  ED2: "Early Decision II",
  EA: "Early Action",
  REA: "Restrictive Early Action",
  RD: "Regular Decision",
  Rolling: "Rolling admission",
  Priority: "Priority deadline",
};

/** A calendar day, `YYYY-MM-DD`, in local time. */
export type DayKey = string;

export interface Deadline {
  collegeId: string;
  collegeName: string;
  short: string;
  /** Institution website, for "confirm on the college's site". */
  url: string | null;
  plan: Plan;
  planLabel: string;
  /** The deadline day (local). */
  date: DayKey;
  notes: string | null;
  /** On the list's shortlist. */
  starred: boolean;
}

export interface DeadlineGroup {
  date: DayKey;
  /** Whole days from `now` to the deadline day (0 = today). */
  daysUntil: number;
  items: Deadline[];
}

// ───────────────────────────── day keys ─────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validDay(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function dayKey(y: number, m: number, d: number): DayKey {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** The local calendar day of a moment. */
export function dayOf(at: Date): DayKey {
  return dayKey(at.getFullYear(), at.getMonth() + 1, at.getDate());
}

/** Local midnight of a day key. */
export function dayStart(day: DayKey): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** A moment on `day` at `hour`:`minute` local time. */
export function dayAt(day: DayKey, hour: number, minute = 0): Date {
  const t = dayStart(day);
  t.setHours(hour, minute, 0, 0);
  return t;
}

/** `day` shifted by `days` (negative = earlier), in local time. */
export function shiftDay(day: DayKey, days: number): DayKey {
  const t = dayStart(day);
  t.setDate(t.getDate() + days);
  return dayOf(t);
}

/** Whole calendar days from `now`'s day to `day` (negative when past). */
export function daysUntil(day: DayKey, now: Date): number {
  const a = dayStart(dayOf(now)).getTime();
  const b = dayStart(day).getTime();
  // Round: a DST change makes a day 23 or 25 hours long.
  return Math.round((b - a) / 86_400_000);
}

// ───────────────────────────── parsing ─────────────────────────────

/**
 * Parse a stored deadline string into a day key. Accepts what research and the normalizer produce:
 * `2026-11-01` (also with a time suffix), `11/1/2026`, `Nov 1, 2026`, `November 1st 2026`, `1 Nov 2026`,
 * `Nov. 1` without a year (resolved to the next such day on or after `now`). Anything else — "Early
 * November", "TBD", "rolling", "see website" — is null. Dates far outside the application window are null too.
 */
export function parseDeadline(raw: string | null | undefined, now: Date = new Date()): DayKey | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;

  let y: number | null = null;
  let m: number | null = null;
  let d: number | null = null;

  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];

  if (!match) {
    match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/);
    if (match) {
      m = Number(match[1]);
      d = Number(match[2]);
      y = Number(match[3]);
      if (y < 100) y += 2000;
    }
  }

  if (!match) {
    // "Nov 1, 2026", "November 1st, 2026", "Nov. 1 2026", "Nov 1" (no year)
    match = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?\.?$/);
    if (match) {
      m = monthNumber(match[1]!);
      d = Number(match[2]);
      y = match[3] ? Number(match[3]) : null;
      if (m == null) match = null;
    }
  }

  if (!match) {
    // "1 Nov 2026", "1st November, 2026", "1 Nov"
    match = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?(?:\s+(\d{4}))?\.?$/);
    if (match) {
      d = Number(match[1]);
      m = monthNumber(match[2]!);
      y = match[3] ? Number(match[3]) : null;
      if (m == null) match = null;
    }
  }

  if (!match || m == null || d == null) return null;

  if (y == null) {
    // No year: the next time this month/day comes around, counting today.
    y = now.getFullYear();
    if (!validDay(y, m, d)) return null;
    if (daysUntil(dayKey(y, m, d), now) < 0) y += 1;
  }
  if (!validDay(y, m, d)) return null;
  // Ignore dates that can't be this student's application window (a typo'd year, a leftover old cycle).
  const years = y - now.getFullYear();
  if (years < -1 || years > 3) return null;
  return dayKey(y, m, d);
}

const MONTH_FULL = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A month name or any prefix of at least 3 letters ("Nov", "Sept", "November"); "Mayo" is not May. */
function monthNumber(name: string): number | null {
  const key = name.toLowerCase();
  if (key === "sept") return 9;
  if (key.length < 3) return null;
  const idx = MONTH_FULL.findIndex((f) => f.startsWith(key));
  return idx >= 0 ? idx + 1 : null;
}

// ───────────────────────────── plan willingness ─────────────────────────────

export function isBinding(plan: Plan): boolean {
  return plan === "ED" || plan === "ED2";
}

export function isEarly(plan: Plan): boolean {
  return plan === "ED" || plan === "ED2" || plan === "EA" || plan === "REA";
}

/**
 * Whether a plan's deadline matters to this student by default: Regular, Rolling and Priority
 * (scholarship) deadlines always do; a student who won't apply binding skips ED/ED II; a student who
 * won't apply early at all also skips EA/REA.
 */
export function planFits(plan: Plan, willingness: PlanWillingness): boolean {
  if (willingness === "ed_ok") return true;
  if (willingness === "ea_only") return !isBinding(plan);
  return !isEarly(plan);
}

/** Short reason for the "hidden plans" note, or null when nothing is hidden by this willingness. */
export function hiddenPlansNote(willingness: PlanWillingness, hidden: number): string | null {
  if (!hidden) return null;
  const n = hidden === 1 ? "1 deadline" : `${hidden} deadlines`;
  if (willingness === "ea_only") return `${n} for Early Decision hidden — you said you'd rather not apply binding.`;
  if (willingness === "rd_only") return `${n} for early plans hidden — you said you'd apply Regular Decision.`;
  return null;
}

// ───────────────────────────── upcoming deadlines ─────────────────────────────

export interface UpcomingOptions {
  colleges: College[];
  shortlist?: string[];
  profile?: Pick<StudentProfile, "plan"> | null;
  now?: Date;
  /** Include plans the student's willingness would hide. */
  showAll?: boolean;
}

export interface Upcoming {
  /** Upcoming deadlines (today or later), soonest first. */
  items: Deadline[];
  /** How many upcoming deadlines the willingness filter removed (0 when `showAll`). */
  hidden: number;
  /** True when at least one college has researched application plans at all. */
  researched: boolean;
}

export function upcomingDeadlines(opts: UpcomingOptions): Upcoming {
  const now = opts.now ?? new Date();
  const today = dayOf(now);
  const starred = new Set(opts.shortlist ?? []);
  const willingness = opts.profile?.plan ?? "ed_ok";
  const all: Deadline[] = [];
  let researched = false;
  for (const c of opts.colleges) {
    const plans = c.application?.plans ?? [];
    if (plans.length) researched = true;
    for (const p of plans) {
      if (!p || !p.plan || !(p.plan in PLAN_LABEL)) continue;
      const date = parseDeadline(p.deadline, now);
      if (!date || date < today) continue;
      all.push({
        collegeId: c.id,
        collegeName: c.name,
        short: c.short || c.name,
        url: c.url ?? null,
        plan: p.plan,
        planLabel: PLAN_LABEL[p.plan],
        date,
        notes: p.notes?.trim() || null,
        starred: starred.has(c.id),
      });
    }
  }
  const seen = new Set<string>();
  const unique = all.filter((d) => {
    const k = deadlineKey(d);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const kept = opts.showAll ? unique : unique.filter((d) => planFits(d.plan, willingness));
  kept.sort(compareDeadlines);
  return { items: kept, hidden: unique.length - kept.length, researched };
}

/** Identity of a deadline across lists: the same college, plan and day is one deadline. */
export function deadlineKey(d: Pick<Deadline, "collegeId" | "plan" | "date">): string {
  return `${d.collegeId}|${d.plan}|${d.date}`;
}

const PLAN_ORDER: Record<Plan, number> = { ED: 0, REA: 1, EA: 2, ED2: 3, Priority: 4, RD: 5, Rolling: 6 };

function compareDeadlines(a: Deadline, b: Deadline): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.starred !== b.starred) return a.starred ? -1 : 1;
  if (PLAN_ORDER[a.plan] !== PLAN_ORDER[b.plan]) return PLAN_ORDER[a.plan] - PLAN_ORDER[b.plan];
  return a.collegeName.localeCompare(b.collegeName);
}

/** Group sorted deadlines by day. */
export function groupByDate(items: Deadline[], now: Date = new Date()): DeadlineGroup[] {
  const groups: DeadlineGroup[] = [];
  for (const d of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === d.date) last.items.push(d);
    else groups.push({ date: d.date, daysUntil: daysUntil(d.date, now), items: [d] });
  }
  return groups;
}

// ───────────────────────────── formatting ─────────────────────────────

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 1", or "Nov 1, 2027" when the day is in another year than `now`. */
export function formatDay(day: DayKey, now: Date = new Date()): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const base = `${MONTH_SHORT[m - 1]} ${d}`;
  return y === now.getFullYear() ? base : `${base}, ${y}`;
}

/** "today", "tomorrow", "in 11 days", "in 3 weeks", "in 2 months". */
export function formatRelative(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

/** Weekday for the group header, e.g. "Sunday". */
export function formatWeekday(day: DayKey): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayStart(day).getDay()]!;
}

/**
 * The List tab banner: the next deadline day and what's due. "Nov 1 · in 11 days" / "4 colleges · Early Action".
 */
export function nextDeadlineSummary(items: Deadline[], now: Date = new Date()): { when: string; what: string; count: number; date: DayKey } | null {
  const groups = groupByDate(items, now);
  const g = groups[0];
  if (!g) return null;
  const labels = [...new Set(g.items.map((d) => d.planLabel))];
  const colleges = new Set(g.items.map((d) => d.collegeId)).size;
  const what = labels.length === 1 ? labels[0]! : labels.length === 2 ? `${labels[0]}, ${labels[1]}` : `${labels.length} plans`;
  return {
    when: `${formatDay(g.date, now)} · ${formatRelative(g.daysUntil)}`,
    what: `${colleges === 1 ? g.items[0]!.short : `${colleges} colleges`} · ${what}`,
    count: colleges,
    date: g.date,
  };
}

// ───────────────────────────── reminders ─────────────────────────────

export interface Reminder {
  /** Stable identifier; every deadline reminder starts with `REMINDER_PREFIX`. */
  id: string;
  title: string;
  body: string;
  /** When to fire, epoch milliseconds (local 9:00 on the lead day). */
  fireAt: number;
}

/** Identifier prefix of every deadline reminder (the research-ready notification uses `cc-research-ready`). */
export const REMINDER_PREFIX = "cc-deadline:";
/** Lead times in days before the deadline. */
export const REMINDER_LEADS = [7, 1] as const;
/** Local hour the reminders fire. */
export const REMINDER_HOUR = 9;
/**
 * iOS keeps at most 64 pending local notifications per app; it silently drops the rest. Leave room
 * for the research-ready notification and a few spare.
 */
export const REMINDER_CAP = 60;

export function reminderId(date: DayKey, lead: number): string {
  return `${REMINDER_PREFIX}${date}:${lead}d`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Duke · Early Decision due in 7 days — Nov 1" / "3 Early Action deadlines in 7 days — Nov 1". */
export function reminderText(group: DeadlineGroup, lead: number, now: Date = new Date()): { title: string; body: string } {
  const dueIn = lead === 1 ? "due tomorrow" : `due in ${lead} days`;
  const day = formatDay(group.date, now);
  const items = group.items;
  if (items.length === 1) {
    const d = items[0]!;
    const tail = d.notes ? ` ${d.notes}` : "";
    return { title: `${d.short} · ${d.planLabel} ${dueIn} — ${day}`, body: `Confirm the date on the college's site before you submit.${tail}`.trim() };
  }
  const labels = new Set(items.map((d) => d.planLabel));
  const kind = labels.size === 1 ? `${[...labels][0]} deadlines` : "application deadlines";
  const colleges = [...new Set(items.map((d) => d.short))];
  return {
    title: `${items.length} ${kind} ${dueIn.replace("due ", "")} — ${day}`,
    body: `${joinNames(colleges)}. Confirm the dates on each college's site.`,
  };
}

/**
 * Reminders for upcoming deadlines: for every deadline day one notification 7 days before and one the
 * day before, at 9:00 local time, colleges due the same day grouped into one. Lead days already past
 * (or today before 9:00 has passed) are skipped. Capped to `REMINDER_CAP`, soonest first.
 */
export function buildReminders(items: Deadline[], now: Date = new Date(), cap: number = REMINDER_CAP): Reminder[] {
  const out: Reminder[] = [];
  for (const g of groupByDate(items, now)) {
    for (const lead of REMINDER_LEADS) {
      const fireAt = dayAt(shiftDay(g.date, -lead), REMINDER_HOUR).getTime();
      if (fireAt <= now.getTime()) continue;
      const { title, body } = reminderText(g, lead, now);
      out.push({ id: reminderId(g.date, lead), title, body, fireAt });
    }
  }
  out.sort((a, b) => a.fireAt - b.fireAt || a.id.localeCompare(b.id));
  return out.slice(0, Math.max(0, cap));
}

/**
 * One set of deadlines for several lists: the same college + plan + day across lists is one deadline.
 * Items keep the first list's `starred` unless a later list starred it.
 */
export function mergeDeadlines(perList: Deadline[][]): Deadline[] {
  const byKey = new Map<string, Deadline>();
  for (const items of perList) {
    for (const d of items) {
      const k = deadlineKey(d);
      const prev = byKey.get(k);
      if (!prev) byKey.set(k, d);
      else if (d.starred && !prev.starred) byKey.set(k, { ...prev, starred: true });
    }
  }
  return [...byKey.values()].sort(compareDeadlines);
}

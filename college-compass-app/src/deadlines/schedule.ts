/**
 * Keep the phone's pending deadline reminders in step with the lists that asked for them.
 *
 * Every list with "Remind me before deadlines" on contributes its upcoming deadlines (filtered by that
 * list's plan willingness); the same college + plan + day across lists is one reminder. The whole set is
 * rebuilt and handed to the platform, which removes every pending `cc-deadline:` request first — so
 * running this at launch and after any change is idempotent.
 */
import type { College, StudentProfile } from "@/types";
import { load } from "@/lib/storage";
import { listKey, type ListMeta } from "@/state/lists";
import { REMINDER_PREFIX, buildReminders, mergeDeadlines, upcomingDeadlines, type Reminder } from "./deadlines";
import { scheduleDeadlineReminders, supportsDeadlineReminders } from "@/platform";

export interface ListData {
  colleges: College[];
  shortlist: string[];
  profile: Pick<StudentProfile, "plan"> | null;
}

/** A list's stored parts (for lists that aren't loaded in memory). */
export function readListData(id: string): ListData {
  const colleges = load<unknown>(listKey(id, "colleges"), []);
  const shortlist = load<unknown>(listKey(id, "shortlist"), []);
  const profile = load<StudentProfile | null>(listKey(id, "profile"), null);
  return {
    colleges: Array.isArray(colleges) ? (colleges as College[]) : [],
    shortlist: Array.isArray(shortlist) ? (shortlist as string[]) : [],
    profile: profile && typeof profile === "object" ? profile : null,
  };
}

/** The reminders to have pending for `lists`: those with `remind` on, merged, 9:00 local, capped. */
export function collectReminders(lists: ListMeta[], read: (id: string) => ListData, now: Date = new Date()): Reminder[] {
  const perList = lists
    .filter((l) => l.remind)
    .map((l) => {
      const d = read(l.id);
      return upcomingDeadlines({ colleges: d.colleges, shortlist: d.shortlist, profile: d.profile, now }).items;
    });
  return buildReminders(mergeDeadlines(perList), now);
}

/**
 * Rebuild and schedule the reminders (native only; resolves 0 elsewhere). `override` supplies the
 * in-memory data of the active list so a change is reflected before storage catches up.
 */
export async function syncDeadlineReminders(lists: ListMeta[], override?: { id: string; data: ListData }, now: Date = new Date()): Promise<number> {
  if (!supportsDeadlineReminders()) return 0;
  const read = (id: string) => (override && override.id === id ? override.data : readListData(id));
  const reminders = collectReminders(lists, read, now);
  return scheduleDeadlineReminders(REMINDER_PREFIX, reminders);
}

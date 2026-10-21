/**
 * Deadlines: every upcoming application deadline on the active list, grouped by day, with reminders
 * (iPhone app) and "Add to Calendar". Reached from the banner at the top of the List tab and from
 * Settings → Lists.
 */
import { useEffect, useMemo, useState } from "react";
import { navigate } from "@/lib/router";
import { useStore } from "@/state/store";
import { Screen } from "@/components/Screen";
import { Banner, Button, Empty, Group, Row, Switch } from "@/components/ui";
import { IconExternal, IconStar } from "@/components/icons";
import { formatDay, formatRelative, formatWeekday, groupByDate, hiddenPlansNote, upcomingDeadlines, type Deadline } from "@/deadlines/deadlines";
import { deadlinesToIcs, icsFileName } from "@/deadlines/ics";
import { requestNotificationPermission, shareCalendarFile, supportsDeadlineReminders } from "@/platform";

/** The current moment, refreshed when the app comes back to the front (a day may have passed). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return now;
}

export function Deadlines() {
  const { colleges, shortlist, profile, hasProfile, activeList, setListRemind, demo } = useStore();
  const now = useNow();
  const [showAll, setShowAll] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const native = supportsDeadlineReminders();

  const upcoming = useMemo(() => upcomingDeadlines({ colleges, shortlist, profile, now, showAll }), [colleges, shortlist, profile, now, showAll]);
  const groups = useMemo(() => groupByDate(upcoming.items, now), [upcoming.items, now]);
  const hiddenNote = showAll ? null : hiddenPlansNote(profile.plan, upcoming.hidden);
  const anyStarred = upcoming.items.some((d) => d.starred);
  const remind = !!activeList.remind;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const onRemind = async (on: boolean) => {
    setNote(null);
    if (!on) {
      setListRemind(activeList.id, false);
      return;
    }
    setAsking(true);
    try {
      const granted = await requestNotificationPermission();
      if (!granted) {
        setNote("Notifications are off for College Compass. Allow them in the iPhone Settings app, then turn this on again.");
        return;
      }
      setListRemind(activeList.id, true);
    } finally {
      setAsking(false);
    }
  };

  const addToCalendar = async () => {
    const ics = deadlinesToIcs(upcoming.items, { calendarName: `${activeList.name} deadlines`, now });
    const res = await shareCalendarFile(ics, icsFileName(activeList.name));
    if (res.completed && !native) setToast("Calendar file saved — open it to add the deadlines.");
  };

  const count = upcoming.items.length;
  const subtitle = count ? `${activeList.name} · ${count} upcoming` : activeList.name;

  return (
    <Screen title="Deadlines" back="/list" subtitle={subtitle}>
      {toast && (
        <p role="status" className="mb-3 rounded-control bg-accent-soft px-4 py-2 text-center text-subhead text-accent">
          {toast}
        </p>
      )}

      {!hasProfile || colleges.length === 0 ? (
        <Empty icon="📅" title="No deadlines yet" message="Run research to find each college's application plans and deadlines." action={hasProfile ? <Button onClick={() => navigate("/research")}>Research colleges</Button> : <Button onClick={() => navigate("/onboarding/1")}>Start</Button>} />
      ) : !upcoming.researched ? (
        <Empty icon="📅" title="No deadlines found" message="Research didn't find application deadlines for these colleges yet. Try Refresh research on a college." />
      ) : (
        <>
          {/* Reminders + calendar */}
          <Group
            label="Reminders"
            className="!mt-2"
            foot={
              native
                ? "A notification 7 days and 1 day before each deadline, at 9:00. Colleges due the same day share one."
                : "Deadline notifications are available in the iPhone app. On the web, add the deadlines to your calendar instead."
            }
          >
            {native ? (
              <div className="flex min-h-tap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-body">Remind me before deadlines</div>
                  <div className="mt-0.5 text-footnote text-text-muted">{remind ? "On for this list" : asking ? "Asking for permission…" : "7 days and 1 day before, at 9:00"}</div>
                </div>
                <Switch checked={remind} onChange={(v) => void onRemind(v)} label="Remind me before deadlines" />
              </div>
            ) : (
              <Row label="Remind me before deadlines" hint="Available in the iPhone app" />
            )}
            <Row label="Add to Calendar" hint={count ? `${count} all-day ${count === 1 ? "event" : "events"} with an alert the morning before` : "Nothing upcoming to add"} chevron onClick={addToCalendar} disabled={count === 0} />
          </Group>
          {note && (
            <div className="mt-3">
              <Banner tone="warn">{note}</Banner>
            </div>
          )}

          {/* Willingness filter */}
          {(hiddenNote || showAll) && (
            <div className="mt-4 flex items-start gap-3 rounded-control bg-surface-2 px-4 py-2.5">
              <p className="min-w-0 flex-1 text-footnote text-text-muted">{showAll ? "Showing every plan, including ones you said you'd skip." : hiddenNote}</p>
              <button type="button" className="cc-link min-h-tap shrink-0 text-subhead" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show mine" : "Show all"}
              </button>
            </div>
          )}

          {count === 0 ? (
            <Empty icon="🌤️" title="Nothing coming up" message={upcoming.hidden ? "Every upcoming deadline on this list is for a plan you said you'd skip." : "Every researched deadline on this list has passed."} />
          ) : (
            groups.map((g) => (
              <section key={g.date} className="mt-5" aria-label={`${formatDay(g.date, now)}, ${formatRelative(g.daysUntil)}`}>
                <header className="cc-section-head">
                  <h2 className="text-headline tnum">
                    {formatDay(g.date, now)} <span className="font-normal text-text-muted">· {formatRelative(g.daysUntil)}</span>
                  </h2>
                  <span className="text-footnote text-text-muted">{formatWeekday(g.date)}</span>
                </header>
                <div className="cc-group">
                  {g.items.map((d) => (
                    <DeadlineRow key={`${d.collegeId}:${d.plan}`} d={d} starColumn={anyStarred} />
                  ))}
                </div>
              </section>
            ))
          )}

          <p className="mt-6 text-center text-footnote text-text-muted">
            Deadlines come from {demo ? "sample" : "AI"} research and can be out of date. Confirm each one on the college's admissions site before you apply.
          </p>
        </>
      )}
    </Screen>
  );
}

/** `starColumn` reserves the star's space on every row so names line up once any college is starred. */
function DeadlineRow({ d, starColumn }: { d: Deadline; starColumn: boolean }) {
  const site = d.url ? safeUrl(d.url) : null;
  return (
    <div className="cc-row-static !py-0 !pr-1">
      <button type="button" className="cc-press flex min-h-tap min-w-0 flex-1 items-center gap-3 py-2.5 text-left" onClick={() => navigate(`/college/${encodeURIComponent(d.collegeId)}`)} aria-label={`${d.collegeName}, ${d.planLabel}${d.starred ? ", on your shortlist" : ""}${d.notes ? `, ${d.notes}` : ""}`}>
        {d.starred ? <IconStar size={18} filled className="shrink-0 text-warn" /> : starColumn ? <span className="h-[18px] w-[18px] shrink-0" aria-hidden /> : null}
        <span className="min-w-0 flex-1">
          <span className="block text-body">{d.collegeName}</span>
          <span className="block text-footnote text-text-muted">
            {d.planLabel}
            {d.notes ? ` · ${d.notes}` : ""}
          </span>
        </span>
      </button>
      {site && (
        <a className="grid h-11 w-11 shrink-0 place-items-center text-text-muted" href={site} target="_blank" rel="noopener noreferrer" aria-label={`Confirm on ${d.short}'s website`}>
          <IconExternal size={18} />
        </a>
      )}
    </div>
  );
}

/** Only http(s) links open from the row. */
function safeUrl(u: string): string | null {
  const s = u.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return `https://${s}`;
  return null;
}

/** List tab: a compact "Next deadline" card that opens the Deadlines screen. Nothing when no deadline is ahead. */
import { useMemo, useState } from "react";
import { navigate } from "@/lib/router";
import { useStore } from "@/state/store";
import { nextDeadlineSummary, upcomingDeadlines } from "@/deadlines/deadlines";
import { IconBell, IconChevronRight } from "./icons";

export function DeadlineBanner({ now: fixedNow }: { now?: Date } = {}) {
  const { colleges, shortlist, profile } = useStore();
  const [mountedAt] = useState(() => new Date());
  const now = fixedNow ?? mountedAt;
  const summary = useMemo(() => nextDeadlineSummary(upcomingDeadlines({ colleges, shortlist, profile, now }).items, now), [colleges, shortlist, profile, now]);
  if (!summary) return null;
  return (
    <button
      type="button"
      className="cc-card cc-press mb-4 flex w-full items-center gap-3 px-4 py-3 text-left"
      onClick={() => navigate("/deadlines")}
      aria-label={`Deadlines. Next: ${summary.when}, ${summary.what}`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden>
        <IconBell size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-caption uppercase tracking-wide text-text-muted">Next deadline</span>
        <span className="tnum block truncate text-subhead font-semibold">{summary.when}</span>
        <span className="block truncate text-footnote text-text-muted">{summary.what}</span>
      </span>
      <IconChevronRight size={18} className="shrink-0 text-text-muted opacity-70" />
    </button>
  );
}

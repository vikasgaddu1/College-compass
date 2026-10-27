/**
 * Small dismissible card on the list screen pointing to the counselor directory. Sits right after
 * the first tier group so it's seen without scrolling to the end, never above the first colleges;
 * hidden in the demo, when the list is empty and when the directory lists nobody for the student's
 * state (`useCounselorAvailability`); dismissal is remembered on this phone (localStorage) — see
 * docs/COUNSELORS_CONTRACT.md.
 */
import { useState } from "react";
import { navigate } from "@/lib/router";
import { load, save } from "@/lib/storage";
import { IconClose, IconLifebuoy } from "./icons";
import { counselorsPhrase, useCounselorAvailability } from "./CounselorPrompt";

export const COUNSELORS_NUDGE_KEY = "counselors_nudge_dismissed";

export function CounselorsNudge({ show }: { show: boolean }) {
  const [dismissed, setDismissed] = useState(() => load<boolean>(COUNSELORS_NUDGE_KEY, false));
  const avail = useCounselorAvailability();
  if (!show || dismissed || !avail.eligible || avail.count === 0) return null;
  const dismiss = () => {
    save(COUNSELORS_NUDGE_KEY, true);
    setDismissed(true);
  };
  const who = counselorsPhrase(avail.count, avail.stateName);
  return (
    <section className="cc-card mt-4 mb-1 flex items-start gap-3 p-4" aria-label="Get expert help">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden>
        <IconLifebuoy size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-headline">Want a second opinion?</h2>
        <p className="mt-0.5 text-footnote text-text-muted">
          {who} can review your list and essays. Paid listings — they never change your results.
        </p>
        <button type="button" className="cc-link mt-2 min-h-tap text-subhead" onClick={() => navigate("/counselors")}>
          Get expert help
        </button>
      </div>
      <button type="button" className="-mr-2 -mt-2 grid h-9 w-9 shrink-0 place-items-center text-text-muted" aria-label="Dismiss" onClick={dismiss}>
        <IconClose size={18} />
      </button>
    </section>
  );
}

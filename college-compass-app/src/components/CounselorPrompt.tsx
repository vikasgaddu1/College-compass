/**
 * Contextual pointers to the counselor directory ("Get expert help") — one quiet, tappable line
 * where a student might want a person: a college page, a close deadline, a reach-heavy list, an
 * essay question in Ask. Rules (docs/COUNSELORS_CONTRACT.md):
 *
 *  - Shown only when the directory actually lists someone for the student's state (`count > 0`), so
 *    an empty directory never creates a dead end. Never in the demo, never without a researched list,
 *    never on sign-in / onboarding / research-in-progress screens, at most one per screen.
 *  - The copy states a fact about the directory ("3 counselors in North Carolina help with STEM
 *    applications"); it never implies the app or the AI recommends anyone.
 *  - "×" hides that kind of prompt on this phone for 30 days (`cc2:counselor_prompt_dismissed:<kind>`).
 *  - Nothing about the student is sent: the availability check asks the directory for a state only.
 */
import { useEffect, useMemo, useState } from "react";
import { navigate } from "@/lib/router";
import { load, save } from "@/lib/storage";
import { useStore } from "@/state/store";
import { STATES } from "@/state/catalog";
import { SPECIALTY_IDS, specialtiesForMajors, type Counselor, type Specialty } from "@/data/counselors";
import { NO_MATCHES, loadCounselorsFor, peekCounselorsFor, summarizeMatches, type CounselorMatches } from "@/data/counselorMatches";
import { IconChevronRight, IconClose, IconLifebuoy } from "./icons";

export type PromptKind = "college" | "deadline" | "research" | "ask" | "list";

export const PROMPT_DISMISS_DAYS = 30;
export const promptDismissKey = (kind: PromptKind) => `counselor_prompt_dismissed:${kind}`;

/** True when this kind was dismissed less than 30 days ago on this phone. */
export function isPromptDismissed(kind: PromptKind, now = Date.now()): boolean {
  const at = load<number | null>(promptDismissKey(kind), null);
  return typeof at === "number" && now - at < PROMPT_DISMISS_DAYS * 86_400_000;
}

export function dismissPrompt(kind: PromptKind, now = Date.now()): void {
  save(promptDismissKey(kind), now);
}

// ───────────────────────────── availability ─────────────────────────────

/**
 * How many listed counselors serve `state` (plus nationwide ones) and the student's `specialties`.
 * One directory request per state per session, shared by every prompt; `enabled: false` asks nothing.
 */
export function useCounselorMatches({ state, specialties, enabled = true }: { state: string | null; specialties: readonly string[]; enabled?: boolean }): CounselorMatches & { loading: boolean } {
  const specKey = specialties.join(",");
  const [got, setGot] = useState<{ state: string | null; rows: Counselor[] } | null>(null);
  // A settled result for this state (from this or an earlier prompt) renders at once, no flash.
  const rows = got && got.state === state ? got.rows : enabled ? peekCounselorsFor(state) : undefined;
  useEffect(() => {
    if (!enabled || peekCounselorsFor(state)) return;
    let live = true;
    void loadCounselorsFor(state).then((r) => {
      if (live) setGot({ state, rows: r });
    });
    return () => {
      live = false;
    };
  }, [state, enabled]);
  return useMemo(() => {
    if (!enabled) return { ...NO_MATCHES, loading: false };
    if (!rows) return { ...NO_MATCHES, loading: true };
    return { ...summarizeMatches(rows, state, specKey ? specKey.split(",") : []), loading: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, state, specKey, enabled]);
}

export interface CounselorAvailability extends CounselorMatches {
  loading: boolean;
  /** Prompts may show at all: a real (non-demo) list with researched colleges. */
  eligible: boolean;
  /** Home state code when it is a US state the directory knows, else null. */
  state: string | null;
  stateName: string | null;
  specialties: Specialty[];
}

/** The store-aware version every screen uses: the student's home state and majors, demo and list checks. */
export function useCounselorAvailability(): CounselorAvailability {
  const { profile, hasProfile, demo, colleges } = useStore();
  const eligible = !demo && hasProfile && colleges.length > 0;
  const st = hasProfile && profile.home_state ? STATES.find((s) => s.code === profile.home_state && s.code !== "XX") ?? null : null;
  const specialties = useMemo(() => (hasProfile ? specialtiesForMajors(profile.majors) : []), [hasProfile, profile.majors]);
  const m = useCounselorMatches({ state: st?.code ?? null, specialties, enabled: eligible });
  return { ...m, eligible, state: st?.code ?? null, stateName: st?.name ?? null, specialties };
}

/** "3 counselors in North Carolina" / "1 counselor" (no home state → just the number). */
export function counselorsPhrase(count: number, stateName: string | null): string {
  const noun = count === 1 ? "counselor" : "counselors";
  return stateName ? `${count} ${noun} in ${stateName}` : `${count} ${noun}`;
}

// ───────────────────────────── copy ─────────────────────────────
// Facts about the directory, in plain words. Never "we recommend", never a name.

/** College page: "Applying to Duke? 3 counselors in North Carolina help with STEM applications." */
export function collegePromptText(short: string, a: Pick<CounselorMatches, "count" | "interestLabel" | "interestCount"> & { stateName: string | null }): string {
  // The number is exactly what the destination shows: the specialty's count when the copy names it
  // (the tap opens that filter), the whole state's count otherwise.
  if (a.interestCount > 0 && a.interestLabel) {
    return `Applying to ${short}? ${counselorsPhrase(a.interestCount, a.stateName)} ${a.interestCount === 1 ? "helps" : "help"} with ${a.interestLabel} applications.`;
  }
  return `Applying to ${short}? ${counselorsPhrase(a.count, a.stateName)} can help with your application.`;
}

/**
 * Deadlines: "Early Action deadline in 6 days — want someone to look over your application?"; when
 * several plans fall on that day, "3 deadlines in 6 days — … your applications?".
 */
export function deadlinePromptText(plans: readonly string[], days: number, count = plans.length): string {
  const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  if (plans.length === 1) return `${plans[0]} deadline ${when} — want someone to look over your application?`;
  return `${count} deadlines ${when} — want someone to look over your applications?`;
}

/** Research done: only for a reach-heavy list or one with Early Decision options; null otherwise. */
export function researchPromptText(reaches: number, total: number, hasEarlyDecision: boolean): string | null {
  if (reaches >= 3) return `${reaches} of your ${total} are reaches. A counselor can help you decide where to apply early.`;
  if (hasEarlyDecision) return "Some of your colleges offer Early Decision. A counselor can help you decide whether to apply early.";
  return null;
}

export const ASK_PROMPT_TEXT = { question: "Prefer to talk to a person?", action: "See counselors" } as const;

/** Ask tab: the kinds of questions where a person might serve better than a chat answer. */
export function askWantsCounselor(question: string): { match: boolean; specialty: Specialty | null } {
  const q = question.toLowerCase();
  if (/\bessay|personal statement|supplement/.test(q)) return { match: true, specialty: "essays" };
  if (/recommend(ation|er)s?\b|letters? of rec|\bED\b|\bEA\b|early (decision|action)|apply early|strateg|which (one |of these )?should i|should i (choose|pick|apply)|where should i apply|how do i choose|decide between/i.test(question)) return { match: true, specialty: null };
  return { match: false, specialty: null };
}

/** Where a tap lands: the directory, with a specialty chip preselected when one is relevant. */
export function counselorsHref(specialty?: string | null): string {
  return specialty && SPECIALTY_IDS.includes(specialty) ? `/counselors?specialty=${specialty}` : "/counselors";
}

// ───────────────────────────── the line ─────────────────────────────

export function CounselorPrompt({
  kind,
  children,
  specialty,
  compact,
  className = "",
}: {
  kind: PromptKind;
  /** One plain sentence. */
  children: React.ReactNode;
  /** Preselect this specialty chip in the directory. */
  specialty?: string | null;
  /** Ask-tab chip: tighter, no icon disc. */
  compact?: boolean;
  className?: string;
}) {
  const [dismissed, setDismissed] = useState(() => isPromptDismissed(kind));
  if (dismissed) return null;
  const dismiss = () => {
    dismissPrompt(kind);
    setDismissed(true);
  };
  const go = () => navigate(counselorsHref(specialty));
  if (compact) {
    return (
      // A quiet pill the width of the conversation; the sentence may wrap at 375pt, the × never clips.
      <div className={`flex items-center rounded-[18px] border-[0.5px] border-border bg-surface ${className}`} role="group" aria-label="Get expert help">
        <button type="button" className="cc-press flex min-h-[44px] min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 pr-1 text-left" onClick={go}>
          <IconLifebuoy size={16} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 text-footnote font-medium leading-[17px]">{children}</span>
          <IconChevronRight size={14} className="shrink-0 text-text-muted opacity-70" />
        </button>
        <button type="button" className="grid h-11 w-11 shrink-0 place-items-center self-stretch text-text-muted" aria-label="Dismiss for 30 days" onClick={dismiss}>
          <IconClose size={16} />
        </button>
      </div>
    );
  }
  return (
    <div className={`cc-card flex items-center ${className}`} role="group" aria-label="Get expert help">
      <button type="button" className="cc-press flex min-h-[52px] min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 pr-1 text-left" onClick={go}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden>
          <IconLifebuoy size={18} />
        </span>
        <span className="min-w-0 flex-1 text-subhead leading-5">{children}</span>
        <IconChevronRight size={18} className="shrink-0 text-text-muted opacity-70" />
      </button>
      <button type="button" className="grid h-11 w-11 shrink-0 place-items-center self-stretch text-text-muted" aria-label="Dismiss for 30 days" onClick={dismiss}>
        <IconClose size={16} />
      </button>
    </div>
  );
}

/**
 * Research-in-progress feedback: phase steps with timing, the "you can leave the app" card
 * (iOS app), the web "keep this tab open" note, and calm rotating tips. Presentational only;
 * `Research.tsx` owns the state.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Banner, Button } from "./ui";
import { IconBell, IconCheck, IconClose, IconWarning } from "./icons";

export type ResearchPhase = "planning" | "researching" | "done" | "stopped";

/** A full run (planner + agents in one wave) took about three minutes in live runs. */
export const EXPECTED_RUN_MS = 3 * 60_000;
/** The planner alone is about half a minute. */
export const EXPECTED_PLAN_MS = 30_000;

/** `m:ss`, never negative. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Rough "time left" wording from elapsed time vs. the expected total. Never negative: once the
 * estimate has passed it switches to "almost done…".
 */
export function describeRemaining(elapsedMs: number, expectedMs: number = EXPECTED_RUN_MS): string {
  const left = expectedMs - elapsedMs;
  if (left <= 0) return "almost done…";
  if (left < 50_000) return "less than a minute left";
  const min = Math.max(1, Math.round(left / 60_000));
  return `about ${min} min left`;
}

/** Ticks once a second while `active`; returns the current time in ms. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchReducedMotion());
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(!!mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}
function matchReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && !!window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// ───────────────────────────── Phase steps ─────────────────────────────

function StepIcon({ state }: { state: "waiting" | "active" | "done" | "stopped" }) {
  if (state === "active") return <span className="cc-spinner !h-4 !w-4 !border-2" aria-hidden />;
  if (state === "done") return <IconCheck size={16} />;
  if (state === "stopped") return <IconWarning size={16} />;
  return <span className="h-2 w-2 rounded-full bg-current opacity-40" aria-hidden />;
}

function StepRow({ state, label, hint }: { state: "waiting" | "active" | "done" | "stopped"; label: string; hint: ReactNode }) {
  const tone = state === "done" ? "bg-accent-soft text-accent" : state === "active" ? "bg-accent-soft text-accent" : state === "stopped" ? "text-warn" : "bg-surface-2 text-text-muted";
  const stopStyle = state === "stopped" ? { background: "color-mix(in srgb, var(--warn) 14%, transparent)" } : undefined;
  return (
    <div className="cc-row-static">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${tone}`} style={stopStyle}>
        <StepIcon state={state} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-body font-medium ${state === "waiting" ? "text-text-muted" : ""}`}>{label}</span>
        <span className="block text-footnote text-text-muted">{hint}</span>
      </span>
    </div>
  );
}

export interface PhaseStepsProps {
  phase: ResearchPhase;
  /** Colleges planned (0 until the planner answers). */
  total: number;
  done: number;
  failed: number;
  /** ms since the run started. */
  elapsedMs: number;
  /** Demo mode: sample data, no real waiting — hide timing copy. */
  demo?: boolean;
}

/** The two phases of a run as a grouped list, with elapsed time and a rough estimate while active. */
export function PhaseSteps({ phase, total, done, failed, elapsedMs, demo }: PhaseStepsProps) {
  const planning = phase === "planning";
  const researching = phase === "researching";
  const active = planning || researching;
  const failedNote = failed ? `, ${failed} failed` : "";

  const step1Hint = planning
    ? demo
      ? "Loading sample colleges…"
      : "About 30 seconds — please stay on this screen for this part."
    : `${total} colleges picked`;

  const step2State = planning ? "waiting" : researching ? "active" : phase === "done" ? "done" : "stopped";
  const step2Hint = planning
    ? "Starts as soon as your colleges are picked."
    : researching
      ? `${done} of ${total} done${failedNote}`
      : phase === "done"
        ? demo
          ? `${done} colleges ready`
          : `Finished in ${formatElapsed(elapsedMs)}`
        : `Stopped at ${done} of ${total}${failedNote}`;

  return (
    <section className="cc-group" aria-live="polite">
      <StepRow state={planning ? "active" : "done"} label="Picking colleges for you" hint={step1Hint} />
      <StepRow state={step2State} label="Researching each college" hint={step2Hint} />
      {active && !demo && (
        <div className="cc-row-static !min-h-0 justify-between gap-3 !py-2.5 text-footnote text-text-muted" aria-live="off">
          <span className="tnum">
            <span className="font-semibold text-text">{formatElapsed(elapsedMs)}</span> elapsed
          </span>
          <span className="truncate">{planning ? describePlanning(elapsedMs) : describeRemaining(elapsedMs)}</span>
        </div>
      )}
    </section>
  );
}

function describePlanning(elapsedMs: number): string {
  return elapsedMs < EXPECTED_PLAN_MS ? "about 30 seconds for this step" : "almost done picking…";
}

// ───────────────────────────── Leave the app / keep tab open ─────────────────────────────

export type NotifyState = "idle" | "asking" | "armed" | "declined";

/** iOS app, phase 2: offer a notification so the student can leave the app. */
export function LeaveAppCard({ state, onArm }: { state: NotifyState; onArm: () => void }) {
  return (
    <section className="mt-4 cc-card p-4" aria-label="You can leave the app">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          {state === "armed" ? <IconCheck size={18} /> : <IconBell size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-headline">
            {state === "armed" ? "We'll notify you — you can close the app" : state === "declined" ? "Keep the app open for now" : "You don't have to wait here"}
          </h3>
          {state !== "declined" && (
            <p className="mt-1 text-subhead text-text-muted">
              {state === "armed"
                ? "Research keeps running in the background. Open College Compass from the notification to see your list."
                : "Leave the app and we'll send a notification when your list is ready."}
            </p>
          )}
        </div>
      </div>
      {(state === "idle" || state === "asking") && (
        <div className="mt-3">
          <Button onClick={onArm} disabled={state === "asking"}>
            <IconBell size={20} /> {state === "asking" ? "Asking iOS…" : "Notify me when it's ready"}
          </Button>
        </div>
      )}
      {state === "declined" && (
        <div className="mt-3">
          <Banner tone="warn">Notifications are off, so keep the app open while we finish. You can turn them on anytime in iOS Settings → College Compass → Notifications.</Banner>
        </div>
      )}
    </section>
  );
}

/** Web / PWA: research stops if the tab goes away, so say so. */
export function KeepTabOpenNote() {
  return (
    <p className="cc-group-foot">
      <span className="font-semibold text-text">Keep this tab open</span> — research takes a few minutes.
    </p>
  );
}

// ───────────────────────────── Tips while waiting ─────────────────────────────

export const WAIT_TIPS = [
  "Odds are shown as a range, not a promise.",
  "Finished colleges appear below as they come in — tap one to see why it fits.",
  "Net price is what families like yours actually pay after aid, not the sticker price.",
  "Every college shows its data year and sources, so you can check the facts yourself.",
  "Fit scores follow the priorities you set. You can change them later in Settings.",
  "A balanced list mixes reaches, targets and safeties — that's what we're building.",
];

/** One short tip at a time, swapped every few seconds (held still under reduced motion). */
export function WaitTips({ intervalMs = 8000 }: { intervalMs?: number }) {
  const reduced = usePrefersReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setI((n) => (n + 1) % WAIT_TIPS.length), intervalMs);
    return () => clearInterval(t);
  }, [reduced, intervalMs]);
  const tip = WAIT_TIPS[i] ?? WAIT_TIPS[0];
  return (
    <p className="cc-group-foot" aria-live="off">
      <span key={i} className={reduced ? "" : "cc-tip-swap"}>
        {tip}
      </span>
    </p>
  );
}

/** Small inline glyph for one college inside an agent lane. */
export function CollegeStateGlyph({ state }: { state: "pending" | "done" | "failed" }) {
  if (state === "done") return <IconCheck size={13} className="mr-1 inline-block align-[-1px] text-good" />;
  if (state === "failed") return <IconClose size={13} className="mr-1 inline-block align-[-1px] text-bad" />;
  return <span className="cc-dot-pulse mr-1.5 inline-block h-1.5 w-1.5 align-[1px] rounded-full bg-text-muted" aria-hidden />;
}

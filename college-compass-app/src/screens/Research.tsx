import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { College, CollegeCandidate, ResearchEvent } from "@/types";
import { navigate } from "@/lib/router";
import { useStore } from "@/state/store";
import { describeError, rankColleges, researchApi } from "@/state/services";
import { cancelResearchNotification, notifyWhenResearchDone, requestNotificationPermission, supportsLeaveAndNotify } from "@/platform";
import { Screen, StickyActions } from "@/components/Screen";
import { CollegeCard } from "@/components/CollegeCard";
import { Banner, Button, ProgressBar } from "@/components/ui";
import { CollegeStateGlyph, KeepTabOpenNote, LeaveAppCard, PhaseSteps, WaitTips, useNow, type NotifyState } from "@/components/ResearchStatus";
import { IconCheck, IconRefresh, IconWarning } from "@/components/icons";

type Status = "planning" | "researching" | "done" | "cancelled" | "error";
interface Lane {
  batch: number;
  names: string[];
  done: string[];
  failed: string[];
  finished: boolean;
}

export function Research() {
  const { profile, colleges, setColleges, upsertCollege, demo, prefs, setPrefs, isSaved, toggleSaved, connected } = useStore();
  const [status, setStatus] = useState<Status>("planning");
  const [candidates, setCandidates] = useState<CollegeCandidate[]>([]);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [done, setDone] = useState<College[]>([]);
  const [failures, setFailures] = useState<{ name: string; error: string }[]>([]);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [notify, setNotify] = useState<NotifyState>("idle");
  const ctrl = useRef<AbortController | null>(null);
  const started = useRef(false);
  const statusRef = useRef<Status>("planning");
  const armed = useRef(false);
  statusRef.current = status;

  const canNotify = supportsLeaveAndNotify() && !demo;

  const onEvent = useCallback(
    (e: ResearchEvent) => {
      switch (e.type) {
        case "planning":
          setStatus("planning");
          break;
        case "planned":
          setCandidates(e.candidates);
          setStatus("researching");
          break;
        case "batch_started":
          setLanes((ls) => [...ls.filter((l) => l.batch !== e.batch), { batch: e.batch, names: e.names, done: [], failed: [], finished: false }]);
          break;
        case "college_done":
          setDone((d) => [...d.filter((c) => c.id !== e.college.id), e.college]);
          upsertCollege(e.college);
          setLanes((ls) => ls.map((l) => (l.names.some((n) => sameName(n, e.college.name)) ? { ...l, done: [...l.done, e.college.name] } : l)));
          break;
        case "college_failed":
          setFailures((f) => [...f.filter((x) => x.name !== e.name), { name: e.name, error: e.error }]);
          setLanes((ls) => ls.map((l) => (l.names.includes(e.name) ? { ...l, failed: [...l.failed, e.name] } : l)));
          break;
        case "batch_done":
          // A finished agent's colleges are done unless they failed — names can differ ("UNC Chapel Hill"
          // typed by the student vs. "The University of North Carolina at Chapel Hill" from research).
          setLanes((ls) =>
            ls.map((l) =>
              l.batch === e.batch
                ? { ...l, finished: true, done: l.names.filter((n) => !l.failed.includes(n)) }
                : l,
            ),
          );
          break;
        case "done":
          setStatus("done");
          setPrefs({ researchedAt: new Date().toISOString() });
          break;
        case "error":
          setStatus("error");
          setError({ title: "Research stopped", detail: e.error });
          break;
      }
    },
    [upsertCollege, setPrefs],
  );

  const start = useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setStatus("planning");
    setLanes([]);
    setDone([]);
    setFailures([]);
    setError(null);
    setNotify("idle");
    setStartedAt(Date.now());
    setColleges([]);
    researchApi(demo)
      .run({ profile, wanted: profile.wanted_colleges, target_count: Math.max(prefs.researchCount ?? 12, profile.wanted_colleges.length), cache: colleges, model: prefs.model ?? undefined, signal: c.signal, onEvent })
      .then(() => setStatus((s) => (s === "error" ? s : "done")))
      .catch((err) => {
        if (c.signal.aborted) {
          setStatus("cancelled");
          return;
        }
        setStatus("error");
        setError(describeError(err));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, profile, prefs.model, prefs.researchCount, onEvent]);

  useEffect(() => {
    if (!connected && !demo) {
      navigate("/", { replace: true });
      return;
    }
    if (started.current) return;
    started.current = true;
    start();
    return () => {
      ctrl.current?.abort();
      // Leaving the screen aborts the run, so a pending "list is ready" notification would lie.
      if (armed.current) {
        armed.current = false;
        void cancelResearchNotification();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = () => {
    ctrl.current?.abort();
    setStatus("cancelled");
  };

  const retry = async (name: string) => {
    setRetrying(name);
    try {
      const college = await researchApi(demo).researchOne(name, profile, prefs.model ?? undefined);
      onEvent({ type: "college_done", college });
      setFailures((f) => f.filter((x) => x.name !== name));
    } catch (err) {
      setFailures((f) => f.map((x) => (x.name === name ? { ...x, error: describeError(err).detail } : x)));
    } finally {
      setRetrying(null);
    }
  };

  const total = Math.max(candidates.length, done.length + failures.length, 1);
  const finished = status === "done" || status === "cancelled" || status === "error";
  const progress = status === "done" ? 1 : status === "planning" ? 0.02 : (done.length + failures.length) / total;
  const ranked = useMemo(() => rankColleges(done, profile), [done, profile]);

  // Elapsed-time clock (ticks only while the run is active).
  const now = useNow(!finished);
  const elapsedMs = Math.max(0, now - startedAt);

  // ── "Notify me when it's ready" (iOS app) ──
  const arm = useCallback(async () => {
    setNotify("asking");
    const granted = await requestNotificationPermission();
    if (statusRef.current !== "researching") {
      // The run ended while iOS was asking; nothing to arm.
      setNotify(granted ? "idle" : "declined");
      if (granted) setPrefs({ notifyWhenReady: true });
      return;
    }
    if (!granted) {
      setNotify("declined");
      setPrefs({ notifyWhenReady: false });
      return;
    }
    const n = candidates.length;
    await notifyWhenResearchDone("Your college list is ready", `${n} ${n === 1 ? "college" : "colleges"} researched — open College Compass to see your odds.`);
    armed.current = true;
    setNotify("armed");
    setPrefs({ notifyWhenReady: true });
  }, [candidates.length, setPrefs]);

  // Pre-armed from a previous run: arm as soon as phase 2 starts (permission resolves at once once granted).
  useEffect(() => {
    if (status === "researching" && canNotify && prefs.notifyWhenReady && notify === "idle") void arm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canNotify]);

  // Finished (or failed / cancelled) while the screen is open: disarm. iOS never shows it in the
  // foreground anyway, but a stale "ready" notification after a failure would mislead.
  useEffect(() => {
    if (!finished || !armed.current) return;
    armed.current = false;
    void cancelResearchNotification();
  }, [finished]);

  const largeTitle =
    status === "planning"
      ? "Picking colleges for you"
      : status === "researching"
        ? `Researching ${candidates.length} ${candidates.length === 1 ? "college" : "colleges"}`
        : status === "done"
          ? "Research complete"
          : status === "cancelled"
            ? "Research stopped"
            : "Research failed";

  const subtitle =
    status === "planning"
      ? demo
        ? "Demo mode: loading sample research."
        : profile.wanted_colleges.length
          ? `Starting with the ${profile.wanted_colleges.length} you named, then filling in the rest.`
          : "ChatGPT is choosing colleges that match your answers."
      : status === "researching"
        ? demo
          ? "Demo mode: loading sample research."
          : "Agents are reading each college's Common Data Set, costs and deadlines. This usually takes 2–4 minutes."
        : `${done.length} of ${total} colleges researched${failures.length ? `, ${failures.length} failed` : ""}.`;

  return (
    <Screen
      title="Researching"
      largeTitle={largeTitle}
      subtitle={subtitle}
      bar={<ProgressBar value={progress} label="Research progress" />}
      footer={
        <StickyActions>
          {finished ? (
            <>
              <Button onClick={() => navigate("/list", { replace: true })} disabled={done.length === 0}>
                See my list
              </Button>
              {(status === "cancelled" || status === "error") && (
                <Button variant="secondary" onClick={start}>
                  <IconRefresh size={20} /> Start over
                </Button>
              )}
            </>
          ) : (
            <>
              {done.length >= 3 && (
                <Button variant="secondary" onClick={() => navigate("/list", { replace: true })}>
                  Peek at {done.length} so far
                </Button>
              )}
              <Button variant="quiet" onClick={cancel}>
                Cancel
              </Button>
            </>
          )}
        </StickyActions>
      }
    >
      {error && (
        <div className="mb-4">
          <Banner tone="error">
            <strong>{error.title}.</strong> {error.detail}
          </Banner>
        </div>
      )}

      {/* Phases */}
      <PhaseSteps
        phase={status === "planning" ? "planning" : status === "researching" ? "researching" : status === "done" ? "done" : "stopped"}
        total={candidates.length}
        done={done.length}
        failed={failures.length}
        elapsedMs={elapsedMs}
        demo={demo}
      />
      {!finished && !demo && <WaitTips />}

      {/* Leave the app (iOS) / keep the tab open (web) */}
      {status === "researching" && canNotify && <LeaveAppCard state={notify} onArm={() => void arm()} />}
      {status === "researching" && !canNotify && !demo && <KeepTabOpenNote />}

      {/* Agent lanes */}
      {lanes.length > 0 && (
        <section className="mt-4">
          <h3 className="cc-group-label">Research agents</h3>
          <div className="cc-group">
            {lanes
              .slice()
              .sort((a, b) => a.batch - b.batch)
              .map((l) => {
                const anyFailed = l.failed.length > 0;
                return (
                  <div key={l.batch} className="cc-row-static" data-lane={l.batch + 1}>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${l.finished ? (anyFailed ? "text-warn" : "bg-accent-soft text-accent") : "bg-surface-2 text-text-muted"}`} style={l.finished && anyFailed ? { background: "color-mix(in srgb, var(--warn) 14%, transparent)" } : undefined}>
                      {l.finished ? anyFailed ? <IconWarning size={16} /> : <IconCheck size={16} /> : <span className="cc-spinner !h-4 !w-4 !border-2" aria-hidden />}
                    </span>
                    <p className="min-w-0 flex-1 text-subhead leading-[22px]">
                      <span className="font-semibold">Agent {l.batch + 1}</span>
                      <span className="text-text-muted"> · </span>
                      {l.names.map((n, i) => {
                        const state = l.done.some((d) => sameName(d, n)) ? "done" : l.failed.includes(n) ? "failed" : "pending";
                        const space = n.indexOf(" ");
                        const head = space < 0 ? n : n.slice(0, space);
                        const tail = space < 0 ? "" : n.slice(space);
                        return (
                          <span key={n} className={state === "done" ? "text-text" : state === "failed" ? "text-bad" : "text-text-muted"}>
                            {/* glyph + first word never split across lines */}
                            <span className="whitespace-nowrap">
                              <CollegeStateGlyph state={state} />
                              {head}
                            </span>
                            {tail}
                            {i < l.names.length - 1 && <span className="text-text-muted">, </span>}
                          </span>
                        );
                      })}
                    </p>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* Failures */}
      {failures.length > 0 && (
        <section className="mt-4">
          <h3 className="cc-group-label">Couldn't research</h3>
          <div className="cc-group">
            {failures.map((f) => (
              <div key={f.name} className="cc-row-static">
                <IconWarning size={20} className="shrink-0 text-warn" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body">{f.name}</span>
                  <span className="block truncate text-footnote text-text-muted">{f.error}</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => retry(f.name)} disabled={retrying === f.name}>
                  {retrying === f.name ? "Retrying…" : "Retry"}
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Results popping in */}
      <section className="mt-4">
        {ranked.length > 0 && <h3 className="cc-group-label">Researched so far</h3>}
        <div className="space-y-3">
          {ranked.map((r) => (
            <CollegeCard key={r.college.id} item={r} compact pop saved={isSaved(r.college.id)} onToggleSave={() => toggleSaved(r.college.id)} />
          ))}
        </div>
      </section>
    </Screen>
  );
}

function sameName(a: string, b: string) {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const x = n(a);
  const y = n(b);
  return x === y || x.includes(y) || y.includes(x);
}

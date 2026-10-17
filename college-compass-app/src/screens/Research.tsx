import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { College, CollegeCandidate, ResearchEvent } from "@/types";
import { navigate } from "@/lib/router";
import { useStore } from "@/state/store";
import { describeError, rankColleges, researchApi } from "@/state/services";
import { Screen, StickyActions } from "@/components/Screen";
import { CollegeCard } from "@/components/CollegeCard";
import { Banner, Button, ProgressBar, Spinner } from "@/components/ui";
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
  const ctrl = useRef<AbortController | null>(null);
  const started = useRef(false);

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
          setLanes((ls) => ls.map((l) => (l.batch === e.batch ? { ...l, finished: true } : l)));
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
    setColleges([]);
    researchApi(demo)
      .run({ profile, wanted: profile.wanted_colleges, cache: colleges, model: prefs.model ?? undefined, signal: c.signal, onEvent })
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
  }, [demo, profile, prefs.model, onEvent]);

  useEffect(() => {
    if (!connected && !demo) {
      navigate("/", { replace: true });
      return;
    }
    if (started.current) return;
    started.current = true;
    start();
    return () => ctrl.current?.abort();
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
  const progress = status === "done" ? 1 : (done.length + failures.length) / total;
  const ranked = useMemo(() => rankColleges(done, profile), [done, profile]);
  const finished = status === "done" || status === "cancelled" || status === "error";

  return (
    <Screen
      title="Researching"
      largeTitle={status === "planning" ? "Planning your list" : status === "researching" ? "Researching colleges" : status === "done" ? "Research complete" : status === "cancelled" ? "Research stopped" : "Research failed"}
      subtitle={
        status === "planning"
          ? demo
            ? "Demo mode: loading sample research."
            : profile.wanted_colleges.length
              ? `Starting with ${profile.wanted_colleges.length} you named, then filling in the rest.`
              : "ChatGPT is choosing about 15 candidates that match your answers."
          : `${done.length} of ${total} colleges researched${failures.length ? `, ${failures.length} failed` : ""}.`
      }
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

      {/* Planner */}
      <section className="cc-group">
        <div className="cc-row-static">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
            {status === "planning" ? <span className="cc-spinner !h-4 !w-4 !border-2" /> : <IconCheck size={16} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium">Planner</span>
            <span className="block text-footnote text-text-muted">{status === "planning" ? "Picking candidates…" : `${candidates.length} candidates chosen`}</span>
          </span>
        </div>
      </section>

      {/* Agent lanes */}
      {lanes.length > 0 && (
        <section className="mt-4">
          <h3 className="cc-group-label">Research agents</h3>
          <div className="grid grid-cols-2 gap-2">
            {lanes.map((l) => (
              <div key={l.batch} className="cc-card p-3">
                <div className="flex items-center gap-2">
                  {l.finished ? <IconCheck size={16} className="text-good" /> : <span className="cc-spinner !h-4 !w-4 !border-2" aria-hidden />}
                  <span className="text-footnote font-semibold">Agent {l.batch + 1}</span>
                </div>
                <ul className="mt-2 space-y-1">
                  {l.names.map((n) => {
                    const ok = l.done.some((d) => sameName(d, n));
                    const bad = l.failed.includes(n);
                    return (
                      <li key={n} className={`flex items-center gap-1.5 text-footnote ${ok ? "text-text" : bad ? "text-bad" : "text-text-muted"}`}>
                        <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${ok ? "bg-good" : bad ? "bg-bad" : "cc-dot-pulse bg-text-muted"}`} aria-hidden />
                        <span className="truncate">{n}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
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
        {status === "planning" && (
          <div className="flex justify-center py-10">
            <Spinner label="This usually takes a minute or two." />
          </div>
        )}
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

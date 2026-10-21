/**
 * "Get expert help": the paid counselor directory (docs/COUNSELORS_CONTRACT.md).
 *
 * Read-only in the app. Filters are a state (defaults to the student's home state; "Virtual –
 * anywhere" lists counselors who serve students nationwide) and specialty chips preselected from the
 * student's majors. The only data sent is those filters. No sign-up or payment lives here: counselors
 * join on the website, never from the app.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/state/store";
import { STATES, stateName } from "@/state/catalog";
import { Screen } from "@/components/Screen";
import { Sheet } from "@/components/Sheet";
import { Banner, Button, CardSkeleton, Chip, Empty } from "@/components/ui";
import { IconCheck, IconChevronDown, IconSearch } from "@/components/icons";
import { CounselorCard } from "@/components/CounselorCard";
import { REPORT_REASONS, SPECIALTIES, createDirectoryApi, specialtiesForMajors, type Counselor, type DirectoryApi, type DirectoryError, type ReportReason } from "@/data/counselors";

/** "Virtual – anywhere" in the state picker: no state filter, so nationwide counselors show. */
const ANYWHERE = "";

export const COUNSELORS_INTRO = "Independent counselors who help families with applications. Counselors pay to be listed — listings never affect your college list, and College Compass never shares your answers with them.";

export function Counselors({ api: apiProp }: { /** Tests inject a mocked API. */ api?: DirectoryApi | null }) {
  const { profile, hasProfile } = useStore();
  const api = useMemo(() => (apiProp !== undefined ? apiProp : createDirectoryApi()), [apiProp]);
  const home = hasProfile && profile.home_state && STATES.some((s) => s.code === profile.home_state && s.code !== "XX") ? profile.home_state : ANYWHERE;
  const [state, setState] = useState<string>(home);
  const [specialties, setSpecialties] = useState<string[]>(() => (hasProfile ? specialtiesForMajors(profile.majors) : []));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [items, setItems] = useState<Counselor[] | null>(null);
  const [error, setError] = useState<DirectoryError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reporting, setReporting] = useState<Counselor | null>(null);

  useEffect(() => {
    if (!api) {
      setItems([]);
      setError("unavailable");
      return;
    }
    const ctl = new AbortController();
    setItems(null);
    setError(null);
    api
      .list(state || null, specialties, ctl.signal)
      .then((rows) => {
        if (!ctl.signal.aborted) setItems(rows);
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setItems([]);
        setError(e === "offline" ? "offline" : "unavailable");
      });
    return () => ctl.abort();
  }, [api, state, specialties, attempt]);

  const toggle = (id: string) => setSpecialties((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const whereLabel = state ? stateName(state) : "Virtual – anywhere";

  return (
    <>
      <Screen title="Get expert help" back="/settings" backLabel="Back">
        <p className="pb-3 text-subhead text-text-muted">{COUNSELORS_INTRO}</p>

        <button type="button" className="cc-input cc-press flex items-center justify-between text-left" onClick={() => setPickerOpen(true)} aria-haspopup="dialog" aria-label={`Where: ${whereLabel}`}>
          <span className="min-w-0 truncate">
            <span className="text-text-muted">Where · </span>
            {whereLabel}
          </span>
          <IconChevronDown size={20} className="shrink-0 text-text-muted" />
        </button>

        <div className="-mx-4 mt-3 overflow-x-auto px-4 pb-1" role="group" aria-label="Specialty">
          <div className="flex w-max gap-2">
            <Chip selected={specialties.length === 0} onClick={() => setSpecialties([])}>
              All
            </Chip>
            {SPECIALTIES.map((s) => (
              <Chip key={s.id} selected={specialties.includes(s.id)} onClick={() => toggle(s.id)}>
                {s.label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-3" aria-busy={items === null}>
          {items === null ? (
            <>
              <CardSkeleton />
              <CardSkeleton />
            </>
          ) : error ? (
            <div className="space-y-3">
              <Banner tone={error === "offline" ? "warn" : "error"}>{error === "offline" ? "You're offline. The directory needs a connection." : "The directory isn't available right now. Please try again later."}</Banner>
              {api && (
                <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </Button>
              )}
            </div>
          ) : items.length === 0 ? (
            <Empty
              icon="🧑‍🏫"
              title={state ? `No counselors listed for ${state} yet` : "No counselors listed yet"}
              message={state ? "Try “Virtual – anywhere” to see counselors who work with families in every state." : specialties.length ? "Try clearing the specialty filter." : "Check back soon."}
              action={
                state ? (
                  <Button variant="secondary" onClick={() => setState(ANYWHERE)}>
                    Show virtual counselors
                  </Button>
                ) : specialties.length ? (
                  <Button variant="secondary" onClick={() => setSpecialties([])}>
                    Show all specialties
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <p className="text-footnote text-text-muted">
                {items.length} {items.length === 1 ? "counselor" : "counselors"} · order changes daily
              </p>
              {items.map((c) => (
                <CounselorCard key={c.id} counselor={c} onReport={setReporting} />
              ))}
            </>
          )}
        </div>

        <p className="mt-8 text-center text-caption text-text-muted">
          College Compass lists counselors for a fee and does not vet or endorse their services. Admission outcomes are never guaranteed. Students under 18: involve a parent or guardian before contacting anyone.
        </p>
      </Screen>

      <StateSheet open={pickerOpen} value={state} onClose={() => setPickerOpen(false)} onChange={(v) => { setState(v); setPickerOpen(false); }} />
      <ReportSheet counselor={reporting} api={api} onClose={() => setReporting(null)} />
    </>
  );
}

function StateSheet({ open, value, onClose, onChange }: { open: boolean; value: string; onClose: () => void; onChange: (v: string) => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const states = STATES.filter((st) => st.code !== "XX");
    if (!s) return states;
    return states.filter((st) => st.code.toLowerCase() === s || st.name.toLowerCase().includes(s));
  }, [q]);
  useEffect(() => {
    if (open) setQ("");
  }, [open]);
  const Row = ({ code, name }: { code: string; name: string }) => (
    <button type="button" className="cc-row cc-row-press" aria-pressed={code === value} onClick={() => onChange(code)}>
      <span className="flex-1 text-body">{name}</span>
      {code === value && <IconCheck size={20} className="text-accent" />}
    </button>
  );
  return (
    <Sheet open={open} onClose={onClose} title="Where">
      <div className="cc-search mb-3">
        <IconSearch size={18} className="text-text-muted" />
        <input placeholder="Search states" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search states" />
      </div>
      <div className="cc-group">
        {!q && <Row code={ANYWHERE} name="Virtual – anywhere" />}
        {list.map((st) => (
          <Row key={st.code} code={st.code} name={st.name} />
        ))}
      </div>
    </Sheet>
  );
}

function ReportSheet({ counselor, api, onClose }: { counselor: Counselor | null; api: DirectoryApi | null; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const prev = useRef<string | null>(null);
  // Reset when a different counselor is reported.
  useEffect(() => {
    if (counselor && counselor.id !== prev.current) {
      prev.current = counselor.id;
      setReason(null);
      setDetail("");
      setDone(false);
      setErr(null);
    }
    if (!counselor) prev.current = null;
  }, [counselor]);

  const send = async () => {
    if (!counselor || !reason || !api || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.report(counselor.id, reason, detail);
      setDone(true);
    } catch (e) {
      setErr(e === "offline" ? "You're offline. Please try again when you have a connection." : "Couldn't send the report right now. Please try again later.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!counselor}
      onClose={() => !busy && onClose()}
      title="Report listing"
      right={
        <button type="button" className="cc-link min-h-tap px-1 text-body" onClick={onClose} disabled={busy}>
          {done ? "Done" : "Cancel"}
        </button>
      }
    >
      {done ? (
        <div className="px-1 pb-2 pt-4 text-center">
          <div className="mb-3 text-[40px] leading-none" aria-hidden>
            ✅
          </div>
          <h3 className="text-title3">Thanks for letting us know</h3>
          <p className="mt-2 text-subhead text-text-muted">We review every report and remove listings that break the rules.</p>
          <div className="mt-5">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-subhead text-text-muted">
            Reporting <span className="font-medium text-text">{counselor?.name}</span>. Reports are anonymous — nothing about you is sent.
          </p>
          <div className="cc-group mt-3" role="radiogroup" aria-label="Reason">
            {REPORT_REASONS.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={reason === r.id} className="cc-row cc-row-press" onClick={() => setReason(r.id)}>
                <span className="flex-1 text-body">{r.label}</span>
                {reason === r.id && <IconCheck size={20} className="text-accent" />}
              </button>
            ))}
          </div>
          <textarea className="cc-input mt-3" rows={3} placeholder="Anything else? (optional)" value={detail} maxLength={1000} onChange={(e) => setDetail(e.target.value)} aria-label="Details (optional)" />
          {err && (
            <div className="mt-3">
              <Banner tone="error">{err}</Banner>
            </div>
          )}
          <div className="pt-4">
            <Button onClick={send} disabled={!reason || busy || !api} aria-busy={busy}>
              {busy ? "Sending…" : "Send report"}
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}

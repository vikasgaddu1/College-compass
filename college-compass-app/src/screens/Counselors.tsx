/**
 * "Get expert help": the paid counselor directory (docs/COUNSELORS_CONTRACT.md).
 *
 * Read-only in the app. Filters are a state (defaults to the student's home state; "Virtual –
 * anywhere" lists counselors who serve students nationwide) and specialty chips preselected from the
 * student's majors. The only data sent is those filters. No sign-up or payment lives here: counselors
 * join on the website, never from the app. "Invite your counselor" hands a fixed message + the website
 * link to the share sheet (src/platform shareText): nothing about the student, nothing stored or sent.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRoute } from "@/lib/router";
import { shareText } from "@/platform";
import { useStore } from "@/state/store";
import { STATES, stateName } from "@/state/catalog";
import { Screen } from "@/components/Screen";
import { COUNSELOR_INDEPENDENCE } from "@/legal/notice";
import { Sheet } from "@/components/Sheet";
import { Banner, Button, CardSkeleton, Chip, Empty } from "@/components/ui";
import { IconCheck, IconChevronDown, IconSearch } from "@/components/icons";
import { CounselorCard } from "@/components/CounselorCard";
import { REPORT_REASONS, SPECIALTIES, SPECIALTY_IDS, createDirectoryApi, specialtiesForMajors, type Counselor, type DirectoryApi, type DirectoryError, type ReportReason, COUNSELOR_INFO_URL, COUNSELOR_INVITE_MESSAGE, COUNSELOR_INVITE_TITLE, COUNSELOR_INVITE_URL } from "@/data/counselors";

/** "Virtual – anywhere" in the state picker: no state filter, so nationwide counselors show. */
const ANYWHERE = "";

export const COUNSELORS_INTRO = "Independent counselors who help families with applications. Counselors pay to be listed — listings never affect your college list, and Tierwise never shares your answers with them.";

/** Shown after the invite was copied instead of shared (no share sheet on this platform). */
export const INVITE_COPIED = "Invite copied — paste it in a message";

/** The full invite as shared: message, then the link on its own line. */
export const COUNSELOR_INVITE_TEXT = `${COUNSELOR_INVITE_MESSAGE}\n${COUNSELOR_INVITE_URL}`;

/**
 * "Invite your counselor": hand the ready-made message + link to the share sheet. The link travels
 * inside `text` (no separate `url`): some iOS targets, WhatsApp among them, keep only the url when
 * both are given, so this way every target gets one message with the link once. Returns what the
 * platform did; a dismissed sheet is "cancelled" and callers say nothing. No student data leaves the
 * phone — the message is the same for everyone.
 */
export function shareCounselorInvite() {
  return shareText({ title: COUNSELOR_INVITE_TITLE, text: COUNSELOR_INVITE_TEXT });
}

export function Counselors({ api: apiProp, tabBar }: { /** Tests inject a mocked API. */ api?: DirectoryApi | null; tabBar?: ReactNode }) {
  const { profile, hasProfile } = useStore();
  // `#/counselors?specialty=essays` (from a contextual prompt) preselects that chip instead of the majors.
  const wanted = useRoute().query.specialty;
  const api = useMemo(() => (apiProp !== undefined ? apiProp : createDirectoryApi()), [apiProp]);
  const home = hasProfile && profile.home_state && STATES.some((s) => s.code === profile.home_state && s.code !== "XX") ? profile.home_state : ANYWHERE;
  const [state, setState] = useState<string>(home);
  const [specialties, setSpecialties] = useState<string[]>(() => (wanted && SPECIALTY_IDS.includes(wanted) ? [wanted] : hasProfile ? specialtiesForMajors(profile.majors) : []));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [items, setItems] = useState<Counselor[] | null>(null);
  const [error, setError] = useState<DirectoryError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reporting, setReporting] = useState<Counselor | null>(null);
  // "Invite copied" shown in place of the invite control (web fallback); a dismissed share sheet shows nothing.
  const [inviteNote, setInviteNote] = useState<string | null>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!inviteNote) return;
    const t = setTimeout(() => setInviteNote(null), 2500);
    return () => clearTimeout(t);
  }, [inviteNote]);

  const invite = async () => {
    const outcome = await shareCounselorInvite();
    if (outcome === "copied") setInviteNote(INVITE_COPIED);
  };

  // Arriving with a preselected specialty: bring that chip into view so the selection is visible.
  useEffect(() => {
    if (!wanted) return;
    const el = chipsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    el?.scrollIntoView?.({ inline: "center", block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // "Virtual – anywhere" asks for counselors who work virtually, not every listing.
        if (!ctl.signal.aborted) setItems(state ? rows : rows.filter((c) => c.modes.includes("virtual")));
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
      <Screen title="Get expert help" footer={tabBar}>
        <p className="pb-3 text-subhead text-text-muted">{COUNSELORS_INTRO}</p>

        <button type="button" className="cc-input cc-press flex items-center justify-between text-left" onClick={() => setPickerOpen(true)} aria-haspopup="dialog" aria-label={`Where: ${whereLabel}`}>
          <span className="min-w-0 truncate">
            <span className="text-text-muted">Where · </span>
            {whereLabel}
          </span>
          <IconChevronDown size={20} className="shrink-0 text-text-muted" />
        </button>

        <div ref={chipsRef} className="-mx-4 mt-3 overflow-x-auto px-4 pb-1" role="group" aria-label="Specialty">
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
              title={state ? `No counselors listed in ${stateName(state)} yet` : "No counselors listed yet"}
              message={state ? "We're adding counselors — check back soon. Meanwhile, counselors who work virtually help families in every state." : specialties.length ? "Try clearing the specialty filter." : "We're adding counselors — check back soon. Already working with one? Invite them to get listed."}
              action={
                // A filter button keeps the lead when a filter hides counselors; the invite sits under it as a link.
                // With nothing filtered there is nothing else to do, so the invite is the button.
                state ? (
                  <>
                    <Button variant="secondary" onClick={() => setState(ANYWHERE)}>
                      Show virtual counselors
                    </Button>
                    <InviteLink onClick={invite} note={inviteNote} className="mt-1" />
                  </>
                ) : specialties.length ? (
                  <>
                    <Button variant="secondary" onClick={() => setSpecialties([])}>
                      Show all specialties
                    </Button>
                    <InviteLink onClick={invite} note={inviteNote} className="mt-1" />
                  </>
                ) : (
                  <>
                    <Button onClick={invite}>Invite your counselor</Button>
                    {inviteNote && (
                      <p role="status" className="mt-3 text-center text-footnote text-accent">
                        {inviteNote}
                      </p>
                    )}
                  </>
                )
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
              <InviteLink onClick={invite} note={inviteNote} className="pt-2" />
            </>
          )}
        </div>

        <p className="mt-8 text-center text-caption text-text-muted">
          Tierwise lists counselors for a fee and does not vet or endorse their services. {COUNSELOR_INDEPENDENCE} Admission outcomes are never guaranteed. Students under 18: involve a parent or guardian before contacting anyone.
        </p>
        <p className="mt-4 pb-2 text-center text-footnote">
          <a className="cc-link inline-flex min-h-tap items-center" href={COUNSELOR_INFO_URL} target="_blank" rel="noopener noreferrer">
            Are you a counselor? Learn about being listed →
          </a>
        </p>
      </Screen>

      <StateSheet open={pickerOpen} value={state} onClose={() => setPickerOpen(false)} onChange={(v) => { setState(v); setPickerOpen(false); }} />
      <ReportSheet counselor={reporting} api={api} onClose={() => setReporting(null)} />
    </>
  );
}

/**
 * "Don't see your counselor? Invite them" — quiet, so it never competes with the listings or the
 * filter button. While `note` is set (invite copied on the web) it shows that instead, in place.
 */
function InviteLink({ onClick, note, className = "" }: { onClick: () => void; note?: string | null; className?: string }) {
  if (note)
    return (
      <p role="status" className={`inline-flex min-h-tap w-full items-center justify-center text-center text-footnote text-accent ${className}`}>
        {note}
      </p>
    );
  return (
    <p className={`text-center text-footnote text-text-muted ${className}`}>
      Don't see your counselor?{" "}
      <button type="button" className="cc-link inline-flex min-h-tap items-center" onClick={onClick}>
        Invite them
      </button>
    </p>
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
      setErr(
        e === "offline"
          ? "You're offline. Please try again when you have a connection."
          : e === "rate_limited"
            ? "You've sent several reports recently. Please try again in an hour."
            : e === "gone"
              ? "This listing is no longer in the directory."
              : "Couldn't send the report right now. Please try again later.",
      );
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

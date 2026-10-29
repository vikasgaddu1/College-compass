/** Owner's review desk: pending / changes waiting / live / rejected·suspended / reports. */
import { useEffect, useMemo, useState } from "react";
import { Banner, Chip } from "@/components/ui";
import { CounselorCard } from "@/components/CounselorCard";
import { REPORT_REASONS, toCounselor } from "@/data/counselors";
import { describeError, type AdminRow, type Decision, type Draft, type Report, type ReviewResult } from "../api";
import { usePortal } from "../Portal";
import { diffFields } from "../validate";
import { isListed } from "./Profile";

type Tab = "pending" | "changes" | "live" | "closed" | "reports";
const TABS: { id: Tab; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "changes", label: "Changes waiting" },
  { id: "live", label: "Live" },
  { id: "closed", label: "Rejected · Suspended" },
  { id: "reports", label: "Reports" },
];

export function bucket(r: AdminRow): Exclude<Tab, "reports"> {
  if (r.status === "pending") return "pending";
  if (r.status === "approved" && r.awaiting_review) return "changes";
  if (r.status === "approved") return "live";
  return "closed"; // rejected, suspended, draft
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Short date; a date-only value (founding_until) is read as a calendar day, not UTC midnight, so it never shows a day early. */
export const fmt = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const m = DATE_ONLY.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

/** The saved state an action ends in — from the RPC response, or the reloaded row when the server sent nothing back. */
type Truth = Pick<ReviewResult, "status" | "listed" | "founding_until">;

const NOT_LISTED = "set a founding date or the counselor subscribes";

function listing(t: Truth): string {
  if (t.listed) return "now listed in the app.";
  switch (t.status) {
    case "pending":
      return "not listed yet: approve the listing to publish it.";
    case "approved": {
      const past = t.founding_until && DATE_ONLY.test(t.founding_until) && new Date(t.founding_until + "T23:59:59") < new Date();
      return past ? `not listed: ${fmt(t.founding_until)} has passed — pick a future date, or the counselor subscribes.` : `not listed yet: ${NOT_LISTED}.`;
    }
    case "suspended":
      return "hidden from the app while suspended.";
    case "rejected":
      return "not listed (rejected).";
    default:
      return "not listed (draft).";
  }
}

/** One sentence for the row after an action succeeds, specific to what the server saved. */
export function describeOutcome(decision: Decision, before: AdminRow, truth: Truth | null, foundingSent: string | null): string {
  const wasApproved = before.status === "approved";
  if (!truth) {
    const verb = { approve: "Approved", reject: wasApproved ? "Changes declined" : "Rejected", suspend: "Suspended", unsuspend: "Unsuspended", founding: "Founding date saved" }[decision];
    return `${verb}. Refresh to see the listing state.`;
  }
  const foundingNote = foundingSent && decision !== "founding" ? ` Founding listing until ${fmt(truth.founding_until ?? foundingSent)}.` : "";
  switch (decision) {
    case "founding":
      return `Founding listing set until ${fmt(truth.founding_until ?? foundingSent)} — ${listing(truth)}`;
    case "approve":
      return `${wasApproved ? "Changes approved" : "Approved"} — ${listing(truth)}${foundingNote}`;
    case "reject":
      return (wasApproved ? "Changes declined — the published listing stays as it was." : "Rejected — the counselor will see your note.") + foundingNote;
    case "suspend":
      return `Suspended — hidden from the app.${foundingNote}`;
    case "unsuspend":
      return (truth.status === "approved" ? `Unsuspended — ${listing(truth)}` : "Unsuspended — back to draft; the counselor can finish the profile and resubmit.") + foundingNote;
  }
}

export function Admin() {
  const { api } = usePortal();
  const [tab, setTab] = useState<Tab>("pending");
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Last successful action per counselor, shown on that row until the next action on it. */
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  /** The most recent action's row — so the owner still sees the result when the row moved to another queue. */
  const [last, setLast] = useState<string | null>(null);

  const reload = async (): Promise<AdminRow[] | null> => {
    if (!api) return null;
    try {
      const [r, rep] = await Promise.all([api.adminCounselors(), api.adminReports()]);
      setRows(r);
      setReports(rep);
      setErr(null);
      return r;
    } catch (e) {
      setErr(describeError(e));
      return null;
    }
  };
  const onOutcome = (id: string, text: string) => {
    setOutcomes((o) => ({ ...o, [id]: text }));
    setLast(id);
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { pending: 0, changes: 0, live: 0, closed: 0, reports: reports?.length ?? 0 };
    for (const r of rows ?? []) c[bucket(r)]++;
    return c;
  }, [rows, reports]);
  const shown = (rows ?? []).filter((r) => tab !== "reports" && bucket(r) === tab);
  const lastRow = last ? (rows ?? []).find((r) => r.id === last) : undefined;
  const moved = lastRow && tab !== "reports" && bucket(lastRow) !== tab ? lastRow : null;

  return (
    <div className="py-8">
      <h1 className="cp-h2">Admin</h1>
      <p className="text-subhead text-text-muted">Review listings. Approving copies the current draft into the published listing families see.</p>
      <div className="cp-tabs mt-5" role="tablist" aria-label="Queues">
        {TABS.map((t) => (
          <Chip key={t.id} role="tab" aria-selected={tab === t.id} selected={tab === t.id} onClick={() => { setTab(t.id); setLast(null); }}>
            {t.label} <span className="tnum opacity-70">{counts[t.id]}</span>
          </Chip>
        ))}
      </div>
      {err && (
        <div className="mt-4">
          <Banner tone="error">{err}</Banner>
        </div>
      )}
      {moved && (
        <div className="mt-4" role="status">
          <Banner tone="info">
            <strong>{moved.name ?? moved.account_email ?? moved.id}:</strong> {outcomes[moved.id]} Now under “{TABS.find((t) => t.id === bucket(moved))?.label}”.{" "}
            <button type="button" className="cc-link" onClick={() => setTab(bucket(moved))}>
              Show
            </button>
          </Banner>
        </div>
      )}
      {!rows && !err && <p className="py-10 text-center text-subhead text-text-muted">Loading…</p>}
      {rows && tab !== "reports" && shown.length === 0 && <p className="py-10 text-center text-subhead text-text-muted">Nothing here.</p>}
      {rows && tab !== "reports" && (
        <div className="mt-4 space-y-4">
          {shown.map((r) => (
            <ReviewRow key={r.id} row={r} outcome={outcomes[r.id] ?? null} reload={reload} onOutcome={onOutcome} />
          ))}
        </div>
      )}
      {tab === "reports" && <ReportsTable reports={reports ?? []} rows={rows ?? []} />}
    </div>
  );
}

const FIELD_LABELS: Record<keyof Draft, string> = { name: "Name", title: "Title", photo_url: "Photo", bio: "Bio", website: "Website", phone: "Phone", email: "Email", city: "City", states: "States", specialties: "Specialties", modes: "Modes", credentials: "Credentials" };
const show = (v: unknown): string => (Array.isArray(v) ? v.join(", ") || "—" : v == null || v === "" ? "—" : String(v));

const BUSY_LABEL: Record<Decision, string> = { approve: "Approving…", reject: "Saving…", suspend: "Suspending…", unsuspend: "Unsuspending…", founding: "Saving…" };

function ReviewRow({ row, outcome, reload, onOutcome }: { row: AdminRow; outcome: string | null; reload: () => Promise<AdminRow[] | null>; onOutcome: (id: string, text: string) => void }) {
  const { api } = usePortal();
  const [note, setNote] = useState(row.review_note ?? "");
  const [founding, setFounding] = useState(row.founding_until ?? "");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const changed = diffFields(row, row.published);
  const draft = toCounselor({ ...row });
  const savedFounding = row.founding_until ?? "";
  // The list reloads after every action: keep the date field on the saved value.
  useEffect(() => setFounding(savedFounding), [savedFounding]);
  const foundingDirty = founding !== savedFounding;

  const act = async (decision: Decision) => {
    if (!api) return;
    if (decision === "reject" && !note.trim()) {
      setErr("Add a note for the counselor before rejecting.");
      return;
    }
    if (decision === "founding" && !founding) {
      setErr("Pick the date the founding listing ends.");
      return;
    }
    if (decision === "founding" && !foundingDirty) {
      setErr(`The founding date is already ${fmt(founding)}.`);
      return;
    }
    setBusy(decision);
    setErr(null);
    const foundingSent = decision === "founding" || (founding && foundingDirty) ? founding || null : null;
    try {
      const res = await api.adminReview(row.id, decision, note.trim() || null, foundingSent, row.updated_at);
      const fresh = (await reload())?.find((r) => r.id === row.id) ?? null;
      const truth: Truth | null = res ?? (fresh ? { status: fresh.status, listed: fresh.listed ?? isListed(fresh), founding_until: fresh.founding_until } : null);
      onOutcome(row.id, describeOutcome(decision, row, truth, foundingSent));
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(null);
    }
  };
  const label = (d: Decision, idle: string) => (busy === d ? BUSY_LABEL[d] : idle);

  const keys = Object.keys(FIELD_LABELS) as (keyof Draft)[];
  return (
    <article className="cc-card p-5" aria-label={row.name ?? row.account_email ?? row.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-headline">{row.name ?? "(no name)"} <span className="font-normal text-text-muted">· {row.account_email ?? "no email"}</span></h2>
          <p className="mt-0.5 text-footnote text-text-muted">
            {row.status}
            {row.awaiting_review && " · awaiting review"} · {isListed(row) ? "listed" : "not listed"} · {row.subscription_status}
            {row.plan ? ` (${row.plan})` : ""}
            {row.founding_until ? ` · founding until ${fmt(row.founding_until)}` : ""} · submitted {fmt(row.submitted_at)} · terms {row.terms_accepted_at ? "accepted" : "NOT accepted"}
          </p>
        </div>
        {row.report_count > 0 && (
          <span className="cc-pill" style={{ background: "color-mix(in srgb, var(--bad) 14%, transparent)", color: "var(--bad)" }}>
            {row.report_count} report{row.report_count === 1 ? "" : "s"}{row.recent_report_count ? ` · ${row.recent_report_count} recent` : ""}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-subhead">
        {row.website && (
          <a className="cc-link" href={row.website} target="_blank" rel="noopener noreferrer">
            Open website ↗
          </a>
        )}
        {row.photo_url && (
          <a className="cc-link" href={row.photo_url} target="_blank" rel="noopener noreferrer">
            Open photo ↗
          </a>
        )}
        {row.credentials && <span className="text-text-muted">Credentials to check: {row.credentials}</span>}
      </div>

      <div className="cp-diff mt-4">
        <div className="cp-diff-row text-caption font-semibold uppercase tracking-wide text-text-muted" style={{ borderTop: 0 }}>
          <span>Field</span>
          <span>Draft</span>
          <span>Published</span>
        </div>
        {keys.map((k) => (
          <div key={k} className="cp-diff-row" data-changed={changed.includes(k)}>
            <span className="text-text-muted">{FIELD_LABELS[k]}</span>
            <span className="min-w-0 break-words whitespace-pre-line">{show(row[k])}</span>
            <span className="min-w-0 break-words whitespace-pre-line text-text-muted">{row.published ? show(row.published[k]) : "—"}</span>
          </div>
        ))}
      </div>

      <button type="button" className="cc-link mt-3 min-h-tap text-subhead" onClick={() => setShowPreview((v) => !v)} aria-expanded={showPreview}>
        {showPreview ? "Hide card preview" : "Show card preview"}
      </button>
      {showPreview && draft && (
        <div className="mx-auto mt-2 max-w-sm">
          <CounselorCard counselor={draft} preview />
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="cp-label">Note to the counselor (required to reject)</span>
          <textarea className="cc-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Note for ${row.name ?? row.id}`} />
        </label>
        <label className="block">
          <span className="cp-label">Founding listing until</span>
          <input className="cc-input" type="date" value={founding} onChange={(e) => setFounding(e.target.value)} aria-label={`Founding listing until for ${row.name ?? row.id}`} />
          <span className="cp-hint">
            {!foundingDirty && savedFounding
              ? `Saved — the free listing runs until ${fmt(savedFounding)}. Pick a different date to change it.`
              : foundingDirty && savedFounding
                ? `Replaces the saved date (${fmt(savedFounding)}) when you tap “Set founding date” or any decision.`
                : "Free listing while this date is in the future. Set with any decision, or on its own with “Set founding date”."}
          </span>
        </label>
      </div>
      {err && (
        <div className="mt-3" role="alert">
          <Banner tone="error">
            {err}
            {/reload|refresh/i.test(err) && (
              <>
                {" "}
                <button type="button" className="cc-link" onClick={() => void reload()}>
                  Refresh now
                </button>
              </>
            )}
          </Banner>
        </div>
      )}
      {outcome && !err && (
        <div className="mt-3" role="status">
          <Banner tone="info">{outcome}</Banner>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {row.status !== "suspended" && (
          <button type="button" className="cc-btn cc-btn-primary cc-btn-sm cc-press" onClick={() => void act("approve")} disabled={busy !== null} aria-busy={busy === "approve"}>
            {label("approve", row.status === "approved" ? "Approve changes" : "Approve")}
          </button>
        )}
        {row.status !== "suspended" && (
          <button type="button" className="cc-btn cc-btn-quiet cc-btn-sm cc-press" onClick={() => void act("reject")} disabled={busy !== null} aria-busy={busy === "reject"}>
            {label("reject", row.status === "approved" ? "Decline changes" : "Reject")}
          </button>
        )}
        {row.status === "suspended" ? (
          <button type="button" className="cc-btn cc-btn-secondary cc-btn-sm cc-press" onClick={() => void act("unsuspend")} disabled={busy !== null} aria-busy={busy === "unsuspend"}>
            {label("unsuspend", "Unsuspend")}
          </button>
        ) : (
          <button type="button" className="cc-btn cc-btn-danger cc-btn-sm cc-press" onClick={() => void act("suspend")} disabled={busy !== null} aria-busy={busy === "suspend"}>
            {label("suspend", "Suspend")}
          </button>
        )}
        <button type="button" className="cc-btn cc-btn-quiet cc-btn-sm cc-press" onClick={() => void act("founding")} disabled={busy !== null || !founding || !foundingDirty} aria-busy={busy === "founding"}>
          {label("founding", "Set founding date")}
        </button>
      </div>
    </article>
  );
}

function ReportsTable({ reports, rows }: { reports: Report[]; rows: AdminRow[] }) {
  if (!reports.length) return <p className="py-10 text-center text-subhead text-text-muted">No reports.</p>;
  const label = (r: string) => REPORT_REASONS.find((x) => x.id === r)?.label ?? r;
  return (
    <div className="cc-card mt-4 overflow-x-auto">
      <table className="cp-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Counselor</th>
            <th>Reason</th>
            <th>Detail</th>
            <th>Reporter</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => {
            const c = rows.find((x) => x.id === r.counselor_id);
            return (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{fmt(r.created_at)}</td>
                <td>
                  {r.counselor_name ?? c?.name ?? r.counselor_id}
                  <div className="text-caption text-text-muted">{r.counselor_status}</div>
                </td>
                <td>{label(r.reason)}</td>
                <td className="max-w-md whitespace-pre-line">{r.detail ?? "—"}</td>
                <td className="font-mono text-caption text-text-muted">{r.reporter ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

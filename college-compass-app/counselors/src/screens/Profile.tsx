/** Profile editor with a live preview of the card exactly as the app renders it. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, Chip } from "@/components/ui";
import { CounselorCard } from "@/components/CounselorCard";
import { MODES, NATIONWIDE, SPECIALTIES, initials, toCounselor } from "@/data/counselors";
import { STATES } from "@/state/catalog";
import { DRAFT_KEYS, EMPTY_DRAFT, describeError, type CounselorRow, type Draft } from "../api";
import { BIO_MAX, REVIEW_SLA } from "../constants";
import { checkPhotoFile, preparePhoto } from "../image";
import { usePortal } from "../Portal";
import { PhonePreview } from "./Landing";
import { draftDiffers, missingForSubmit, normalizeDraft, validateDraft, type FieldErrors } from "../validate";

const US_STATES = STATES.filter((s) => s.code !== "XX");

function draftOf(row: CounselorRow | null): Draft {
  if (!row) return { ...EMPTY_DRAFT };
  const d = { ...EMPTY_DRAFT };
  for (const k of DRAFT_KEYS) (d as Record<string, unknown>)[k] = row[k] ?? (Array.isArray(EMPTY_DRAFT[k]) ? [] : null);
  return d;
}

/** True when the listing is currently shown to families. */
export function isListed(row: CounselorRow, today = new Date()): boolean {
  if (row.status !== "approved" || !row.published) return false;
  if (row.founding_until && new Date(row.founding_until + "T23:59:59") >= today) return true;
  if (row.subscription_status === "active" || row.subscription_status === "trialing") return true;
  // A failed payment keeps the listing up for 7 days (same rule as the database's directory query).
  if (row.subscription_status === "past_due") {
    const since = row.past_due_since ? Date.parse(row.past_due_since) : today.getTime();
    return Number.isFinite(since) && today.getTime() - since < GRACE_MS;
  }
  return false;
}

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export function Profile() {
  const { api, session } = usePortal();
  const [row, setRow] = useState<CounselorRow | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT });
  const [saved, setSaved] = useState<Draft>({ ...EMPTY_DRAFT });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<"save" | "submit" | "photo" | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [termsOk, setTermsOk] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!api) return;
    try {
      const r = await api.myCounselor();
      setRow(r);
      const d = draftOf(r);
      setDraft(d);
      setSaved(d);
      if (!r?.email && session?.email) setDraft((x) => ({ ...x, email: x.email ?? session.email }));
    } catch (e) {
      setLoadErr(describeError(e));
      setRow(null);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const dirty = useMemo(() => JSON.stringify(normalizeDraft(draft)) !== JSON.stringify(normalizeDraft(saved)), [draft, saved]);
  const missing = useMemo(() => missingForSubmit(normalizeDraft(draft)), [draft]);
  const preview = useMemo(() => toCounselor({ id: "preview", ...normalizeDraft(draft), name: draft.name?.trim() || "Your name" }), [draft]);
  const termsAccepted = !!row?.terms_accepted_at;
  const canSubmit = !!row && !dirty && missing.length === 0 && (termsAccepted || termsOk) && row.status !== "suspended" && row.status !== "pending" && !(row.status === "approved" && !row.has_changes);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const toggleIn = (k: "states" | "specialties" | "modes", v: string) => set(k, draft[k].includes(v) ? draft[k].filter((x) => x !== v) : [...draft[k], v]);

  const save = async (): Promise<CounselorRow | null> => {
    if (!api) return null;
    const d = normalizeDraft(draft);
    const errs = validateDraft(d);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      setNotice({ tone: "error", text: "Please fix the highlighted fields." });
      return null;
    }
    setBusy("save");
    setNotice(null);
    try {
      const r = await api.saveDraft(row?.id ?? null, d);
      setRow(r);
      const nd = draftOf(r);
      setDraft(nd);
      setSaved(nd);
      setNotice({ tone: "info", text: r.status === "approved" && r.has_changes ? "Saved. Submit the changes for review when you're ready — your current listing stays live." : "Saved." });
      return r;
    } catch (e) {
      setNotice({ tone: "error", text: describeError(e) });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!api || !row) return;
    setBusy("submit");
    setNotice(null);
    try {
      if (!termsAccepted) await api.acceptTerms();
      await api.submitForReview();
      await load();
      setNotice({ tone: "info", text: `Submitted. We'll review it within ${REVIEW_SLA} and email you.` });
    } catch (e) {
      setNotice({ tone: "error", text: describeError(e) });
    } finally {
      setBusy(null);
    }
  };

  const onPhoto = async (f: File | undefined) => {
    if (!f || !api || !session) return;
    const problem = checkPhotoFile(f);
    if (problem) {
      setErrors((e) => ({ ...e, photo_url: problem }));
      return;
    }
    setBusy("photo");
    try {
      const blob = await preparePhoto(f);
      const url = await api.uploadPhoto(session.userId, blob);
      set("photo_url", url);
    } catch (e) {
      setErrors((x) => ({ ...x, photo_url: describeError(e) }));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (row === undefined && !loadErr) return <p className="py-16 text-center text-subhead text-text-muted">Loading your profile…</p>;

  return (
    <div className="py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="cp-h2">Your listing</h1>
          <p className="text-subhead text-text-muted">{session?.email}</p>
        </div>
      </div>
      {loadErr && <Banner tone="error">{loadErr}</Banner>}
      {row !== undefined && <StatusBanner row={row} dirty={dirty} />}

      <div className="cp-editor mt-6">
        <form
          className="cc-card p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          {/* Photo */}
          <div className="flex items-center gap-4">
            {draft.photo_url ? (
              <img src={draft.photo_url} alt="Your photo" className="h-20 w-20 shrink-0 rounded-full bg-surface-2 object-cover" />
            ) : (
              <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-accent-soft text-title2 text-accent" aria-hidden>
                {initials(draft.name || "?")}
              </span>
            )}
            <div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" id="photo" onChange={(e) => void onPhoto(e.target.files?.[0])} aria-label="Choose a photo" />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="cc-btn cc-btn-secondary cc-btn-sm cc-press" onClick={() => fileRef.current?.click()} disabled={busy === "photo"}>
                  {busy === "photo" ? "Uploading…" : draft.photo_url ? "Change photo" : "Add photo"}
                </button>
                {draft.photo_url && (
                  <button type="button" className="cc-btn cc-btn-quiet cc-btn-sm cc-press" onClick={() => set("photo_url", null)}>
                    Remove
                  </button>
                )}
              </div>
              <p className="cp-hint">Square, face clearly visible. We resize it to 512 px.</p>
              {errors.photo_url && <p className="cp-err">{errors.photo_url}</p>}
            </div>
          </div>

          <Field id="name" label="Name" error={errors.name}>
            <input id="name" className="cc-input" value={draft.name ?? ""} onChange={(e) => set("name", e.target.value)} autoComplete="name" maxLength={120} />
          </Field>
          <Field id="title" label="Title" hint="e.g. Independent college counselor · Founder, Bright Path Admissions" error={errors.title}>
            <input id="title" className="cc-input" value={draft.title ?? ""} onChange={(e) => set("title", e.target.value)} maxLength={120} />
          </Field>
          <Field id="city" label="City" hint="Shown on your card. Leave blank for a fully virtual practice." error={errors.city}>
            <input id="city" className="cc-input" value={draft.city ?? ""} onChange={(e) => set("city", e.target.value)} maxLength={80} autoComplete="address-level2" />
          </Field>

          <fieldset className="cp-field">
            <legend className="cp-label">States you serve</legend>
            <div className="flex flex-wrap gap-2">
              <Chip selected={draft.states.includes(NATIONWIDE)} onClick={() => toggleIn("states", NATIONWIDE)}>
                Nationwide (virtual)
              </Chip>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="States">
              {US_STATES.map((s) => (
                <Chip key={s.code} className="!min-h-8 !px-2.5 !text-footnote" selected={draft.states.includes(s.code)} onClick={() => toggleIn("states", s.code)} aria-label={s.name}>
                  {s.code}
                </Chip>
              ))}
            </div>
            <p className="cp-hint">Families in these states see you. “Nationwide” shows you to families everywhere who look for virtual help.</p>
          </fieldset>

          <fieldset className="cp-field">
            <legend className="cp-label">Specialties</legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Specialties">
              {SPECIALTIES.map((s) => (
                <Chip key={s.id} selected={draft.specialties.includes(s.id)} onClick={() => toggleIn("specialties", s.id)}>
                  {s.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <fieldset className="cp-field">
            <legend className="cp-label">How you meet families</legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Modes">
              {MODES.map((m) => (
                <Chip key={m.id} selected={draft.modes.includes(m.id)} onClick={() => toggleIn("modes", m.id)}>
                  {m.label}
                </Chip>
              ))}
            </div>
          </fieldset>

          <Field id="credentials" label="Credentials" hint="Degrees, certificates, memberships, years in admissions. 300 characters." error={errors.credentials}>
            <input id="credentials" className="cc-input" value={draft.credentials ?? ""} onChange={(e) => set("credentials", e.target.value)} maxLength={300} />
          </Field>

          <Field id="bio" label="Bio" error={errors.bio} counter={`${(draft.bio ?? "").length} / ${BIO_MAX}`}>
            <textarea id="bio" className="cc-input" rows={6} value={draft.bio ?? ""} onChange={(e) => set("bio", e.target.value.slice(0, BIO_MAX))} maxLength={BIO_MAX} placeholder="Who you help, how you work, what families can expect. Written for parents and students." />
          </Field>

          <h3 className="mt-7 text-headline">How families reach you</h3>
          <p className="cp-hint">At least one. Each becomes a button on your card.</p>
          <Field id="website" label="Website" error={errors.website}>
            <input id="website" className="cc-input" type="url" inputMode="url" autoComplete="url" placeholder="https://yourpractice.com" value={draft.website ?? ""} onChange={(e) => set("website", e.target.value)} />
          </Field>
          <Field id="phone" label="Phone" error={errors.phone}>
            <input id="phone" className="cc-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="(919) 555-0100" value={draft.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field id="contact-email" label="Contact email" hint="Shown to families. Can differ from your sign-in email." error={errors.email}>
            <input id="contact-email" className="cc-input" type="email" inputMode="email" autoComplete="email" value={draft.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          </Field>

          {notice && (
            <div className="mt-5" role="status">
              <Banner tone={notice.tone}>{notice.text}</Banner>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3">
            <button type="submit" className="cc-btn cc-btn-primary cc-press" disabled={busy !== null || !dirty || !api} aria-busy={busy === "save"}>
              {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>

            {(!row || (row.status !== "suspended" && row.status !== "pending" && !(row.status === "approved" && !row.has_changes && !dirty))) && (
              <div className="rounded-card border border-border p-4">
                {!termsAccepted && (
                  <label className="flex items-start gap-3 text-subhead">
                    <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--accent)]" checked={termsOk} onChange={(e) => setTermsOk(e.target.checked)} />
                    <span>
                      I have read and accept the <a className="cc-link" href="#/terms" target="_blank" rel="noopener noreferrer">counselor terms</a>, including the rules on accuracy and working with minors.
                    </span>
                  </label>
                )}
                {missing.length > 0 && <p className="cp-hint mt-2">Before you can submit, add: {missing.join(", ")}.</p>}
                {(dirty || !row) && missing.length === 0 && <p className="cp-hint mt-2">Save your changes first.</p>}
                <button type="button" className="cc-btn cc-btn-secondary cc-press mt-3" disabled={!canSubmit || busy !== null} onClick={() => void submit()} aria-busy={busy === "submit"}>
                  {busy === "submit" ? "Submitting…" : row?.status === "approved" ? "Submit changes for review" : row?.status === "rejected" ? "Resubmit for review" : "Submit for review"}
                </button>
              </div>
            )}
          </div>
        </form>

        <aside className="cp-preview" aria-label="Live preview">
          <p className="cp-label text-center">How families see it</p>
          <PhonePreview>{preview && <CounselorCard counselor={preview} preview />}</PhonePreview>
          {row?.published && draftDiffers(draft, row.published) && <p className="cp-hint mt-3 text-center">This preview shows your edits. Families still see the approved version until the changes are reviewed.</p>}
        </aside>
      </div>
    </div>
  );
}

function Field({ id, label, hint, error, counter, children }: { id: string; label: string; hint?: string; error?: string; counter?: string; children: React.ReactNode }) {
  return (
    <div className="cp-field">
      <div className="flex items-baseline justify-between gap-2">
        <label className="cp-label" htmlFor={id}>
          {label}
        </label>
        {counter && <span className="tnum text-caption text-text-muted">{counter}</span>}
      </div>
      {children}
      {error ? <p className="cp-err" role="alert">{error}</p> : hint ? <p className="cp-hint">{hint}</p> : null}
    </div>
  );
}

export function StatusBanner({ row, dirty }: { row: CounselorRow | null; dirty: boolean }) {
  if (!row) return <Banner tone="info">Your listing isn't visible yet. Fill in the profile, save it, then submit it for review.</Banner>;
  const listed = isListed(row);
  const awaiting = row.status === "approved" && row.has_changes && !!row.submitted_at && (!row.approved_at || row.submitted_at > row.approved_at);
  switch (row.status) {
    case "draft":
      return <Banner tone="info">Draft — not visible to families yet. When the profile is complete, submit it for review.</Banner>;
    case "pending":
      return <Banner tone="info">Thanks — your listing is under review. We'll review it within {REVIEW_SLA} and email you. You can keep editing; new edits are reviewed together.</Banner>;
    case "rejected":
      return (
        <Banner tone="warn">
          <strong>We couldn't approve this listing yet.</strong>
          {row.review_note && <span className="mt-1 block">Note from the reviewer: “{row.review_note}”</span>}
          <span className="mt-1 block">Update your profile and resubmit.</span>
        </Banner>
      );
    case "suspended":
      return (
        <Banner tone="error">
          <strong>This listing is suspended</strong> and hidden from families.
          {row.review_note && <span className="mt-1 block">Reason: “{row.review_note}”</span>}
          <span className="mt-1 block">Questions? Reply to our email or contact support.</span>
        </Banner>
      );
    case "approved":
      if (awaiting) return <Banner tone="info">Your changes are waiting for review — your current listing stays live meanwhile.</Banner>;
      if (row.has_changes || dirty) return <Banner tone="warn">You have unpublished changes. Save and submit them for review; your current listing stays live until they're approved.</Banner>;
      if (listed) return <Banner tone="info">Your listing is live — families in {row.published?.states?.includes(NATIONWIDE) ? "every state" : (row.published?.states ?? []).join(", ")} can see it.</Banner>;
      return (
        <Banner tone="warn">
          Approved, but not shown yet: start a listing plan on the <a className="underline" href="#/billing">billing page</a> to go live.
        </Banner>
      );
  }
}

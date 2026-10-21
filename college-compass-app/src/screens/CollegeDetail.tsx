import { useEffect, useRef, useState } from "react";
import { navigate, useRoute } from "@/lib/router";
import { fmt, useStore } from "@/state/store";
import { majorIcon, majorLabel, tierInfo } from "@/state/catalog";
import { auth, describeError, researchApi } from "@/state/services";
import { Screen } from "@/components/Screen";
import { RangeBar } from "@/components/RangeBar";
import { ConfirmSheet } from "@/components/Sheet";
import { NoteTextarea } from "@/components/NoteSheet";
import { SignInAgain, needsSignIn, reasonFor } from "@/components/SignInAgain";
import { Banner, Button, ConfidenceDot, EffectIcon, Empty, Group, Row, Stat, TierPill } from "@/components/ui";
import { IconExternal, IconRefresh, IconStar } from "@/components/icons";

export function CollegeDetail({ id, embedded }: { id: string; embedded?: boolean }) {
  const { byId, profile, isSaved, toggleSaved, notes, setNote, upsertCollege, removeCollege, demo, prefs } = useStore();
  const item = byId.get(id);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<{ detail: string; code?: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // `#/college/<id>?notes=1` (from a card's note preview or the quick-note sheet) lands on the notes box.
  const wantsNotes = useRoute().query.notes === "1";
  const notesRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!wantsNotes) return;
    // After Screen's own scroll-to-top on mount, and after the push transition settles.
    const t = setTimeout(() => {
      const el = notesRef.current;
      if (!el) return;
      el.scrollIntoView?.({ block: "center", behavior: "smooth" });
      el.focus({ preventScroll: true });
    }, 80);
    return () => clearTimeout(t);
  }, [wantsNotes, id]);

  // iPhone sign-in completes in place without remounting this screen: drop the card once signed in.
  const needsSession = !!err && needsSignIn(err.code);
  useEffect(() => {
    if (!needsSession) return;
    return auth.subscribe(() => {
      if (auth.account() && !auth.lastError?.()) setErr(null);
    });
  }, [needsSession]);

  if (!item) {
    return (
      <Screen title="College" back="/list" largeTitle={false}>
        <Empty icon="🫥" title="Not on your list" message="This college isn't in your research results any more." action={<Button onClick={() => navigate("/list", { replace: true })}>Back to list</Button>} />
      </Screen>
    );
  }
  const { college: c, odds, fit } = item;
  const t = tierInfo(odds.tier);
  const saved = isSaved(c.id);
  const inState = c.ownership === "public" && c.state === profile.home_state;

  const refresh = async () => {
    setRefreshing(true);
    setErr(null);
    try {
      const fresh = await researchApi(demo).researchOne(c.name, profile, prefs.model ?? undefined);
      upsertCollege({ ...fresh, id: c.id });
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setRefreshing(false);
    }
  };

  const openUrl = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

  return (
    <Screen
      title={c.short}
      largeTitle={false}
      back={embedded ? undefined : "/list"}
      backLabel="List"
      right={
        <button type="button" className={`grid h-11 w-11 place-items-center ${saved ? "text-warn" : "text-accent"}`} aria-pressed={saved} aria-label={saved ? "Remove from shortlist" : "Add to shortlist"} onClick={() => toggleSaved(c.id)}>
          <IconStar size={24} filled={saved} />
        </button>
      }
    >
      {/* Header */}
      <header className="pt-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-title1 leading-tight">{c.name}</h2>
            <p className="mt-1 text-subhead text-text-muted">
              {c.city}, {c.state} · {c.ownership === "public" ? "Public" : "Private"}
              {c.undergrad_size != null ? ` · ${fmt.num(c.undergrad_size)} undergrads` : ""}
              {c.hbcu ? " · HBCU" : ""}
            </p>
          </div>
          <TierPill tier={odds.tier} className="mt-1.5 shrink-0 !h-7 !px-2.5 !text-footnote" />
        </div>
        <div className="cc-card mt-4 p-4" style={{ ["--rail" as string]: t.cssVar }}>
          <span className="cc-card-rail" aria-hidden />
          <div className="grid grid-cols-3 gap-3 pl-1">
            <Stat value={<span style={{ color: t.cssVar }}>{fmt.band(odds.low, odds.high)}</span>} label="Estimated odds" />
            <Stat value={Math.round(fit.total)} unit="/100" label="Fit for you" />
            <Stat value={item.est_net_price != null ? fmt.usd(item.est_net_price, { k: true }) : "—"} unit={item.est_net_price != null ? "/yr" : undefined} label="Est. net price" />
          </div>
          <div className="mt-3 pl-1">
            <div className="cc-band" style={{ ["--rail" as string]: t.cssVar }} aria-hidden>
              <span style={{ left: `${odds.low * 100}%`, width: `${Math.max(2, (odds.high - odds.low) * 100)}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-caption text-text-muted tnum" aria-hidden>
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
          {(item.reasons.length > 0 || item.watchouts.length > 0) && (
            <ul className="mt-3 space-y-1 pl-1 text-subhead">
              {item.reasons.map((r) => (
                <li key={r} className="flex gap-2">
                  <span className="text-good" aria-hidden>+</span>
                  <span>{r}</span>
                </li>
              ))}
              {item.watchouts.map((w) => (
                <li key={w} className="flex gap-2">
                  <span className="text-bad" aria-hidden>–</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      {err && needsSignIn(err.code) && (
        <div className="mt-4">
          <SignInAgain returnTo={`/college/${encodeURIComponent(c.id)}`} reason={reasonFor(err.code)} line="Sign in again to refresh this college — your list is saved on this phone." />
        </div>
      )}
      {err && !needsSignIn(err.code) && (
        <div className="mt-4">
          <Banner tone="error">{err.detail}</Banner>
        </div>
      )}

      {/* Notes — kept near the top so visit dates, contacts and gut feelings are one glance away. */}
      <section id="notes" className="mt-5 scroll-mt-4">
        <h3 className="cc-group-label">Your notes</h3>
        <div className="cc-group">
          <NoteTextarea inputRef={notesRef} id="college-notes" className="!rounded-none !border-0 focus:shadow-[inset_0_0_0_1.5px_var(--accent)]" minRows={3} value={notes[c.id] ?? ""} onChange={(t) => setNote(c.id, t)} />
        </div>
        <p className="cc-group-foot">Saved automatically on this phone. Shows on this college's card and your shortlist.</p>
      </section>

      {/* You vs them */}
      <Group label="You vs. them">
        <div className="px-4 py-2">
          <RangeBar label="SAT" lo={c.sat_25} hi={c.sat_75} you={profile.sat} {...bounds([c.sat_25, c.sat_75, profile.sat], 400, 1600, 120)} />
          <RangeBar label="ACT" lo={c.act_25} hi={c.act_75} you={profile.act} {...bounds([c.act_25, c.act_75, profile.act], 1, 36, 4)} />
          <div className="flex items-baseline justify-between py-2">
            <span className="text-subhead font-medium">GPA (unweighted)</span>
            <span className="tnum text-footnote text-text-muted">
              You <span className="font-semibold text-text">{profile.gpa_unweighted ?? "—"}</span>
              {c.cds?.avg_gpa != null ? <> · their average {c.cds.avg_gpa}</> : <> · average not reported</>}
            </span>
          </div>
          <p className="pb-1 text-footnote text-text-muted">
            Test policy: {c.test_policy === "required" ? "scores required" : c.test_policy === "optional" ? "test optional" : c.test_policy === "blind" ? "test blind" : c.test_policy === "considered" ? "considered if sent" : "unknown"}
            {c.application?.test_policy_note ? ` — ${c.application.test_policy_note}` : ""}
          </p>
        </div>
      </Group>

      {/* Odds */}
      <Group label="Why these odds" foot={`Starts from the ${c.admit_rate != null ? fmt.pct(c.admit_rate) : "unknown"} overall admit rate, then adjusts for your profile. ${odds.confidence === "high" ? "High" : odds.confidence === "medium" ? "Medium" : "Low"} confidence. Estimates, not predictions.`}>
        {odds.factors.map((f) => (
          <div key={f.label} className="cc-row-static">
            <EffectIcon effect={f.effect} />
            <span className="flex-1 text-subhead">{f.label}</span>
          </div>
        ))}
        {odds.caveats.map((cv) => (
          <div key={cv} className="cc-row-static">
            <span className="text-subhead text-text-muted">{cv}</span>
          </div>
        ))}
      </Group>

      {/* Plans & deadlines */}
      {c.application && (
        <Group label={`Plans & deadlines · ${c.application.cycle}`} foot={[c.application.essays_note, c.application.fee ? `Fee: ${c.application.fee}` : null].filter(Boolean).join(" · ") || undefined}>
          {c.application.plans.map((p, i) => (
            <Row key={i} label={PLAN_LABEL[p.plan] ?? p.plan} hint={p.notes} value={p.deadline ?? "No fixed deadline"} />
          ))}
          {c.application.plans.length === 0 && <Row label="No plan details found" />}
        </Group>
      )}

      {/* Programs */}
      <Group label="Programs for you">
        {(c.programs ?? []).filter((p) => profile.majors.includes(p.major) || profile.majors.length === 0).map((p) => (
          <div key={p.major} className="cc-row-static items-start">
            <span className="mt-0.5 text-[20px] leading-none" aria-hidden>{majorIcon(p.major)}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium">{majorLabel(p.major)}</span>
              <span className={`block text-subhead ${p.offered ? "" : "text-bad"}`}>{p.offered ? p.degree ?? "Offered" : "Not offered"}</span>
              {p.how_to_enter && <span className="mt-0.5 block text-footnote text-text-muted">How you get in: {p.how_to_enter}</span>}
              {p.notes && <span className="mt-0.5 block text-footnote text-text-muted">{p.notes}</span>}
            </span>
          </div>
        ))}
        {(!c.programs || c.programs.length === 0) && <Row label="No program notes yet" hint="Refresh research to look up programs for your majors." />}
      </Group>

      {/* Cost */}
      <Group label="Cost" foot={item.est_net_price_note}>
        <Row label="Estimated net price for you" value={item.est_net_price != null ? `${fmt.usd(item.est_net_price)}/yr` : "—"} />
        <Row label="Cost of attendance" hint="Published sticker price" value={c.cost_of_attendance != null ? `${fmt.usd(c.cost_of_attendance)}/yr` : "—"} />
        {c.ownership === "public" ? (
          <>
            <Row label={`Tuition, in-state${inState ? " (you)" : ""}`} value={c.tuition_in_state != null ? `${fmt.usd(c.tuition_in_state)}/yr` : "—"} />
            <Row label={`Tuition, out-of-state${!inState ? " (you)" : ""}`} value={c.tuition_out_of_state != null ? `${fmt.usd(c.tuition_out_of_state)}/yr` : "—"} />
          </>
        ) : (
          <Row label="Tuition" value={c.tuition_in_state != null ? `${fmt.usd(c.tuition_in_state)}/yr` : "—"} />
        )}
        <Row label="Average net price" hint="All aid recipients" value={c.avg_net_price != null ? `${fmt.usd(c.avg_net_price)}/yr` : "—"} />
      </Group>
      {c.scholarships && c.scholarships.length > 0 && (
        <Group label="Scholarships">
          {c.scholarships.map((s) => (
            <Row key={s.name} label={s.name} hint={s.note ?? undefined} value={s.amount ?? undefined} />
          ))}
        </Group>
      )}

      {/* Outcomes */}
      <Group label="Outcomes">
        <Row label="Graduate within 6 years" value={fmt.pct(c.grad_rate_6yr)} />
        <Row label="Return for 2nd year" value={fmt.pct(c.retention_rate)} />
        <Row label="Median earnings, 10 years out" value={c.median_earnings_10yr != null ? `${fmt.usd(c.median_earnings_10yr)}/yr` : "—"} />
      </Group>

      {/* Sources & notes */}
      <Group
        label="Sources & data notes"
        foot={
          <span>
            <ConfidenceDot level={c.data_confidence} withLabel /> · {c.data_year} · researched {new Date(c.researched_at).toLocaleDateString()}
          </span>
        }
      >
        {c.sources.map((s) => (
          <Row key={s.url} label={s.title} hint={hostOf(s.url)} onClick={() => openUrl(s.url)} right={<IconExternal size={18} className="text-text-muted" />} />
        ))}
        {c.url && <Row label="Official website" hint={hostOf(c.url)} onClick={() => openUrl(c.url!)} right={<IconExternal size={18} className="text-text-muted" />} />}
        {c.data_notes.map((n) => (
          <div key={n} className="cc-row-static">
            <span className="text-footnote text-text-muted">{n}</span>
          </div>
        ))}
      </Group>

      <div className="mt-6 space-y-2 pb-4">
        <Button variant="secondary" onClick={() => toggleSaved(c.id)}>
          <IconStar size={20} filled={saved} /> {saved ? "Remove from shortlist" : "Add to shortlist"}
        </Button>
        <Button variant="quiet" onClick={refresh} disabled={refreshing} aria-busy={refreshing}>
          <IconRefresh size={20} className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Refreshing…" : "Refresh research"}
        </Button>
        <Button variant="danger" onClick={() => setConfirmRemove(true)}>
          Remove from my list
        </Button>
      </div>
      <ConfirmSheet
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={`Remove ${c.short}?`}
        message="It leaves your list and shortlist. You can add it again later."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          removeCollege(c.id);
          if (!embedded) navigate("/list", { replace: true });
        }}
      />
    </Screen>
  );
}

const PLAN_LABEL: Record<string, string> = { ED: "Early Decision", ED2: "Early Decision II", EA: "Early Action", REA: "Restrictive Early Action", RD: "Regular Decision", Rolling: "Rolling admission", Priority: "Priority deadline" };

/** Axis bounds that keep the range and the student's marker comfortably inside the track. */
function bounds(values: (number | null)[], floor: number, ceil: number, pad: number) {
  const v = values.filter((x): x is number => x != null);
  if (!v.length) return { min: floor, max: ceil };
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = Math.max(hi - lo, pad * 2);
  return { min: Math.max(floor, lo - Math.max(pad, span * 0.5)), max: Math.min(ceil, hi + Math.max(pad, span * 0.5)) };
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

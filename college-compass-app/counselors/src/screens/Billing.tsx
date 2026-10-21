/** Billing: pick a plan (Stripe Checkout), see the subscription, manage it (Stripe customer portal). */
import { useEffect, useState } from "react";
import { Banner } from "@/components/ui";
import { describeError, type CounselorRow } from "../api";
import { FOUNDING_COUNT, PRICE_MONTHLY, PRICE_YEARLY } from "../constants";
import { usePortal } from "../Portal";
import { usePortalRoute } from "../router";
import { isListed } from "./Profile";

const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "");

export function subscriptionSummary(row: CounselorRow, today = new Date()): { title: string; detail: string; tone: "info" | "warn" | "error" } {
  const founding = row.founding_until && new Date(row.founding_until + "T23:59:59") >= today;
  if (founding) {
    return {
      title: "Founding listing — free",
      detail: `You're one of our first ${FOUNDING_COUNT} counselors. Your listing is free until ${fmtDate(row.founding_until)}. We'll email you before then; nothing is charged unless you choose a plan.`,
      tone: "info",
    };
  }
  const plan = row.plan === "monthly" ? `$${PRICE_MONTHLY}/month` : row.plan === "yearly" ? `$${PRICE_YEARLY}/year` : null;
  switch (row.subscription_status) {
    case "active":
    case "trialing":
      return {
        title: row.cancel_at_period_end ? `Cancels ${fmtDate(row.current_period_end)}` : `Active · ${plan ?? "listing plan"}`,
        detail: row.cancel_at_period_end ? "Your listing stays live until then. You can resume from “Manage billing”." : `Renews ${fmtDate(row.current_period_end) || "automatically"}. Cancel anytime; your listing stays until the end of the paid period.`,
        tone: "info",
      };
    case "past_due":
    case "unpaid":
      return { title: "Payment problem", detail: "Your last payment didn't go through. Update your card in “Manage billing” — the listing is hidden after a short grace period.", tone: "error" };
    case "canceled":
      return { title: "Subscription ended", detail: "Your listing is hidden. Choose a plan to list again.", tone: "warn" };
    default:
      return { title: "No plan yet", detail: "Choose a plan to go live once your listing is approved. You can also submit for review first — the plan can wait.", tone: "warn" };
  }
}

export function Billing() {
  const { api } = usePortal();
  const route = usePortalRoute();
  const [row, setRow] = useState<CounselorRow | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const flash = route.query.checkout; // success | cancel

  useEffect(() => {
    if (!api) return;
    api.myCounselor().then(setRow).catch((e) => { setErr(describeError(e)); setRow(null); });
  }, [api]);

  const checkout = async (plan: "monthly" | "yearly") => {
    if (!api) return;
    setBusy(plan);
    setErr(null);
    try {
      window.location.assign(await api.checkout(plan));
    } catch (e) {
      setErr(describeError(e));
      setBusy(null);
    }
  };
  const manage = async () => {
    if (!api) return;
    setBusy("manage");
    setErr(null);
    try {
      window.location.assign(await api.billingPortal());
    } catch (e) {
      setErr(describeError(e));
      setBusy(null);
    }
  };

  if (row === undefined && !err) return <p className="py-16 text-center text-subhead text-text-muted">Loading…</p>;
  const summary = row ? subscriptionSummary(row) : null;
  const hasStripe = !!row && row.subscription_status !== "none";

  return (
    <div className="cp-narrow py-8">
      <h1 className="cp-h2">Billing</h1>
      {flash === "success" && (
        <div className="mt-3" role="status">
          <Banner tone="info">Thank you — your payment went through. It can take a minute for the status below to update.</Banner>
        </div>
      )}
      {flash === "cancel" && (
        <div className="mt-3" role="status">
          <Banner tone="warn">Checkout was cancelled. Nothing was charged.</Banner>
        </div>
      )}
      {err && (
        <div className="mt-3">
          <Banner tone="error">{err}</Banner>
        </div>
      )}

      {!row && !err && (
        <div className="mt-4">
          <Banner tone="info">
            Create your <a className="underline" href="#/profile">profile</a> first — billing is set up once your listing is ready.
          </Banner>
        </div>
      )}

      {row && summary && (
        <section className="cc-card mt-4 p-5" aria-label="Subscription status">
          <p className="cp-label">Status</p>
          <h2 className="text-title3">{summary.title}</h2>
          <p className="mt-1 text-subhead text-text-muted">{summary.detail}</p>
          <p className="mt-3 text-footnote text-text-muted">
            Listing: {row.status === "approved" ? (isListed(row) ? "live" : "approved, waiting for a plan") : row.status}
          </p>
          {hasStripe && (
            <button type="button" className="cc-btn cc-btn-secondary cc-press mt-4 sm:w-auto" onClick={() => void manage()} disabled={busy !== null} aria-busy={busy === "manage"}>
              {busy === "manage" ? "Opening…" : "Manage billing"}
            </button>
          )}
        </section>
      )}

      {row && !(row.subscription_status === "active" || row.subscription_status === "trialing") && (
        <section className="mt-8" aria-labelledby="plans">
          <h2 id="plans" className="text-title3">Choose a plan</h2>
          <p className="mt-1 text-subhead text-text-muted">Flat listing fee, billed by Stripe. Cancel anytime; your listing stays until the end of the paid period.</p>
          {summary?.title.startsWith("Founding") && <p className="mt-1 text-footnote text-text-muted">You don't need a plan while your founding listing is free — this is here for when it ends.</p>}
          <div className="cp-grid cp-grid-2 mt-4">
            <PlanCard price={PRICE_MONTHLY} per="month" note="Flexible." busy={busy === "monthly"} disabled={busy !== null || !api} onPick={() => void checkout("monthly")} />
            <PlanCard price={PRICE_YEARLY} per="year" note="Two months free." busy={busy === "yearly"} disabled={busy !== null || !api} onPick={() => void checkout("yearly")} highlight />
          </div>
          <p className="mt-3 text-footnote text-text-muted">You'll be taken to Stripe to pay and brought back here.</p>
        </section>
      )}
    </div>
  );
}

function PlanCard({ price, per, note, busy, disabled, onPick, highlight }: { price: number; per: string; note: string; busy: boolean; disabled: boolean; onPick: () => void; highlight?: boolean }) {
  return (
    <div className="cc-card p-5" style={highlight ? { borderColor: "var(--accent)" } : undefined}>
      <div className="cp-price">
        ${price}
        <small> / {per}</small>
      </div>
      <p className="mt-1 text-subhead text-text-muted">{note}</p>
      <button type="button" className={`cc-btn cc-press mt-4 ${highlight ? "cc-btn-primary" : "cc-btn-secondary"}`} onClick={onPick} disabled={disabled} aria-busy={busy}>
        {busy ? "Opening Stripe…" : `Choose $${price}/${per}`}
      </button>
    </div>
  );
}

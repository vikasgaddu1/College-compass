// Stripe → Tierwise billing logic that doesn't need the network. Pure (no Deno/npm imports) so it
// runs under Vitest. The status → listing rules themselves live in SQL (billing_apply_subscription) so the
// webhook and the daily reconcile apply exactly the same rules; this module only extracts the facts.
import { isUuid } from "./http.ts";

export type Plan = "monthly" | "yearly";

/** The subset of a Stripe Subscription we read. Works with API versions before and after 2025-03-31
 *  (current_period_end moved from the subscription to its items). */
export interface StripeSubscriptionLike {
  id: string;
  status: string;
  created?: number;
  customer: string | { id: string } | null;
  cancel_at_period_end?: boolean | null;
  current_period_end?: number | null;
  metadata?: Record<string, string> | null;
  items?: {
    data?: Array<{
      current_period_end?: number | null;
      price?: { id?: string | null; recurring?: { interval?: string | null } | null } | null;
    }>;
  } | null;
}

export interface StripeEventLike {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

export interface SubscriptionState {
  subscription: string;
  customer: string | null;
  stripe_status: string;
  price: string | null;
  interval: string | null;
  period_end: string | null; // ISO
  cancel_at_period_end: boolean;
  counselor_id: string | null; // from subscription metadata (set at checkout)
}

/** Events the webhook endpoint should be subscribed to. Anything else is acknowledged and ignored. */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.paid",
] as const;

function idOf(v: unknown): string | null {
  if (typeof v === "string" && v) return v;
  if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") return (v as { id: string }).id;
  return null;
}

function counselorFrom(meta: unknown): string | null {
  const v = meta && typeof meta === "object" ? (meta as Record<string, unknown>).counselor_id : null;
  return isUuid(v) ? v : null;
}

export function subscriptionState(sub: StripeSubscriptionLike): SubscriptionState {
  const item = sub.items?.data?.[0];
  const end = item?.current_period_end ?? sub.current_period_end ?? null;
  const interval = item?.price?.recurring?.interval ?? null;
  return {
    subscription: sub.id,
    customer: idOf(sub.customer),
    stripe_status: sub.status,
    price: item?.price?.id ?? null,
    interval: interval === "month" || interval === "year" ? interval : null,
    period_end: typeof end === "number" ? new Date(end * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end === true,
    counselor_id: counselorFrom(sub.metadata),
  };
}

export interface EventRef {
  subscriptionId: string;
  customerId: string | null;
  counselorId: string | null;
  paymentFailed: boolean;
}

/** Which subscription an event is about (null = nothing for us to do). */
export function eventRef(event: StripeEventLike): EventRef | null {
  const o = event.data?.object ?? {};
  switch (event.type) {
    case "checkout.session.completed": {
      if (o.mode !== "subscription") return null;
      const sub = idOf(o.subscription);
      if (!sub) return null;
      const ref = isUuid(o.client_reference_id) ? (o.client_reference_id as string) : null;
      return { subscriptionId: sub, customerId: idOf(o.customer), counselorId: ref ?? counselorFrom(o.metadata), paymentFailed: false };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = idOf(o.id);
      if (!sub) return null;
      return { subscriptionId: sub, customerId: idOf(o.customer), counselorId: counselorFrom(o.metadata), paymentFailed: false };
    }
    case "invoice.payment_failed":
    case "invoice.paid": {
      // API ≥ 2025-03-31: invoice.parent.subscription_details.subscription; older: invoice.subscription.
      const details = (o.parent as { subscription_details?: { subscription?: unknown; metadata?: unknown } } | null | undefined)
        ?.subscription_details;
      const sub = idOf(details?.subscription) ?? idOf(o.subscription);
      if (!sub) return null;
      return {
        subscriptionId: sub,
        customerId: idOf(o.customer),
        counselorId: counselorFrom(details?.metadata) ?? counselorFrom(o.subscription_details),
        paymentFailed: event.type === "invoice.payment_failed",
      };
    }
    default:
      return null;
  }
}

const PRIORITY = ["active", "trialing", "past_due", "unpaid", "paused", "incomplete", "canceled", "incomplete_expired"];

/** For the reconcile: the subscription that best describes a customer's current state (a live one beats an
 *  old canceled one; ties → newest). */
export function pickSubscription<T extends StripeSubscriptionLike>(subs: T[]): T | null {
  const rank = (s: string) => {
    const i = PRIORITY.indexOf(s);
    return i < 0 ? PRIORITY.length : i;
  };
  return (
    [...subs].sort((a, b) => rank(a.status) - rank(b.status) || (b.created ?? 0) - (a.created ?? 0))[0] ?? null
  );
}

export function priceForPlan(plan: unknown, prices: { monthly?: string | null; yearly?: string | null }): string | null {
  if (plan === "monthly") return prices.monthly || null;
  if (plan === "yearly") return prices.yearly || null;
  return null;
}

/** Arguments for public.billing_apply_subscription (state null = the customer has no subscription). */
export function applyArgs(
  source: "webhook" | "reconcile",
  state: SubscriptionState | null,
  extra: {
    eventId?: string;
    eventType?: string;
    eventCreated?: number;
    counselorId?: string | null;
    customerId?: string | null;
    paymentFailed?: boolean;
    observedAt: Date;
  },
): Record<string, unknown> {
  return {
    p_source: source,
    p_event_id: extra.eventId ?? null,
    p_event_type: extra.eventType ?? null,
    p_event_created: typeof extra.eventCreated === "number" ? new Date(extra.eventCreated * 1000).toISOString() : null,
    p_counselor: state?.counselor_id ?? (isUuid(extra.counselorId) ? extra.counselorId : null),
    p_customer: state?.customer ?? extra.customerId ?? null,
    p_subscription: state?.subscription ?? null,
    p_stripe_status: state?.stripe_status ?? null,
    p_interval: state?.interval ?? null,
    p_price: state?.price ?? null,
    p_period_end: state?.period_end ?? null,
    p_cancel_at_period_end: state?.cancel_at_period_end ?? false,
    p_payment_failed: extra.paymentFailed ?? false,
    p_observed_at: extra.observedAt.toISOString(),
  };
}

/** Stripe Checkout parameters (subscription mode). Returns to the portal's billing page. */
export function checkoutSessionParams(o: { customer: string; price: string; counselorId: string; portalUrl: string }) {
  return {
    mode: "subscription" as const,
    customer: o.customer,
    line_items: [{ price: o.price, quantity: 1 }],
    client_reference_id: o.counselorId,
    metadata: { counselor_id: o.counselorId },
    subscription_data: { metadata: { counselor_id: o.counselorId } },
    allow_promotion_codes: true,
    success_url: `${o.portalUrl}#/billing?checkout=success`,
    cancel_url: `${o.portalUrl}#/billing?checkout=cancel`,
  };
}

// Run: npx vitest run --root supabase/functions   (from college-compass-app/)
import { describe, expect, it } from "vitest";
import {
  applyArgs,
  checkoutSessionParams,
  eventRef,
  pickSubscription,
  priceForPlan,
  subscriptionState,
  type StripeSubscriptionLike,
} from "./billing.ts";
import { corsHeaders, parseOrigins, portalUrl } from "./http.ts";

const CID = "3f2b1c4d-1111-4222-8333-944455556666";

const sub = (over: Partial<StripeSubscriptionLike> = {}): StripeSubscriptionLike => ({
  id: "sub_1",
  status: "active",
  created: 100,
  customer: "cus_1",
  cancel_at_period_end: false,
  metadata: { counselor_id: CID },
  items: { data: [{ current_period_end: 1_900_000_000, price: { id: "price_m", recurring: { interval: "month" } } }] },
  ...over,
});

describe("subscriptionState", () => {
  it("reads the current API shape (period end on the item)", () => {
    expect(subscriptionState(sub())).toEqual({
      subscription: "sub_1",
      customer: "cus_1",
      stripe_status: "active",
      price: "price_m",
      interval: "month",
      period_end: new Date(1_900_000_000 * 1000).toISOString(),
      cancel_at_period_end: false,
      counselor_id: CID,
    });
  });
  it("falls back to the pre-2025 shape and expanded customers", () => {
    const s = subscriptionState(
      sub({
        customer: { id: "cus_x" },
        current_period_end: 1_800_000_000,
        cancel_at_period_end: true,
        metadata: { counselor_id: "not-a-uuid" },
        items: { data: [{ price: { id: "price_y", recurring: { interval: "year" } } }] },
      }),
    );
    expect(s.customer).toBe("cus_x");
    expect(s.period_end).toBe(new Date(1_800_000_000 * 1000).toISOString());
    expect(s.interval).toBe("year");
    expect(s.cancel_at_period_end).toBe(true);
    expect(s.counselor_id).toBeNull();
  });
  it("ignores intervals other than month/year", () => {
    expect(subscriptionState(sub({ items: { data: [{ price: { id: "p", recurring: { interval: "week" } } }] } })).interval).toBeNull();
  });
});

describe("eventRef", () => {
  const ev = (type: string, object: Record<string, unknown>) => ({ id: "evt_1", type, created: 1, data: { object } });

  it("checkout.session.completed (subscription mode) → subscription + counselor from client_reference_id", () => {
    expect(eventRef(ev("checkout.session.completed", { mode: "subscription", subscription: "sub_9", customer: "cus_9", client_reference_id: CID })))
      .toEqual({ subscriptionId: "sub_9", customerId: "cus_9", counselorId: CID, paymentFailed: false });
  });
  it("ignores one-off payment checkouts", () => {
    expect(eventRef(ev("checkout.session.completed", { mode: "payment", subscription: null }))).toBeNull();
  });
  it("customer.subscription.* → the subscription itself", () => {
    expect(eventRef(ev("customer.subscription.deleted", { id: "sub_2", customer: "cus_2", metadata: { counselor_id: CID } })))
      .toEqual({ subscriptionId: "sub_2", customerId: "cus_2", counselorId: CID, paymentFailed: false });
  });
  it("invoice.payment_failed, current API (parent.subscription_details)", () => {
    expect(eventRef(ev("invoice.payment_failed", {
      customer: "cus_3",
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_3", metadata: { counselor_id: CID } } },
    }))).toEqual({ subscriptionId: "sub_3", customerId: "cus_3", counselorId: CID, paymentFailed: true });
  });
  it("invoice.paid, legacy API (invoice.subscription)", () => {
    expect(eventRef(ev("invoice.paid", { customer: "cus_4", subscription: "sub_4" })))
      .toEqual({ subscriptionId: "sub_4", customerId: "cus_4", counselorId: null, paymentFailed: false });
  });
  it("invoices without a subscription and unhandled types → null", () => {
    expect(eventRef(ev("invoice.payment_failed", { customer: "cus_5", parent: null }))).toBeNull();
    expect(eventRef(ev("charge.refunded", { id: "ch_1" }))).toBeNull();
  });
});

describe("pickSubscription (reconcile)", () => {
  it("prefers a live subscription over a newer canceled one", () => {
    const live = sub({ id: "old_live", status: "active", created: 1 });
    const dead = sub({ id: "new_dead", status: "canceled", created: 9 });
    expect(pickSubscription([dead, live])?.id).toBe("old_live");
  });
  it("past_due beats canceled; newest wins a tie; empty → null", () => {
    expect(pickSubscription([sub({ id: "c", status: "canceled" }), sub({ id: "p", status: "past_due" })])?.id).toBe("p");
    expect(pickSubscription([sub({ id: "a", status: "canceled", created: 1 }), sub({ id: "b", status: "canceled", created: 2 })])?.id).toBe("b");
    expect(pickSubscription([])).toBeNull();
  });
});

describe("applyArgs", () => {
  const at = new Date("2026-10-21T12:00:00Z");
  it("maps a subscription state to billing_apply_subscription arguments", () => {
    expect(applyArgs("webhook", subscriptionState(sub()), { eventId: "evt_1", eventType: "invoice.payment_failed", eventCreated: 1_700_000_000, paymentFailed: true, observedAt: at }))
      .toEqual({
        p_source: "webhook", p_event_id: "evt_1", p_event_type: "invoice.payment_failed",
        p_event_created: new Date(1_700_000_000 * 1000).toISOString(), p_counselor: CID, p_customer: "cus_1",
        p_subscription: "sub_1", p_stripe_status: "active", p_interval: "month", p_price: "price_m",
        p_period_end: new Date(1_900_000_000 * 1000).toISOString(), p_cancel_at_period_end: false,
        p_payment_failed: true, p_observed_at: at.toISOString(),
      });
  });
  it("no subscription (reconcile) → counselor/customer from the caller, subscription null", () => {
    const a = applyArgs("reconcile", null, { counselorId: CID, customerId: "cus_7", observedAt: at });
    expect(a).toMatchObject({ p_source: "reconcile", p_counselor: CID, p_customer: "cus_7", p_subscription: null, p_stripe_status: null, p_event_id: null });
  });
});

describe("prices, checkout, CORS", () => {
  it("priceForPlan", () => {
    expect(priceForPlan("monthly", { monthly: "pm", yearly: "py" })).toBe("pm");
    expect(priceForPlan("yearly", { monthly: "pm", yearly: "py" })).toBe("py");
    expect(priceForPlan("weekly", { monthly: "pm" })).toBeNull();
    expect(priceForPlan("yearly", { monthly: "pm" })).toBeNull();
  });
  it("checkout returns to the portal billing page and tags the counselor everywhere", () => {
    const p = checkoutSessionParams({ customer: "cus_1", price: "pm", counselorId: CID, portalUrl: portalUrl(undefined) });
    expect(p.success_url).toBe("https://vikasgaddu1.github.io/College-compass/app/counselors/#/billing?checkout=success");
    expect(p.cancel_url).toBe("https://vikasgaddu1.github.io/College-compass/app/counselors/#/billing?checkout=cancel");
    expect(p.mode).toBe("subscription");
    expect(p.client_reference_id).toBe(CID);
    expect(p.subscription_data.metadata.counselor_id).toBe(CID);
  });
  it("portalUrl normalizes and rejects non-https", () => {
    expect(portalUrl("https://example.com/portal")).toBe("https://example.com/portal/");
    expect(portalUrl("http://example.com/")).toBe("https://vikasgaddu1.github.io/College-compass/app/counselors/");
  });
  it("CORS allows only listed origins", () => {
    const origins = parseOrigins(undefined);
    const ok = corsHeaders(new Request("https://x", { headers: { origin: "https://vikasgaddu1.github.io" } }), origins);
    const bad = corsHeaders(new Request("https://x", { headers: { origin: "https://evil.example" } }), origins);
    expect(ok["Access-Control-Allow-Origin"]).toBe("https://vikasgaddu1.github.io");
    expect(bad["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(parseOrigins("https://a.example/, http://localhost:5173, junk")).toEqual(["https://a.example", "http://localhost:5173"]);
  });
});

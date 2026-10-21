// Run: npx vitest run --root supabase/functions   (from college-compass-app/)
import { describe, expect, it, vi } from "vitest";
import type { StripeSubscriptionLike } from "./billing.ts";
import { handleBilling, handleCheckout, handleReconcile, handleWebhook, type Db, type Deps, type StripeLike } from "./handlers.ts";

const CID = "3f2b1c4d-1111-4222-8333-944455556666";
const ORIGIN = "https://vikasgaddu1.github.io";

function fakeDb(responses: Record<string, unknown> = {}, errors: Record<string, string> = {}) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const db: Db = {
    rpc(fn, args) {
      calls.push({ fn, args });
      if (errors[fn]) return Promise.resolve({ data: null, error: { message: errors[fn] } });
      const r = responses[fn];
      return Promise.resolve({ data: typeof r === "function" ? (r as (a: unknown) => unknown)(args) : r ?? null, error: null });
    },
  };
  return { db, calls };
}

function fakeStripe(over: Partial<{ sub: StripeSubscriptionLike; event: unknown; badSig: boolean; list: StripeSubscriptionLike[] }> = {}) {
  const sub: StripeSubscriptionLike = over.sub ?? {
    id: "sub_1", status: "active", customer: "cus_1", metadata: { counselor_id: CID },
    items: { data: [{ current_period_end: 1_900_000_000, price: { id: "price_m", recurring: { interval: "month" } } }] },
  };
  const stripe = {
    customers: { create: vi.fn(async () => ({ id: "cus_new" })) },
    checkout: { sessions: { create: vi.fn(async () => ({ url: "https://checkout.stripe.com/c/1" })) } },
    billingPortal: { sessions: { create: vi.fn(async () => ({ url: "https://billing.stripe.com/p/1" })) } },
    subscriptions: { retrieve: vi.fn(async () => sub), list: vi.fn(async () => ({ data: over.list ?? [sub] })) },
    webhooks: {
      constructEventAsync: vi.fn(async (_b: string, _s: string, _secret: string) => {
        if (over.badSig) throw new Error("No signatures found matching the expected signature");
        return over.event as never;
      }),
    },
  };
  return stripe;
}

function deps(o: { db: Db; stripe?: ReturnType<typeof fakeStripe> | null; user?: boolean; dbWithKey?: (k: string) => Db }): Deps {
  return {
    config: {
      portalUrl: "https://vikasgaddu1.github.io/College-compass/app/counselors/",
      origins: [ORIGIN],
      priceMonthly: "price_m",
      priceYearly: "price_y",
      webhookSecret: "whsec_test",
    },
    db: o.db,
    stripe: o.stripe === undefined ? (fakeStripe() as unknown as StripeLike) : (o.stripe as unknown as StripeLike | null),
    getUser: async (t) => (o.user === false || t !== "user-jwt" ? null : { id: "user-1", email: "c@example.com" }),
    dbWithKey: o.dbWithKey,
    log: () => {},
  };
}

const post = (body: unknown, headers: Record<string, string> = { authorization: "Bearer user-jwt", origin: ORIGIN }) =>
  new Request("https://fn.example/x", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

const ctx = (over: Record<string, unknown> = {}) => ({
  counselor_id: CID, status: "approved", name: "Ann", terms_accepted_at: "2026-10-01T00:00:00Z",
  subscription_status: "none", plan: null, stripe_customer_id: null, ...over,
});

describe("counselor-checkout", () => {
  it("answers CORS preflight for the portal origin", async () => {
    const res = await handleCheckout(new Request("https://fn.example/x", { method: "OPTIONS", headers: { origin: ORIGIN } }), deps({ db: fakeDb().db }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });
  it("requires a signed-in user", async () => {
    const res = await handleCheckout(post({ plan: "monthly" }, { origin: ORIGIN }), deps({ db: fakeDb().db }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "not_signed_in" });
  });
  it("rejects a bad plan", async () => {
    const { db } = fakeDb({ billing_counselor_for_user: ctx() });
    expect((await handleCheckout(post({ plan: "weekly" }), deps({ db }))).status).toBe(400);
  });
  it("needs a profile and accepted terms; refuses double subscriptions and suspended counselors", async () => {
    expect((await handleCheckout(post({ plan: "monthly" }), deps({ db: fakeDb().db }))).status).toBe(404);
    const t = await handleCheckout(post({ plan: "monthly" }), deps({ db: fakeDb({ billing_counselor_for_user: ctx({ terms_accepted_at: null }) }).db }));
    expect([t.status, (await t.json()).error]).toEqual([409, "terms_not_accepted"]);
    const a = await handleCheckout(post({ plan: "monthly" }), deps({ db: fakeDb({ billing_counselor_for_user: ctx({ subscription_status: "past_due" }) }).db }));
    expect([a.status, (await a.json()).error]).toEqual([409, "already_subscribed"]);
    const s = await handleCheckout(post({ plan: "monthly" }), deps({ db: fakeDb({ billing_counselor_for_user: ctx({ status: "suspended" }) }).db }));
    expect(s.status).toBe(403);
  });
  it("503 until Stripe is configured", async () => {
    const { db } = fakeDb({ billing_counselor_for_user: ctx() });
    const res = await handleCheckout(post({ plan: "yearly" }), deps({ db, stripe: null }));
    expect([res.status, (await res.json()).error]).toEqual([503, "billing_not_configured"]);
  });
  it("creates the Stripe customer once (idempotency key), stores it, and returns the Checkout URL", async () => {
    const { db, calls } = fakeDb({ billing_counselor_for_user: ctx(), billing_attach_customer: "cus_new" });
    const stripe = fakeStripe();
    const res = await handleCheckout(post({ plan: "yearly" }), deps({ db, stripe }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/1" });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(stripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "c@example.com", metadata: { counselor_id: CID, user_id: "user-1" } }),
      { idempotencyKey: `cc-counselor-customer-${CID}` },
    );
    expect(calls.map((c) => c.fn)).toEqual(["billing_counselor_for_user", "billing_attach_customer"]);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_new", line_items: [{ price: "price_y", quantity: 1 }], client_reference_id: CID }),
    );
  });
  it("reuses an existing customer", async () => {
    const { db } = fakeDb({ billing_counselor_for_user: ctx({ stripe_customer_id: "cus_old", subscription_status: "canceled" }) });
    const stripe = fakeStripe();
    expect((await handleCheckout(post({ plan: "monthly" }), deps({ db, stripe }))).status).toBe(200);
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_old" }));
  });
});

describe("counselor-billing", () => {
  it("opens the customer portal returning to #/billing", async () => {
    const { db } = fakeDb({ billing_counselor_for_user: ctx({ stripe_customer_id: "cus_1" }) });
    const stripe = fakeStripe();
    const res = await handleBilling(post({}), deps({ db, stripe }));
    expect(await res.json()).toEqual({ url: "https://billing.stripe.com/p/1" });
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_1", return_url: "https://vikasgaddu1.github.io/College-compass/app/counselors/#/billing",
    });
  });
  it("uses the counselor portal configuration when one is set", async () => {
    const { db } = fakeDb({ billing_counselor_for_user: ctx({ stripe_customer_id: "cus_1" }) });
    const stripe = fakeStripe();
    const d = deps({ db, stripe });
    d.config.portalConfiguration = "bpc_cc";
    await handleBilling(post({}), d);
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_1", return_url: "https://vikasgaddu1.github.io/College-compass/app/counselors/#/billing", configuration: "bpc_cc",
    });
  });
  it("409 without a Stripe customer", async () => {
    const { db } = fakeDb({ billing_counselor_for_user: ctx() });
    const res = await handleBilling(post({}), deps({ db }));
    expect([res.status, (await res.json()).error]).toEqual([409, "no_billing_account"]);
  });
});

describe("stripe-webhook", () => {
  const signed = (body = "{}") => new Request("https://fn.example/x", { method: "POST", headers: { "stripe-signature": "t=1,v1=abc" }, body });
  const event = (type: string, object: Record<string, unknown>) => ({ id: "evt_1", type, created: 1_700_000_000, data: { object } });

  it("rejects missing and bad signatures", async () => {
    expect((await handleWebhook(new Request("https://fn.example/x", { method: "POST", body: "{}" }), deps({ db: fakeDb().db }))).status).toBe(400);
    const res = await handleWebhook(signed(), deps({ db: fakeDb().db, stripe: fakeStripe({ badSig: true }) }));
    expect([res.status, (await res.json()).error]).toEqual([400, "bad_signature"]);
  });
  it("acknowledges unhandled events without touching the database", async () => {
    const { db, calls } = fakeDb();
    const res = await handleWebhook(signed(), deps({ db, stripe: fakeStripe({ event: event("charge.refunded", {}) }) }));
    expect(res.status).toBe(200);
    expect(calls).toEqual([]);
  });
  it("invoice.payment_failed → retrieves the subscription and applies its current state", async () => {
    const { db, calls } = fakeDb({ billing_apply_subscription: { result: "applied" } });
    const stripe = fakeStripe({
      event: event("invoice.payment_failed", { customer: "cus_1", parent: { subscription_details: { subscription: "sub_1" } } }),
      sub: { id: "sub_1", status: "past_due", customer: "cus_1", metadata: { counselor_id: CID }, items: { data: [{ price: { id: "price_m", recurring: { interval: "month" } } }] } },
    });
    const res = await handleWebhook(signed("raw-body"), deps({ db, stripe }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, result: "applied" });
    expect(stripe.webhooks.constructEventAsync).toHaveBeenCalledWith("raw-body", "t=1,v1=abc", "whsec_test", undefined, undefined);
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    expect(calls[0].fn).toBe("billing_apply_subscription");
    expect(calls[0].args).toMatchObject({
      p_source: "webhook", p_event_id: "evt_1", p_counselor: CID, p_subscription: "sub_1", p_stripe_status: "past_due",
      p_interval: "month", p_payment_failed: true, p_event_created: new Date(1_700_000_000 * 1000).toISOString(),
    });
  });
  it("500 (so Stripe retries) when the database write fails", async () => {
    const { db } = fakeDb({}, { billing_apply_subscription: "connection reset" });
    const stripe = fakeStripe({ event: event("customer.subscription.updated", { id: "sub_1", customer: "cus_1" }) });
    expect((await handleWebhook(signed(), deps({ db, stripe }))).status).toBe(500);
  });
  it("500 when secrets are missing", async () => {
    expect((await handleWebhook(signed(), deps({ db: fakeDb().db, stripe: null }))).status).toBe(500);
  });
});

describe("counselor-reconcile", () => {
  const req = (key?: string) => new Request("https://fn.example/x", { method: "POST", headers: key ? { authorization: `Bearer ${key}` } : {} });

  it("refuses callers without a working service key", async () => {
    expect((await handleReconcile(req(), deps({ db: fakeDb().db, dbWithKey: () => fakeDb().db }))).status).toBe(401);
    const denied = fakeDb({}, { billing_reconcile_targets: "permission denied for function billing_reconcile_targets" }).db;
    expect((await handleReconcile(req("anon-key"), deps({ db: fakeDb().db, dbWithKey: () => denied }))).status).toBe(401);
  });
  it("skips gracefully until Stripe is configured", async () => {
    const svc = fakeDb({ billing_reconcile_targets: [] }).db;
    const res = await handleReconcile(req("service-key"), deps({ db: svc, stripe: null, dbWithKey: () => svc }));
    expect(await res.json()).toEqual({ skipped: "stripe_not_configured" });
  });
  it("applies Stripe's state per counselor, picking the live subscription; no customer → no subscription", async () => {
    const { db, calls } = fakeDb({
      billing_reconcile_targets: [
        { counselor_id: CID, stripe_customer_id: "cus_1", subscription_status: "past_due" },
        { counselor_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", stripe_customer_id: null, subscription_status: "active" },
      ],
      billing_apply_subscription: (a: { p_subscription: string | null }) =>
        a.p_subscription ? { result: "applied", subscription_status: "active" } : { result: "applied", subscription_status: "canceled" },
    });
    const stripe = fakeStripe({
      list: [
        { id: "sub_old", status: "canceled", created: 9, customer: "cus_1" },
        { id: "sub_live", status: "active", created: 1, customer: "cus_1", items: { data: [{ price: { id: "price_y", recurring: { interval: "year" } } }] } },
      ],
    });
    const res = await handleReconcile(req("service-key"), deps({ db, stripe, dbWithKey: () => db }));
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(out.checked).toBe(2);
    expect(out.changed).toHaveLength(2);
    expect(stripe.subscriptions.list).toHaveBeenCalledTimes(1);
    const applies = calls.filter((c) => c.fn === "billing_apply_subscription").map((c) => c.args!);
    expect(applies[0]).toMatchObject({ p_source: "reconcile", p_counselor: CID, p_subscription: "sub_live", p_interval: "year", p_event_id: null });
    expect(applies[1]).toMatchObject({ p_counselor: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", p_subscription: null });
  });
});

// Request handlers for the counselor Edge Functions. Dependencies (Stripe, Supabase, auth) are injected so
// the handlers run under Vitest with fakes; the real wiring is in deps.ts (Deno only).
import {
  applyArgs,
  checkoutSessionParams,
  eventRef,
  HANDLED_EVENTS,
  pickSubscription,
  priceForPlan,
  subscriptionState,
  type StripeEventLike,
  type StripeSubscriptionLike,
} from "./billing.ts";
import { bearerToken, corsHeaders, fail, json } from "./http.ts";

export interface DbError {
  message: string;
  code?: string;
}
export interface Db {
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: DbError | null }>;
}

export interface StripeLike {
  customers: { create(params: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<{ id: string }> };
  checkout: { sessions: { create(params: Record<string, unknown>): Promise<{ url: string | null }> } };
  billingPortal: { sessions: { create(params: Record<string, unknown>): Promise<{ url: string }> } };
  subscriptions: {
    retrieve(id: string): Promise<StripeSubscriptionLike>;
    list(params: Record<string, unknown>): Promise<{ data: StripeSubscriptionLike[] }>;
  };
  webhooks: {
    constructEventAsync(
      payload: string,
      header: string,
      secret: string,
      tolerance?: number,
      cryptoProvider?: unknown,
    ): Promise<StripeEventLike>;
  };
}

export interface Config {
  portalUrl: string;
  origins: string[];
  priceMonthly?: string;
  priceYearly?: string;
  webhookSecret?: string;
  /** Stripe customer-portal configuration (bpc_…) for counselors; the account default when unset. */
  portalConfiguration?: string;
}

export interface Deps {
  config: Config;
  /** Service-role database client. */
  db: Db;
  /** Null when STRIPE_SECRET_KEY isn't set yet. */
  stripe: StripeLike | null;
  cryptoProvider?: unknown;
  /** Verifies a user access token with Supabase Auth. */
  getUser(token: string): Promise<{ id: string; email?: string | null } | null>;
  /** A database client acting with the given API key (reconcile: proves the caller holds a service key). */
  dbWithKey?(key: string): Db;
  now?(): Date;
  log?(msg: string, extra?: Record<string, unknown>): void;
}

interface CounselorCtx {
  counselor_id: string;
  status: string;
  name: string | null;
  terms_accepted_at: string | null;
  subscription_status: string;
  plan: string | null;
  stripe_customer_id: string | null;
}

const log = (deps: Deps, msg: string, extra?: Record<string, unknown>) =>
  (deps.log ?? ((m, e) => console.log(m, e ? JSON.stringify(e) : "")))(msg, extra);

function errText(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { type?: string; code?: string; message?: string };
    return [o.type, o.code, o.message].filter(Boolean).join(": ").slice(0, 300);
  }
  return String(e).slice(0, 300);
}

/** Shared front matter for the two portal functions: CORS, method, user JWT → counselor row. */
async function portalContext(
  req: Request,
  deps: Deps,
): Promise<{ cors: Record<string, string>; res?: Response; user?: { id: string; email?: string | null }; ctx?: CounselorCtx }> {
  const cors = corsHeaders(req, deps.config.origins);
  if (req.method === "OPTIONS") return { cors, res: new Response(null, { status: 204, headers: cors }) };
  if (req.method !== "POST") return { cors, res: fail(405, "method_not_allowed", "Use POST.", cors) };
  const token = bearerToken(req);
  const user = token ? await deps.getUser(token).catch(() => null) : null;
  if (!user) return { cors, res: fail(401, "not_signed_in", "Sign in again.", cors) };
  const { data, error } = await deps.db.rpc("billing_counselor_for_user", { p_user: user.id });
  if (error) {
    log(deps, "billing_counselor_for_user failed", { error: error.message });
    return { cors, res: fail(500, "server_error", "Something went wrong. Try again.", cors) };
  }
  if (!data) return { cors, res: fail(404, "no_profile", "Save your counselor profile first.", cors) };
  return { cors, user, ctx: data as CounselorCtx };
}

// ───────────── POST /functions/v1/counselor-checkout { plan } → { url } ─────────────
export async function handleCheckout(req: Request, deps: Deps): Promise<Response> {
  const { cors, res, user, ctx } = await portalContext(req, deps);
  if (res) return res;
  const body = await req.json().catch(() => null);
  const plan = body && typeof body === "object" ? (body as { plan?: unknown }).plan : undefined;
  if (plan !== "monthly" && plan !== "yearly") return fail(400, "bad_plan", "Choose monthly or yearly.", cors);
  const price = priceForPlan(plan, { monthly: deps.config.priceMonthly, yearly: deps.config.priceYearly });
  if (!deps.stripe || !price) return fail(503, "billing_not_configured", "Payments aren't set up yet. Please try again later.", cors);
  if (!ctx!.terms_accepted_at) return fail(409, "terms_not_accepted", "Accept the counselor terms first.", cors);
  if (ctx!.status === "suspended") return fail(403, "suspended", "This listing is suspended; contact College Compass.", cors);
  if (["active", "trialing", "past_due", "unpaid"].includes(ctx!.subscription_status)) {
    return fail(409, "already_subscribed", "You already have a subscription. Use Manage billing to change or fix it.", cors);
  }
  try {
    let customer = ctx!.stripe_customer_id;
    if (!customer) {
      const created = await deps.stripe.customers.create(
        {
          email: user!.email ?? undefined,
          name: ctx!.name ?? undefined,
          metadata: { counselor_id: ctx!.counselor_id, user_id: user!.id },
        },
        // Two quick clicks create one customer, not two.
        { idempotencyKey: `cc-counselor-customer-${ctx!.counselor_id}` },
      );
      const { data, error } = await deps.db.rpc("billing_attach_customer", {
        p_counselor: ctx!.counselor_id,
        p_customer: created.id,
      });
      if (error) throw new Error(`billing_attach_customer: ${error.message}`);
      customer = (data as string) ?? created.id;
    }
    const session = await deps.stripe.checkout.sessions.create(
      checkoutSessionParams({ customer: customer!, price, counselorId: ctx!.counselor_id, portalUrl: deps.config.portalUrl }),
    );
    if (!session.url) throw new Error("Checkout session has no URL");
    return json({ url: session.url }, 200, cors);
  } catch (e) {
    log(deps, "checkout failed", { counselor_id: ctx!.counselor_id, error: errText(e) });
    return fail(502, "stripe_error", "Couldn't start checkout. Please try again.", cors);
  }
}

// ───────────── POST /functions/v1/counselor-billing {} → { url } ─────────────
export async function handleBilling(req: Request, deps: Deps): Promise<Response> {
  const { cors, res, ctx } = await portalContext(req, deps);
  if (res) return res;
  if (!deps.stripe) return fail(503, "billing_not_configured", "Payments aren't set up yet. Please try again later.", cors);
  if (!ctx!.stripe_customer_id) return fail(409, "no_billing_account", "You haven't subscribed yet.", cors);
  try {
    const session = await deps.stripe.billingPortal.sessions.create({
      customer: ctx!.stripe_customer_id,
      return_url: `${deps.config.portalUrl}#/billing`,
      ...(deps.config.portalConfiguration ? { configuration: deps.config.portalConfiguration } : {}),
    });
    return json({ url: session.url }, 200, cors);
  } catch (e) {
    log(deps, "billing portal failed", { counselor_id: ctx!.counselor_id, error: errText(e) });
    return fail(502, "stripe_error", "Couldn't open billing. Please try again.", cors);
  }
}

// ───────────── POST /functions/v1/stripe-webhook (Stripe only; signature checked) ─────────────
export async function handleWebhook(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Use POST.");
  const sig = req.headers.get("stripe-signature");
  if (!sig) return fail(400, "no_signature", "Missing Stripe-Signature.");
  if (!deps.stripe || !deps.config.webhookSecret) {
    log(deps, "stripe-webhook: STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not set");
    return fail(500, "not_configured", "Webhook not configured."); // Stripe retries; nothing is lost
  }
  const body = await req.text();
  let event: StripeEventLike;
  try {
    event = await deps.stripe.webhooks.constructEventAsync(body, sig, deps.config.webhookSecret, undefined, deps.cryptoProvider);
  } catch {
    return fail(400, "bad_signature", "Signature verification failed.");
  }
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) return json({ received: true, ignored: event.type });
  const ref = eventRef(event);
  if (!ref) return json({ received: true, ignored: "not_a_subscription" });

  try {
    const observedAt = (deps.now ?? (() => new Date()))();
    // Always read the subscription's CURRENT state: events can arrive late or out of order.
    const sub = await deps.stripe.subscriptions.retrieve(ref.subscriptionId);
    const args = applyArgs("webhook", subscriptionState(sub), {
      eventId: event.id,
      eventType: event.type,
      eventCreated: event.created,
      counselorId: ref.counselorId,
      customerId: ref.customerId,
      paymentFailed: ref.paymentFailed,
      observedAt,
    });
    const { data, error } = await deps.db.rpc("billing_apply_subscription", args);
    if (error) throw new Error(`billing_apply_subscription: ${error.message}`);
    const result = (data as { result?: string } | null)?.result ?? "unknown";
    log(deps, "stripe-webhook", { event: event.id, type: event.type, result });
    return json({ received: true, result });
  } catch (e) {
    // 500 → Stripe retries with backoff for up to 3 days; the event isn't marked processed.
    log(deps, "stripe-webhook failed", { event: event.id, type: event.type, error: errText(e) });
    return fail(500, "processing_failed", "Will retry.");
  }
}

// ───────────── POST /functions/v1/counselor-reconcile (daily; service key required) ─────────────
export async function handleReconcile(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Use POST.");
  const key = bearerToken(req) ?? req.headers.get("apikey");
  if (!key || !deps.dbWithKey) return fail(401, "not_authorized", "Service key required.");
  // Authorization = the presented key can call a service-role-only function.
  const caller = deps.dbWithKey(key);
  const { data: targets, error } = await caller.rpc("billing_reconcile_targets");
  if (error) return fail(401, "not_authorized", "Service key required.");
  if (!deps.stripe) return json({ skipped: "stripe_not_configured" });

  const out = { checked: 0, changed: [] as Array<Record<string, unknown>>, errors: 0, results: {} as Record<string, number> };
  for (const t of (targets ?? []) as Array<{ counselor_id: string; stripe_customer_id: string | null; subscription_status: string }>) {
    out.checked++;
    try {
      const observedAt = (deps.now ?? (() => new Date()))();
      let sub: StripeSubscriptionLike | null = null;
      if (t.stripe_customer_id) {
        const list = await deps.stripe.subscriptions.list({ customer: t.stripe_customer_id, status: "all", limit: 20 });
        sub = pickSubscription(list.data);
      }
      const args = applyArgs("reconcile", sub ? subscriptionState(sub) : null, {
        counselorId: t.counselor_id,
        customerId: t.stripe_customer_id,
        observedAt,
      });
      // Reconcile always targets the row it read, even if Stripe metadata is missing.
      args.p_counselor = t.counselor_id;
      const { data, error: e2 } = await caller.rpc("billing_apply_subscription", args);
      if (e2) throw new Error(e2.message);
      const r = data as { result: string; subscription_status?: string };
      out.results[r.result] = (out.results[r.result] ?? 0) + 1;
      if (r.result === "applied") out.changed.push({ counselor_id: t.counselor_id, from: t.subscription_status, to: r.subscription_status });
    } catch (e) {
      out.errors++;
      log(deps, "reconcile failed for counselor", { counselor_id: t.counselor_id, error: errText(e) });
    }
  }
  log(deps, "reconcile done", { checked: out.checked, changed: out.changed.length, errors: out.errors });
  return json(out, out.errors ? 207 : 200);
}

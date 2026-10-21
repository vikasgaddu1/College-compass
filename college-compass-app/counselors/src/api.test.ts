/** createPortalApi against a fake supabase-js client: the right tables, RPCs, buckets and functions. */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPortalApi } from "./api";

function fakeClient(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[]> = {};
  const log = (k: string, ...a: unknown[]) => (calls[k] = [...(calls[k] ?? []), a]);
  const row = { id: "c1", user_id: "u1", status: "draft", name: "Jane" };
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    single: vi.fn(async () => ({ data: row, error: null })),
    update: vi.fn((patch: unknown) => { log("update", patch); return query; }),
    insert: vi.fn((v: unknown) => { log("insert", v); return query; }),
  };
  const sb = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1", email: "j@x.co" } } }, error: null })),
      onAuthStateChange: vi.fn((cb: (e: string, s: unknown) => void) => { log("onAuth", cb); return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
      signInWithOtp: vi.fn(async (a: unknown) => { log("otp", a); return { error: null }; }),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: vi.fn((t: string) => { log("from", t); return query; }),
    rpc: vi.fn(async (fn: string, args?: unknown) => { log("rpc", fn, args); return fn === "is_admin" ? { data: true, error: null } : { data: [], error: null }; }),
    storage: { from: vi.fn((b: string) => { log("bucket", b); return { upload: vi.fn(async (p: string, blob: Blob, o: unknown) => { log("upload", p, blob, o); return { error: null }; }), getPublicUrl: (p: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/counselor-photos/${p}` } }) }; }) },
    functions: { invoke: vi.fn(async (name: string, o: unknown) => { log("fn", name, o); return { data: { url: "https://checkout.stripe.com/x" }, error: null }; }) },
    ...overrides,
  };
  return { sb: sb as unknown as SupabaseClient, calls, query };
}

describe("createPortalApi", () => {
  it("session + sign-in with the redirect", async () => {
    const { sb, calls } = fakeClient();
    const api = createPortalApi(sb);
    expect(await api.session()).toEqual({ userId: "u1", email: "j@x.co" });
    await api.signIn("j@x.co", "https://site/app/counselors/#/profile");
    expect(calls.otp![0]).toEqual([{ email: "j@x.co", options: { emailRedirectTo: "https://site/app/counselors/#/profile", shouldCreateUser: true } }]);
  });

  it("reads own row, updates by id, inserts with user_id on first save", async () => {
    const { sb, calls, query } = fakeClient();
    const api = createPortalApi(sb);
    await api.myCounselor();
    expect(calls.from![0]).toEqual(["counselors"]);
    expect(query.maybeSingle).toHaveBeenCalled();
    await api.saveDraft("c1", { name: "Jane" } as never);
    expect(calls.update![0]).toEqual([{ name: "Jane" }]);
    expect(query.eq).toHaveBeenCalledWith("id", "c1");
    await api.saveDraft(null, { name: "Jane" } as never);
    expect(calls.insert![0]).toEqual([{ user_id: "u1", name: "Jane" }]);
  });

  it("terms, submit, admin and billing RPCs/functions", async () => {
    const { sb, calls } = fakeClient();
    const api = createPortalApi(sb);
    await api.acceptTerms();
    await api.submitForReview();
    expect(await api.isAdmin()).toBe(true);
    await api.adminCounselors();
    await api.adminReview("c1", "approve", null, "2027-03-01", "2026-10-21T00:00:00Z");
    await api.adminReports();
    expect(calls.rpc!.map((c) => (c as unknown[])[0])).toEqual(["accept_counselor_terms", "submit_counselor_for_review", "is_admin", "admin_counselors", "admin_review_counselor", "admin_counselor_reports"]);
    expect(calls.rpc![4]).toEqual(["admin_review_counselor", { p_id: "c1", p_decision: "approve", p_note: null, p_founding_until: "2027-03-01", p_expected_updated_at: "2026-10-21T00:00:00Z" }]);
    expect(await api.checkout("yearly")).toBe("https://checkout.stripe.com/x");
    expect(calls.fn![0]).toEqual(["counselor-checkout", { body: { plan: "yearly" } }]);
    await api.billingPortal();
    expect((calls.fn![1] as unknown[])[0]).toBe("counselor-billing");
  });

  it("uploads photos under the user's folder in counselor-photos and returns the public URL", async () => {
    const { sb, calls } = fakeClient();
    const api = createPortalApi(sb);
    const url = await api.uploadPhoto("u1", new Blob(["x"], { type: "image/jpeg" }));
    expect(calls.bucket![0]).toEqual(["counselor-photos"]);
    expect((calls.upload![0] as string[])[0]).toMatch(/^u1\/photo-\d+\.jpg$/);
    expect(url).toMatch(/^https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/counselor-photos\/u1\/photo-/);
  });

  it("surfaces errors", async () => {
    const { sb } = fakeClient({ rpc: vi.fn(async () => ({ data: null, error: { message: "incomplete_profile", hint: "Missing: bio" } })) });
    const api = createPortalApi(sb);
    await expect(api.submitForReview()).rejects.toMatchObject({ message: "incomplete_profile" });
    expect(await api.isAdmin()).toBe(false);
  });
});

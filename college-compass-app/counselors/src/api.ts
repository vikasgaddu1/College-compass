/**
 * Everything the portal asks Supabase for, behind one interface so screens can be tested with a fake.
 * `createPortalApi` wraps a real supabase-js client (docs/COUNSELORS_CONTRACT.md; the SQL shapes are in
 * supabase/migrations/*_counselors.sql).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Status = "draft" | "pending" | "approved" | "rejected" | "suspended";
export type SubscriptionStatus = "none" | "trialing" | "active" | "past_due" | "unpaid" | "canceled";
export type Plan = "monthly" | "yearly" | "founding" | null;

/** The draft fields a counselor edits. */
export interface Draft {
  name: string | null;
  title: string | null;
  photo_url: string | null;
  bio: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  states: string[];
  specialties: string[];
  modes: string[];
  credentials: string | null;
}

export const EMPTY_DRAFT: Draft = { name: null, title: null, photo_url: null, bio: null, website: null, phone: null, email: null, city: null, states: [], specialties: [], modes: [], credentials: null };
export const DRAFT_KEYS = Object.keys(EMPTY_DRAFT) as (keyof Draft)[];

export interface CounselorRow extends Draft {
  id: string;
  user_id: string;
  status: Status;
  published: Draft | null;
  has_changes: boolean;
  review_note: string | null;
  terms_accepted_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  subscription_status: SubscriptionStatus;
  plan: Plan;
  founding_until: string | null;
  /** First failed payment; the listing stays up for 7 days from here. */
  past_due_since?: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminRow extends CounselorRow {
  account_email: string | null;
  awaiting_review: boolean;
  listed: boolean;
  report_count: number;
  recent_report_count: number;
}

export interface Report {
  id: number;
  counselor_id: string;
  counselor_name: string | null;
  counselor_status: Status;
  reason: string;
  detail: string | null;
  reporter: string | null;
  created_at: string;
}

export interface Session {
  userId: string;
  email: string | null;
}

export type Decision = "approve" | "reject" | "suspend" | "unsuspend" | "founding";

/** What `admin_review_counselor` returns: the row as saved, so the admin screen can say what actually happened. */
export interface ReviewResult {
  ok: boolean;
  id: string;
  status: Status;
  /** Server truth: visible in the app's directory right now. */
  listed: boolean;
  has_changes: boolean;
  plan: Plan;
  founding_until: string | null;
  updated_at: string;
}

export interface PortalApi {
  session(): Promise<Session | null>;
  onAuthChange(cb: (s: Session | null) => void): () => void;
  /** Email magic link; the link returns to `redirectTo`. */
  signIn(email: string, redirectTo: string): Promise<void>;
  signOut(): Promise<void>;
  myCounselor(): Promise<CounselorRow | null>;
  /** First save creates the row (status draft). */
  saveDraft(existingId: string | null, draft: Draft): Promise<CounselorRow>;
  acceptTerms(): Promise<void>;
  submitForReview(): Promise<void>;
  /** Upload under `<uid>/…` in `counselor-photos`; returns the public URL. */
  uploadPhoto(userId: string, blob: Blob): Promise<string>;
  checkout(plan: "monthly" | "yearly"): Promise<string>;
  billingPortal(): Promise<string>;
  isAdmin(): Promise<boolean>;
  adminCounselors(): Promise<AdminRow[]>;
  /** Resolves with the saved row's status/listed/founding_until (null only if the server sent nothing back). */
  adminReview(id: string, decision: Decision, note: string | null, foundingUntil: string | null, expectedUpdatedAt?: string): Promise<ReviewResult | null>;
  adminReports(): Promise<Report[]>;
}

/** Friendly text for a Supabase/PostgREST error (the backend raises short codes with a hint). */
export function describeError(e: unknown): string {
  if (!e) return "Something went wrong.";
  if (typeof e === "string") return e;
  const err = e as { message?: string; hint?: string; details?: string; code?: string };
  const m = err.message ?? "";
  const known: Record<string, string> = {
    not_signed_in: "Please sign in again.",
    no_profile: "Save your profile first.",
    terms_not_accepted: "Please accept the counselor terms first.",
    incomplete_profile: `Your profile is missing something${err.hint ? ` — ${err.hint.replace(/^Missing: /, "")}` : ""}.`,
    no_changes: "Your published listing already matches your profile.",
    suspended: "This listing is suspended. Contact Tierwise.",
    not_authorized: "You don't have access to that.",
    changed_since_viewed: "This profile changed after you opened it. Reload and review again.",
    photo_url_invalid: "Please upload the photo here rather than linking to one.",
  };
  for (const k of Object.keys(known)) if (m.includes(k)) return known[k]!;
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Please wait a few minutes and try again.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Couldn't reach the server. Check your connection and try again.";
  if (/violates check constraint/i.test(m)) return "One of the fields has an unsupported value. Check the website, phone and email.";
  return err.hint ? `${m}. ${err.hint}` : m || "Something went wrong.";
}

const ROW_SELECT = "id,user_id,status,name,title,photo_url,bio,website,phone,email,city,states,specialties,modes,credentials,published,has_changes,review_note,terms_accepted_at,submitted_at,approved_at,subscription_status,plan,founding_until,past_due_since,current_period_end,cancel_at_period_end,created_at,updated_at";

export function createPortalApi(sb: SupabaseClient): PortalApi {
  const toSession = (s: { user?: { id: string; email?: string } } | null | undefined): Session | null => (s?.user ? { userId: s.user.id, email: s.user.email ?? null } : null);
  const throwIf = (error: unknown) => {
    if (error) throw error;
  };
  return {
    async session() {
      const { data, error } = await sb.auth.getSession();
      throwIf(error);
      return toSession(data.session);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_evt, s) => cb(toSession(s)));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, redirectTo) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
      throwIf(error);
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async myCounselor() {
      const { data, error } = await sb.from("counselors").select(ROW_SELECT).maybeSingle();
      throwIf(error);
      return (data as CounselorRow | null) ?? null;
    },
    async saveDraft(existingId, draft) {
      if (existingId) {
        const { data, error } = await sb.from("counselors").update(draft).eq("id", existingId).select(ROW_SELECT).single();
        throwIf(error);
        return data as CounselorRow;
      }
      const { data: s } = await sb.auth.getSession();
      const uid = s.session?.user?.id;
      if (!uid) throw new Error("not_signed_in");
      const { data, error } = await sb.from("counselors").insert({ user_id: uid, ...draft }).select(ROW_SELECT).single();
      throwIf(error);
      return data as CounselorRow;
    },
    async acceptTerms() {
      const { error } = await sb.rpc("accept_counselor_terms");
      throwIf(error);
    },
    async submitForReview() {
      const { error } = await sb.rpc("submit_counselor_for_review");
      throwIf(error);
    },
    async uploadPhoto(userId, blob) {
      const path = `${userId}/photo-${Date.now()}.jpg`;
      const { error } = await sb.storage.from("counselor-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
      throwIf(error);
      return sb.storage.from("counselor-photos").getPublicUrl(path).data.publicUrl;
    },
    async checkout(plan) {
      const { data, error } = await sb.functions.invoke<{ url?: string }>("counselor-checkout", { body: { plan } });
      throwIf(error);
      if (!data?.url) throw new Error("Checkout didn't return a payment link.");
      return data.url;
    },
    async billingPortal() {
      const { data, error } = await sb.functions.invoke<{ url?: string }>("counselor-billing", { body: {} });
      throwIf(error);
      if (!data?.url) throw new Error("Billing didn't return a link.");
      return data.url;
    },
    async isAdmin() {
      const { data, error } = await sb.rpc("is_admin");
      if (error) return false;
      return data === true;
    },
    async adminCounselors() {
      const { data, error } = await sb.rpc("admin_counselors", { p_status: null });
      throwIf(error);
      return ((data as AdminRow[] | null) ?? []).map((r) => ({ ...r, report_count: Number(r.report_count ?? 0), recent_report_count: Number(r.recent_report_count ?? 0) }));
    },
    async adminReview(id, decision, note, foundingUntil, expectedUpdatedAt) {
      const { data, error } = await sb.rpc("admin_review_counselor", { p_id: id, p_decision: decision, p_note: note, p_founding_until: foundingUntil, p_expected_updated_at: expectedUpdatedAt ?? null });
      throwIf(error);
      return data && typeof data === "object" && !Array.isArray(data) ? (data as ReviewResult) : null;
    },
    async adminReports() {
      const { data, error } = await sb.rpc("admin_counselor_reports");
      throwIf(error);
      return (data as Report[] | null) ?? [];
    },
  };
}

// Supabase client wired behind a feature flag.
// Enabled only when BOTH VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are present.
// The site remains fully functional signed-out on localStorage when disabled.

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const url    = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon   = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const SYNC_ENABLED = Boolean(url && anon);

export const supabase: SupabaseClient | null = SYNC_ENABLED
  ? createClient(url!, anon!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        storageKey: "college-compass-auth",
      },
    })
  : null;

// -- Types ------------------------------------------------------------------

export type Role = "owner" | "editor" | "viewer";
export type Status = "researching" | "considering" | "applying" | "applied" | "waitlisted" | "admitted" | "declined" | "enrolled";

export interface Workspace   { id: string; owner_id: string; name: string; created_at: string; }
export interface Member      { workspace_id: string; user_id: string | null; invited_email: string | null; role: Role; display_name: string | null; }
export interface SchoolNote  { id: string; workspace_id: string; school_slug: string; author_id: string; content: string | null; rating: number | null; status: Status | null; updated_at: string; }
export interface AppProfile  { workspace_id: string; gpa_uw: number | null; gpa_w: number | null; sat: number | null; act: number | null; test_plan: string | null; rigor_note: string | null; odds_thresholds: any; updated_at: string; }
export interface InterestRow { id: string; workspace_id: string; school_slug: string; action: string; occurred_on: string | null; note: string | null; created_by: string; created_at: string; }

// -- Auth helpers -----------------------------------------------------------

export async function currentUser(): Promise<User | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function signInWithMagicLink(email: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Sync is disabled — Supabase not configured." };
  const emailRedirectTo = window.location.origin + window.location.pathname;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo },
  });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

// After sign-in, attach any pending invites matching this user's email.
export async function claimPendingInvites(): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase.rpc("claim_pending_invites");
  if (error) { console.warn("claim_pending_invites failed:", error.message); return 0; }
  return typeof data === "number" ? data : 0;
}

// -- Workspace helpers ------------------------------------------------------

export async function listWorkspaces(): Promise<Workspace[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("workspaces").select("*").order("created_at");
  if (error) { console.warn("listWorkspaces:", error.message); return []; }
  return data as Workspace[];
}

export async function ensureOwnedWorkspace(defaultName = "My Applicant — Fall 2027"): Promise<Workspace | null> {
  if (!supabase) return null;
  const user = await currentUser();
  if (!user) return null;
  // Prefer an existing owned workspace
  const { data: owned } = await supabase.from("workspaces").select("*").eq("owner_id", user.id).order("created_at").limit(1);
  if (owned && owned.length > 0) return owned[0] as Workspace;
  const { data: created, error } = await supabase.from("workspaces").insert({ owner_id: user.id, name: defaultName }).select().single();
  if (error) { console.warn("ensureOwnedWorkspace:", error.message); return null; }
  return created as Workspace;
}

// -- Notes / Profile / Interest ---------------------------------------------

export async function listNotes(workspace_id: string): Promise<SchoolNote[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("school_notes").select("*").eq("workspace_id", workspace_id);
  if (error) { console.warn("listNotes:", error.message); return []; }
  return data as SchoolNote[];
}

export async function upsertNote(row: Partial<SchoolNote> & { workspace_id: string; school_slug: string; author_id: string }): Promise<SchoolNote | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("school_notes").upsert(row, { onConflict: "workspace_id,school_slug,author_id" }).select().single();
  if (error) { console.warn("upsertNote:", error.message); return null; }
  return data as SchoolNote;
}

export async function loadProfile(workspace_id: string): Promise<AppProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("applicant_profile").select("*").eq("workspace_id", workspace_id).maybeSingle();
  if (error) { console.warn("loadProfile:", error.message); return null; }
  return data as AppProfile | null;
}

export async function saveProfile(row: Partial<AppProfile> & { workspace_id: string }): Promise<AppProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("applicant_profile").upsert(row, { onConflict: "workspace_id" }).select().single();
  if (error) { console.warn("saveProfile:", error.message); return null; }
  return data as AppProfile;
}

export async function listInterest(workspace_id: string): Promise<InterestRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("interest_log").select("*").eq("workspace_id", workspace_id).order("occurred_on", { ascending: false });
  if (error) { console.warn("listInterest:", error.message); return []; }
  return data as InterestRow[];
}

export async function addInterest(row: Omit<InterestRow, "id" | "created_at">): Promise<InterestRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("interest_log").insert(row).select().single();
  if (error) { console.warn("addInterest:", error.message); return null; }
  return data as InterestRow;
}

// -- Member helpers ---------------------------------------------------------

export async function inviteCounselor(workspace_id: string, email: string, role: Role = "viewer", display_name: string | null = null): Promise<{ ok: boolean; error: string | null }> {
  if (!supabase) return { ok: false, error: "Sync disabled" };
  const { error } = await supabase.from("workspace_members").insert({ workspace_id, user_id: null, invited_email: email, role, display_name });
  return { ok: !error, error: error?.message ?? null };
}

export async function listMembers(workspace_id: string): Promise<Member[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("workspace_members").select("*").eq("workspace_id", workspace_id);
  if (error) { console.warn("listMembers:", error.message); return []; }
  return data as Member[];
}

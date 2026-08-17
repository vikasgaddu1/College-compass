// Sync panel: minimal sign-in / counselor-invite / local-notes-import UI.
// Guarded behind SYNC_ENABLED — renders a friendly "coming soon" if Supabase
// env vars aren't set at build time.

import { useEffect, useState } from "react";
import { Cloud, CloudOff, LogIn, LogOut, Mail, UserPlus, Upload, Check } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import {
  SYNC_ENABLED, supabase,
  currentUser, signInWithMagicLink, signOut, claimPendingInvites,
  ensureOwnedWorkspace, inviteCounselor, listMembers,
  upsertNote,
  type Workspace, type Member,
} from "@/lib/supabase";

export function SyncPanel() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [message, setMessage] = useState<string | null>(null);
  const [importState, setImportState] = useState<"idle" | "running" | "done">("idle");
  const [importCount, setImportCount] = useState(0);

  useEffect(() => {
    if (!SYNC_ENABLED) return;
    (async () => {
      const u = await currentUser();
      setUser(u);
      if (u) {
        await claimPendingInvites();
        const w = await ensureOwnedWorkspace();
        setWorkspace(w);
        if (w) setMembers(await listMembers(w.id));
      }
    })();
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        await claimPendingInvites();
        const w = await ensureOwnedWorkspace();
        setWorkspace(w);
        if (w) setMembers(await listMembers(w.id));
      } else {
        setWorkspace(null);
        setMembers([]);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!SYNC_ENABLED) {
    return (
      <div className="card p-4 text-[12.5px]">
        <div className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))] mb-2">
          <CloudOff size={13}/>
          <div className="text-[11px] uppercase tracking-wider">Cloud sync</div>
        </div>
        <p className="text-[hsl(var(--muted-foreground))] leading-snug">
          Cloud sync is <strong>not yet configured</strong>. Notes stay in localStorage on this device. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> at build time to enable.
        </p>
      </div>
    );
  }

  // ── Signed out ────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-1.5 text-[hsl(var(--accent))]">
          <Cloud size={13}/>
          <div className="text-[11px] uppercase tracking-wider">Cloud sync — sign in</div>
        </div>
        <p className="text-[12px] text-[hsl(var(--muted-foreground))] leading-snug">
          Sign in with a magic link to sync notes across devices and share with a counselor. Signed-out use continues on localStorage only.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 min-w-[180px] px-2 py-1 text-[12px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"
          />
          <button
            className="chip chip-primary inline-flex items-center gap-1"
            onClick={async () => {
              if (!email) return;
              setMessage("Sending link…");
              const { error } = await signInWithMagicLink(email);
              setMessage(
                error
                  ? /not authorized/i.test(error)
                    ? "This address is not authorized to receive mail from the project yet — the built-in Supabase sender only delivers to members of the project's organization. Add it under the organization's Team tab, or configure custom SMTP."
                    : /rate limit/i.test(error)
                      ? "Email rate limit hit — the built-in sender allows only about 2 messages per hour. Wait, or configure custom SMTP."
                      : `Error: ${error}`
                  : "Check your email for a sign-in link — also check the spam folder.",
              );
            }}
          >
            <Mail size={11}/> Send magic link
          </button>
        </div>
        {message && <div className="text-[11px] text-[hsl(var(--accent))]">{message}</div>}
      </div>
    );
  }

  // ── Signed in ─────────────────────────────────────────────────────
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[hsl(var(--accent))]">
          <Cloud size={13}/>
          <div className="text-[11px] uppercase tracking-wider">Cloud sync — signed in</div>
        </div>
        <button className="chip chip-outline inline-flex items-center gap-1" onClick={async () => { await signOut(); }}>
          <LogOut size={11}/> Sign out
        </button>
      </div>
      <div className="text-[11.5px] text-[hsl(var(--muted-foreground))]">
        Signed in as <strong className="text-[hsl(var(--foreground))]">{user.email}</strong>
        {workspace && <> · workspace <strong className="text-[hsl(var(--foreground))]">{workspace.name}</strong></>}
      </div>

      {/* Import local notes */}
      {workspace && (
        <div className="border-t border-[hsl(var(--border))] pt-3">
          <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">One-time: import notes from this device</div>
          <button
            className="chip chip-outline inline-flex items-center gap-1"
            disabled={importState === "running"}
            onClick={async () => {
              setImportState("running");
              try {
                const raw = window.localStorage.getItem("college-compass-notes");
                if (!raw) { setImportState("done"); setImportCount(0); return; }
                const notes: Record<string, string> = JSON.parse(raw);
                let count = 0;
                for (const [slug, content] of Object.entries(notes)) {
                  if (!content?.trim()) continue;
                  await upsertNote({
                    workspace_id: workspace.id,
                    school_slug: slug,
                    author_id: user.id,
                    content,
                  });
                  count++;
                }
                setImportCount(count);
                setImportState("done");
              } catch (e) {
                setMessage(`Import failed: ${(e as Error).message}`);
                setImportState("idle");
              }
            }}
          >
            {importState === "done" ? <Check size={11}/> : <Upload size={11}/>}
            {importState === "running" ? "Importing…" : importState === "done" ? `Imported ${importCount} notes` : "Import local notes"}
          </button>
        </div>
      )}

      {/* Invite counselor */}
      {workspace && (
        <div className="border-t border-[hsl(var(--border))] pt-3 space-y-2">
          <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Pre-authorize a counselor</div>
          <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] leading-snug rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] px-2.5 py-2">
            <strong className="text-[hsl(var(--foreground))]">This does not send an email.</strong> It grants the address permission to join
            this workspace. Send them the dashboard link yourself — they sign in with their own magic link
            using that exact address, and the pending access attaches automatically on first sign-in.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="counselor@school.edu"
              className="flex-1 min-w-[180px] px-2 py-1 text-[12px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as any)}
              className="px-2 py-1 text-[12px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"
            >
              <option value="viewer">View only</option>
              <option value="editor">Can edit</option>
            </select>
            <button
              className="chip chip-primary inline-flex items-center gap-1"
              onClick={async () => {
                if (!inviteEmail) return;
                const { ok, error } = await inviteCounselor(workspace.id, inviteEmail, inviteRole);
                if (ok) {
                  setInviteEmail("");
                  setMembers(await listMembers(workspace.id));
                  setMessage("Access granted. No email was sent — send them the link yourself; they request their own magic link with that address.");
                } else {
                  setMessage(`Invite failed: ${error}`);
                }
              }}
            >
              <UserPlus size={11}/> Grant access
            </button>
          </div>
          <button
            className="chip chip-outline inline-flex items-center gap-1"
            onClick={() => {
              const link = `${window.location.origin}${window.location.pathname}#/sync`;
              navigator.clipboard?.writeText(link).then(
                () => setMessage("Sign-in link copied — send it to them by text or email."),
                () => setMessage(`Copy failed. Share this link manually: ${link}`),
              );
            }}
          >
            Copy sign-in link to share
          </button>
          {members.length > 0 && (
            <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
              <strong>Members:</strong> {members.map(m => `${m.display_name || m.invited_email || m.user_id?.slice(0,8) || "unknown"} (${m.role}${!m.user_id ? " · pending" : ""})`).join(", ")}
            </div>
          )}
        </div>
      )}

      {message && <div className="text-[11px] text-[hsl(var(--accent))]">{message}</div>}
    </div>
  );
}

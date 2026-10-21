/** Email magic-link sign-in. The link returns to the portal at `#/profile`. */
import { useState } from "react";
import { Banner } from "@/components/ui";
import { sanitizeEmail } from "@/data/counselors";
import { describeError } from "../api";
import { usePortal } from "../Portal";
import { portalUrl } from "../router";

export function SignIn({ reason }: { reason?: string }) {
  const { api } = usePortal();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = sanitizeEmail(email);
    if (!addr) {
      setErr("Enter the email address you want to sign in with.");
      return;
    }
    if (!api) return;
    setBusy(true);
    setErr(null);
    try {
      await api.signIn(addr, `${portalUrl()}#/profile`);
      setSent(addr);
    } catch (ex) {
      setErr(describeError(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cp-narrow py-12">
      <h1 className="cp-h2">Sign in</h1>
      {reason && <p className="mb-3 text-subhead text-text-muted">Sign in to open {reason === "/admin" ? "the admin page" : reason === "/billing" ? "billing" : "your profile"}.</p>}
      {sent ? (
        <div className="cc-card mt-4 p-6 text-center">
          <div className="text-[40px] leading-none" aria-hidden>
            ✉️
          </div>
          <h2 className="mt-3 text-title3">Check your email</h2>
          <p className="mt-2 text-subhead text-text-muted">
            We sent a sign-in link to <span className="font-medium text-text">{sent}</span>. Open it on this device to continue. The link expires in an hour.
          </p>
          <button type="button" className="cc-link mt-5 min-h-tap text-subhead" onClick={() => setSent(null)}>
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="cc-card mt-4 p-6" noValidate>
          <p className="text-body text-text-muted">Sign in with your email — we'll send a link. No password to remember.</p>
          <label className="cp-label mt-5" htmlFor="email">
            Email
          </label>
          <input id="email" className="cc-input" type="email" inputMode="email" autoComplete="email" placeholder="you@yourpractice.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} required />
          {err && (
            <div className="mt-3">
              <Banner tone="error">{err}</Banner>
            </div>
          )}
          <div className="mt-4">
            <button type="submit" className="cc-btn cc-btn-primary cc-press" disabled={busy || !api} aria-busy={busy}>
              {busy ? "Sending…" : "Send sign-in link"}
            </button>
          </div>
          <p className="mt-4 text-footnote text-text-muted">
            New here? The same link creates your account. By continuing you agree to the <a className="cc-link" href="#/terms">counselor terms</a>.
          </p>
        </form>
      )}
    </div>
  );
}

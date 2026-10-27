/**
 * Counselor portal shell: header, hash routes, auth session. The landing page (`#/`) and terms are
 * public; profile/billing need a session; admin needs `is_admin()`.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { IconCompass } from "@/components/icons";
import type { PortalApi, Session } from "./api";
import { createLivePortalApi } from "./client";
import { go, usePortalRoute, type PortalPath } from "./router";
import { Landing } from "./screens/Landing";
import { SignIn } from "./screens/SignIn";
import { Profile } from "./screens/Profile";
import { Billing } from "./screens/Billing";
import { Admin } from "./screens/Admin";
import { Terms } from "./screens/Terms";
import { OPERATOR, PRIVACY_URL, SUPPORT_EMAIL } from "./constants";

interface PortalCtx {
  api: PortalApi | null;
  session: Session | null | undefined; // undefined = still loading
  admin: boolean;
  refreshSession: () => void;
}
const Ctx = createContext<PortalCtx | null>(null);
export function usePortal(): PortalCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePortal outside Portal");
  return c;
}

export function Portal({ api: apiProp }: { /** Tests inject a fake API. */ api?: PortalApi | null }) {
  const api = useMemo(() => (apiProp !== undefined ? apiProp : createLivePortalApi()), [apiProp]);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [admin, setAdmin] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!api) {
      setSession(null);
      return;
    }
    let alive = true;
    api
      .session()
      .then((s) => alive && setSession(s))
      .catch(() => alive && setSession(null));
    const off = api.onAuthChange((s) => alive && setSession(s));
    return () => {
      alive = false;
      off();
    };
  }, [api, tick]);

  useEffect(() => {
    if (!api || !session) {
      setAdmin(false);
      return;
    }
    let alive = true;
    api.isAdmin().then((v) => alive && setAdmin(v)).catch(() => alive && setAdmin(false));
    return () => {
      alive = false;
    };
  }, [api, session]);

  const ctx: PortalCtx = { api, session, admin, refreshSession: () => setTick((n) => n + 1) };
  return (
    <Ctx.Provider value={ctx}>
      <Shell />
    </Ctx.Provider>
  );
}

function Shell() {
  const route = usePortalRoute();
  const { api, session, admin } = usePortal();
  const path = route.path;

  // Signed-in counselors land on their profile, not the marketing page.
  useEffect(() => {
    if (session && (path === "/signin")) go("/profile", { replace: true });
  }, [session, path]);

  const needsAuth = path === "/profile" || path === "/billing" || path === "/admin";
  let body: ReactNode;
  if (path === "/") body = <Landing />;
  else if (path === "/terms") body = <Terms />;
  else if (path === "/signin") body = <SignIn />;
  else if (needsAuth && session === undefined) body = <p className="cp-narrow py-16 text-center text-subhead text-text-muted">Loading…</p>;
  else if (needsAuth && !session) body = <SignIn reason={path} />;
  else if (path === "/profile") body = <Profile />;
  else if (path === "/billing") body = <Billing />;
  else if (path === "/admin") body = admin ? <Admin /> : <NotAdmin />;

  return (
    <>
      <header className="cp-header">
        <div className="cp-header-inner">
          <a href="#/" className="flex items-center gap-2 text-headline no-underline text-text" aria-label="Tierwise for Counselors — home">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-accent-contrast">
              <IconCompass size={18} />
            </span>
            <span className="whitespace-nowrap">
              Tierwise <span className="cp-brand-sub font-normal text-text-muted">for Counselors</span>
            </span>
          </a>
          <nav className="cp-nav" aria-label="Portal">
            {session ? (
              <>
                <NavLink to="/profile" current={path}>Profile</NavLink>
                <NavLink to="/billing" current={path}>Billing</NavLink>
                {admin && <NavLink to="/admin" current={path}>Admin</NavLink>}
                <button type="button" onClick={() => void api?.signOut().then(() => go("/"))}>Sign out</button>
              </>
            ) : (
              <>
                <a href="#/#pricing" onClick={(e) => { e.preventDefault(); go("/"); setTimeout(() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" }), 50); }}>Pricing</a>
                <NavLink to="/terms" current={path}>Terms</NavLink>
                <NavLink to="/signin" current={path}>Sign in</NavLink>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="cp-page">
        {!api && <p className="mt-6 rounded-control bg-surface-2 px-4 py-3 text-center text-subhead text-text-muted">The portal isn't connected to a database in this build.</p>}
        {body}
      </main>
      <footer className="cp-page">
        <div className="cp-footer">
          <span>© {new Date().getFullYear()} {OPERATOR} · Tierwise</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <a href="#/terms">Counselor terms</a>
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">Privacy</a>
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </span>
        </div>
      </footer>
    </>
  );
}

function NavLink({ to, current, children }: { to: PortalPath; current: string; children: ReactNode }) {
  return (
    <a href={`#${to}`} aria-current={current === to ? "page" : undefined}>
      {children}
    </a>
  );
}

function NotAdmin() {
  return (
    <div className="cp-narrow py-16 text-center">
      <h1 className="cp-h2">Admin only</h1>
      <p className="text-subhead text-text-muted">This page is for the Tierwise team.</p>
    </div>
  );
}

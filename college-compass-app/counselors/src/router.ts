/** Portal hash routes: `#/`, `#/signin`, `#/profile`, `#/billing?checkout=success`, `#/admin`, `#/terms`. */
import { useSyncExternalStore } from "react";
import { parseHash } from "@/lib/router";

export type PortalPath = "/" | "/signin" | "/profile" | "/billing" | "/admin" | "/terms";
export interface PortalRoute {
  path: PortalPath;
  query: Record<string, string>;
}

const KNOWN: PortalPath[] = ["/", "/signin", "/profile", "/billing", "/admin", "/terms"];

export function parsePortalRoute(hash: string): PortalRoute {
  const { path, query } = parseHash(hash);
  return { path: (KNOWN as string[]).includes(path) ? (path as PortalPath) : "/", query };
}

let cachedHash: string | null = null;
let cached: PortalRoute = parsePortalRoute("");
function snapshot(): PortalRoute {
  const h = typeof window === "undefined" ? "" : window.location.hash;
  if (h !== cachedHash) {
    cachedHash = h;
    cached = parsePortalRoute(h);
  }
  return cached;
}
function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
export function usePortalRoute(): PortalRoute {
  return useSyncExternalStore(subscribe, snapshot, () => parsePortalRoute(""));
}

export function go(path: PortalPath, opts: { replace?: boolean } = {}) {
  const target = "#" + path;
  if (opts.replace) {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else window.location.hash = target;
  window.scrollTo?.({ top: 0 });
}

/** Absolute URL of the portal page (without hash) — Supabase redirects the magic link here. */
export function portalUrl(): string {
  return window.location.origin + window.location.pathname;
}

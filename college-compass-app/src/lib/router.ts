/** Minimal hash router (GitHub Pages friendly). URLs look like `#/college/123?tab=odds`. */
import { useSyncExternalStore } from "react";

export interface Route {
  /** Normalized path, always starting with "/" and without trailing slash (except root). */
  path: string;
  /** Params from the matched pattern, e.g. { id: "123" } for "/college/:id". */
  params: Record<string, string>;
  query: Record<string, string>;
  /** The pattern that matched, or null if none did. */
  pattern: RoutePattern | null;
}

export const ROUTE_PATTERNS = [
  "/",
  "/onboarding/:step",
  "/list",
  "/college/:id",
  "/shortlist",
  "/deadlines",
  "/ask",
  "/settings",
  "/counselors",
  "/research",
  "/auth/callback",
] as const;
export type RoutePattern = (typeof ROUTE_PATTERNS)[number];

export function parseHash(hash: string): { path: string; query: Record<string, string> } {
  let h = hash.startsWith("#") ? hash.slice(1) : hash;
  const qi = h.indexOf("?");
  const qs = qi >= 0 ? h.slice(qi + 1) : "";
  if (qi >= 0) h = h.slice(0, qi);
  if (!h.startsWith("/")) h = "/" + h;
  if (h.length > 1) h = h.replace(/\/+$/, "") || "/";
  const query: Record<string, string> = {};
  new URLSearchParams(qs).forEach((v, k) => {
    query[k] = v;
  });
  return { path: h, query };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function matchRoute(path: string): { pattern: RoutePattern; params: Record<string, string> } | null {
  const segs = path.split("/").filter(Boolean);
  for (const pattern of ROUTE_PATTERNS) {
    const pSegs = pattern.split("/").filter(Boolean);
    if (pSegs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pSegs.length; i++) {
      const p = pSegs[i];
      if (p.startsWith(":")) params[p.slice(1)] = safeDecode(segs[i]);
      else if (p !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { pattern, params };
  }
  return null;
}

export function parseRoute(hash: string): Route {
  const { path, query } = parseHash(hash);
  const m = matchRoute(path);
  return { path, query, params: m?.params ?? {}, pattern: m?.pattern ?? null };
}

// useSyncExternalStore needs a referentially stable snapshot; cache by raw hash.
let cachedHash: string | null = null;
let cachedRoute: Route = parseRoute("");

function getSnapshot(): Route {
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedRoute = parseRoute(hash);
  }
  return cachedRoute;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, () => parseRoute(""));
}

export function buildHref(path: string, query?: Record<string, string | number | boolean | null | undefined>): string {
  let p = path.startsWith("/") ? path : "/" + path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v != null) qs.set(k, String(v));
    const s = qs.toString();
    if (s) p += (p.includes("?") ? "&" : "?") + s;
  }
  return "#" + p;
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const target = path.startsWith("#") ? path : "#" + (path.startsWith("/") ? path : "/" + path);
  if (opts.replace) {
    // replaceState doesn't fire hashchange, so dispatch it ourselves.
    const url = window.location.pathname + window.location.search + target;
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = target;
  }
}

/** Go back one entry; if there is no in-app history, fall back to `fallback` (default "/"). */
export function back(fallback = "/"): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback, { replace: true });
}

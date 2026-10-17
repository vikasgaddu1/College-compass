/**
 * Platform seam between the web/PWA build and the native iOS (Capacitor) build.
 * [native] owner implements the Capacitor branches; everyone else imports only from here.
 * Web implementations below are complete and are the fallback on every platform.
 *
 * `@capacitor/core` is tiny and node-safe, so it is imported statically. The Capacitor
 * *plugins* (`@capacitor/app`, `@capacitor/browser`) are dynamically imported on first
 * native use so the web bundle stays light and node-based tests never load them.
 */
import { Capacitor, CapacitorHttp, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/** Custom URL scheme used by the native app (registered in ios/App/App/Info.plist). */
export const NATIVE_SCHEME = "collegecompass";

/** Native redirect prefix the HTTPS callback page forwards to. */
export const NATIVE_AUTH_CALLBACK = `${NATIVE_SCHEME}://auth/callback`;

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * True when `url` is the native auth redirect (`collegecompass://auth/callback` optionally
 * followed by `?query` or `#fragment`). Scheme/host are matched case-insensitively.
 */
export function isAuthCallbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^collegecompass:\/\/auth\/callback\/?(?:[?#].*)?$/i.test(url.trim());
}

/** Query parameters of a native auth redirect, or null when `url` is not one. */
export function parseAuthCallback(url: string | null | undefined): URLSearchParams | null {
  if (!isAuthCallbackUrl(url)) return null;
  const raw = url!.trim();
  const q = raw.indexOf("?");
  if (q < 0) return new URLSearchParams();
  const hash = raw.indexOf("#", q);
  return new URLSearchParams(raw.slice(q + 1, hash < 0 ? undefined : hash));
}

/** Open the ChatGPT authorize URL. Web: full-page redirect. Native: in-app browser. */
export async function openAuthUrl(url: string): Promise<void> {
  if (isNative()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url, presentationStyle: "popover" });
    return;
  }
  window.location.assign(url);
}

/**
 * Native only: subscribe to `collegecompass://auth/callback?...` redirects.
 * The callback receives the query string (URLSearchParams). Web: no-op.
 * Also delivers the redirect that cold-started the app (`App.getLaunchUrl()`).
 */
export function onAuthRedirect(cb: (query: URLSearchParams) => void): () => void {
  if (!isNative()) return () => {};
  let disposed = false;
  let remove: (() => void) | null = null;

  const deliver = (url: string | null | undefined) => {
    const q = parseAuthCallback(url);
    if (q && !disposed) cb(q);
  };

  void (async () => {
    try {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appUrlOpen", (e) => deliver(e.url));
      if (disposed) {
        void handle.remove();
        return;
      }
      remove = () => void handle.remove();
      const launch = await App.getLaunchUrl();
      deliver(launch?.url);
    } catch {
      /* plugin unavailable: sign-in simply never completes via redirect */
    }
  })();

  return () => {
    disposed = true;
    remove?.();
    remove = null;
  };
}

/** Close the in-app browser after sign-in (native). Web: no-op. */
export async function closeAuthBrowser(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch {
    /* already closed / not open */
  }
}

/**
 * POST an application/x-www-form-urlencoded body and return parsed JSON.
 * Web: fetch (subject to CORS). Native: CapacitorHttp (no CORS).
 */
export async function postForm(url: string, body: URLSearchParams): Promise<{ status: number; json: any }> {
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (isNative()) {
    // iOS passes a string body through unchanged (a plain object would be re-encoded).
    const res = await CapacitorHttp.post({ url, headers, data: body.toString() });
    let json: any = res.data;
    if (typeof json === "string") {
      try { json = JSON.parse(json); } catch { json = null; }
    }
    return { status: res.status, json: json ?? null };
  }
  const res = await fetch(url, { method: "POST", headers, body: body.toString() });
  let json: any = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

/** The HTTPS redirect URI registered with OpenAI (same for web and native). */
export function redirectUri(): string {
  const base = (import.meta as any).env?.BASE_URL ?? "/College-compass/app/";
  if (isNative()) return "https://vikasgaddu1.github.io/College-compass/app/callback.html";
  return `${window.location.origin}${base}callback.html`;
}

// ───────────────────────────── self-serve sign-in (loopback redirect) ─────────────────────────────
//
// OpenAI's self-serve Sign in with ChatGPT path for open-source, locally run apps redirects to an
// HTTP loopback listener on 127.0.0.1 (only the port may vary; never `localhost`). The native app
// runs that listener with the in-app `LoopbackAuth` Capacitor plugin
// (ios/App/App/LoopbackAuthPlugin.swift); the web build has no way to listen, so it keeps the
// partner client-ID path.

export const LOOPBACK_HOST = "127.0.0.1";
export const LOOPBACK_PATH = "/auth/callback";
/** Port used for the first registration; later sign-ins fall back to any free port. */
export const LOOPBACK_PREFERRED_PORT = 1455;

/** `http://127.0.0.1:<port>/auth/callback` — scheme, host and path never change. */
export function loopbackRedirectUri(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError(`Invalid loopback port: ${port}`);
  return `http://${LOOPBACK_HOST}:${port}${LOOPBACK_PATH}`;
}

/**
 * Query of a loopback callback URL (`http://127.0.0.1:<port>/auth/callback?...`), or null when `url`
 * is anything else. When `port` is given, the URL must use exactly that port.
 */
export function parseLoopbackCallback(url: string | null | undefined, port?: number): URLSearchParams | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" || u.hostname !== LOOPBACK_HOST || u.pathname !== LOOPBACK_PATH) return null;
  if (u.username || u.password) return null;
  if (port != null && u.port !== String(port)) return null;
  return new URLSearchParams(u.search);
}

/** True when this build can run the self-serve (loopback) sign-in: the native iOS app. */
export function supportsSelfServeSignIn(): boolean {
  return isNative();
}

export interface LoopbackSession {
  /** The exact redirect_uri to send to authorize and to the token exchange. */
  redirectUri: string;
  /** Stop listening (idempotent). */
  stop(): Promise<void>;
  /** Resolves with the query of the first callback request (buffered if it already arrived). */
  next(): Promise<URLSearchParams>;
}

/** JS face of the native `LoopbackAuth` plugin. */
export interface LoopbackAuthPlugin {
  start(opts: { preferredPort?: number }): Promise<{ port: number }>;
  stop(): Promise<void>;
  addListener(event: "callback", fn: (e: { url: string }) => void): Promise<PluginListenerHandle>;
}

let loopbackPlugin: LoopbackAuthPlugin | null = null;
function getLoopbackPlugin(): LoopbackAuthPlugin {
  // Registered lazily so the web bundle / node tests never create the proxy.
  loopbackPlugin ??= registerPlugin<LoopbackAuthPlugin>("LoopbackAuth");
  return loopbackPlugin;
}

/**
 * Start a loopback listener through `plugin` and wrap it as a LoopbackSession. The event listener is
 * attached BEFORE the server starts so no callback can be missed. Exported for tests.
 */
export async function createLoopbackSession(
  plugin: LoopbackAuthPlugin,
  preferredPort: number = LOOPBACK_PREFERRED_PORT,
): Promise<LoopbackSession> {
  let port: number | null = null;
  let first: URLSearchParams | null = null;
  let early: string[] = [];
  const waiters: ((q: URLSearchParams) => void)[] = [];
  let stopped = false;

  const accept = (url: string) => {
    if (first || stopped) return;
    const q = parseLoopbackCallback(url, port ?? undefined);
    if (!q) return;
    first = q;
    for (const w of waiters.splice(0)) w(q);
  };

  const handle = await plugin.addListener("callback", (e) => {
    const url = typeof e?.url === "string" ? e.url : "";
    if (port == null) early.push(url); // callback raced the start() reply; checked once the port is known
    else accept(url);
  });

  let started: { port: number };
  try {
    started = await plugin.start({ preferredPort });
  } catch (e) {
    await handle.remove().catch(() => {});
    throw e;
  }
  if (!Number.isInteger(started?.port) || started.port < 1 || started.port > 65535) {
    await handle.remove().catch(() => {});
    await plugin.stop().catch(() => {});
    throw new Error("The sign-in listener didn't report a valid port.");
  }
  port = started.port;
  for (const url of early) accept(url);
  early = [];

  return {
    redirectUri: loopbackRedirectUri(port),
    async stop() {
      if (stopped) return;
      stopped = true;
      await handle.remove().catch(() => {});
      await plugin.stop().catch(() => {});
    },
    next() {
      if (first) return Promise.resolve(first);
      return new Promise<URLSearchParams>((resolve) => waiters.push(resolve));
    },
  };
}

/**
 * Native only: start the 127.0.0.1 loopback listener for self-serve sign-in. Call this BEFORE opening
 * the authorize URL. Throws on web.
 */
export async function startLoopback(): Promise<LoopbackSession> {
  if (!isNative()) throw new Error("Loopback sign-in is only available in the native app.");
  return createLoopbackSession(getLoopbackPlugin());
}

/**
 * Native only: called when the user closes the in-app browser themselves (Done / swipe down).
 * Web: no-op. Returns a disposer.
 */
export function onAuthBrowserFinished(cb: () => void): () => void {
  if (!isNative()) return () => {};
  let disposed = false;
  let remove: (() => void) | null = null;
  void (async () => {
    try {
      const { Browser } = await import("@capacitor/browser");
      const handle = await Browser.addListener("browserFinished", () => {
        if (!disposed) cb();
      });
      if (disposed) void handle.remove();
      else remove = () => void handle.remove();
    } catch {
      /* plugin unavailable */
    }
  })();
  return () => {
    disposed = true;
    remove?.();
    remove = null;
  };
}

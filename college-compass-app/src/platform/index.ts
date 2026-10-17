/**
 * Platform seam between the web/PWA build and the native iOS (Capacitor) build.
 * [native] owner implements the Capacitor branches; everyone else imports only from here.
 * Web implementations below are complete and are the fallback on every platform.
 *
 * `@capacitor/core` is tiny and node-safe, so it is imported statically. The Capacitor
 * *plugins* (`@capacitor/app`, `@capacitor/browser`) are dynamically imported on first
 * native use so the web bundle stays light and node-based tests never load them.
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";

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

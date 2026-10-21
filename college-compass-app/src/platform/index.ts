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

/**
 * `fetch` that works against api.openai.com from the app.
 *
 * api.openai.com does not send CORS headers for authenticated requests, so a WebView `fetch` from
 * `capacitor://localhost` (or any web origin) fails before the request is answered. In the native
 * app, requests therefore go through the in-app `NativeHttp` plugin (URLSession, no CORS;
 * ios/App/App/NativeHttpPlugin.swift). Aborting the signal cancels the URLSession task, which
 * closes the connection so OpenAI stops generating. The body is returned whole as a standard
 * `Response`, so streaming (SSE) responses still parse — they just arrive at once. Web: `fetch`.
 */
export async function httpFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!isNative()) return globalThis.fetch(input, init);
  return nativeFetch(input, init, getNativeHttpPlugin());
}

/** JS face of the native `NativeHttp` plugin. */
export interface NativeHttpPlugin {
  request(opts: {
    id: string;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    background?: boolean;
    /** Research tracking label (see beginResearchRun). */
    tag?: string;
  }): Promise<{ status: number; headers?: Record<string, string>; data?: string }>;
  cancel(opts: { id: string }): Promise<void>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  notifyWhenDone(opts: { title: string; body: string }): Promise<void>;
  cancelNotify(): Promise<void>;
  beginRun(opts: { runId: string; expected: number }): Promise<void>;
  endRun(opts: { runId: string }): Promise<void>;
  takeOrphans(): Promise<{ orphans: { tag: string; data: string }[] }>;
}

let nativeHttpPlugin: NativeHttpPlugin | null = null;
function getNativeHttpPlugin(): NativeHttpPlugin {
  nativeHttpPlugin ??= registerPlugin<NativeHttpPlugin>("NativeHttp");
  return nativeHttpPlugin;
}

let requestSeq = 0;
function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/** Exported for tests: the NativeHttp-backed implementation of `httpFetch`. */
export async function nativeFetch(input: RequestInfo | URL, init: RequestInit, http: NativeHttpPlugin): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {};
  new Headers(init.headers ?? {}).forEach((v, k) => { headers[k] = v; });
  const signal = init.signal ?? undefined;
  if (signal?.aborted) throw abortError();

  const id = `r${Date.now().toString(36)}-${++requestSeq}`;
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    onAbort = () => {
      // Cancel the URLSession task too, not just this promise.
      void http.cancel({ id }).catch(() => {});
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

  let res: { status: number; headers?: Record<string, string>; data?: string };
  try {
    const req = http.request({
      id,
      url,
      method,
      headers,
      body: init.body == null ? undefined : String(init.body),
      // Research calls with web search can take a few minutes.
      timeoutMs: 300_000,
      // AI requests (research agents, chat) go through iOS's background session so they keep running
      // when the student leaves the app.
      background: method === "POST" && /\/v1\/responses$/.test(url),
      tag: typeof (init as { ccTag?: unknown }).ccTag === "string" ? (init as { ccTag: string }).ccTag : undefined,
    });
    res = await (signal ? Promise.race([req, aborted]) : req);
  } catch (e) {
    if (signal?.aborted || (e as { code?: string })?.code === "ABORTED") throw abortError();
    throw new TypeError("Network request failed");
  } finally {
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }

  const outHeaders = new Headers();
  for (const [k, v] of Object.entries(res.headers ?? {})) {
    try { outHeaders.set(k, String(v)); } catch { /* skip invalid header names */ }
  }
  const body = typeof res.data === "string" ? res.data : "";
  return new Response(res.status === 204 || res.status === 304 ? null : body, { status: res.status, headers: outHeaders });
}

// ───────────────────────────── "you can leave the app" notifications ─────────────────────────────

/** True when research keeps running after the student leaves the app and we can notify them (iOS app). */
export function supportsLeaveAndNotify(): boolean {
  return isNative();
}

/** Ask iOS for permission to show "your list is ready". Resolves false on web or when declined. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    return (await getNativeHttpPlugin().requestNotificationPermission()).granted === true;
  } catch {
    return false;
  }
}

/**
 * Arm a local notification for when the in-flight AI requests finish while the app is in the
 * background. Posted at most once; never shown while the app is open. No-op on web.
 */
export async function notifyWhenResearchDone(title: string, body: string): Promise<void> {
  if (!isNative()) return;
  try { await getNativeHttpPlugin().notifyWhenDone({ title, body }); } catch { /* best-effort */ }
}

/**
 * Tell iOS how many research requests this run will make, so "your list is ready" is only posted
 * when all of them have finished — not when just the first wave did (the rest are started by
 * JavaScript, which is suspended in the background; then iOS posts "open the app to finish").
 * Requests carry the tag `research:<runId>:…`. No-op on web.
 */
export async function beginResearchRun(runId: string, expected: number): Promise<void> {
  if (!isNative()) return;
  try { await getNativeHttpPlugin().beginRun({ runId, expected }); } catch { /* best-effort */ }
}

export async function endResearchRun(runId: string): Promise<void> {
  if (!isNative()) return;
  try { await getNativeHttpPlugin().endRun({ runId }); } catch { /* best-effort */ }
}

/**
 * Research responses iOS delivered after it had terminated the suspended app (no JavaScript caller
 * left), saved on disk by the native side. Each is returned once. Empty on web.
 */
export async function takeOrphanedResearch(): Promise<{ tag: string; data: string }[]> {
  if (!isNative()) return [];
  try { return (await getNativeHttpPlugin().takeOrphans()).orphans ?? []; } catch { return []; }
}

/** Disarm the notification (research finished or was cancelled while the app was open). */
export async function cancelResearchNotification(): Promise<void> {
  if (!isNative()) return;
  try { await getNativeHttpPlugin().cancelNotify(); } catch { /* best-effort */ }
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

// ───────────────────────────── Share my list as a PDF ─────────────────────────────
//
// The report HTML (src/share/report.ts) is turned into a PDF natively by the in-app `SharePdf`
// Capacitor plugin (ios/App/App/SharePdfPlugin.swift: UIMarkupTextPrintFormatter → paginated US
// Letter PDF → UIActivityViewController, so Mail, Messages, WhatsApp, AirDrop and Save to Files
// all work and nothing is uploaded anywhere). On the web the browser's print dialog offers
// "Save as PDF" instead.

/** JS face of the native `SharePdf` plugin. */
export interface SharePdfPlugin {
  /** Render `html` to a PDF named `fileName` and present the iOS share sheet. */
  share(opts: { html: string; fileName: string }): Promise<{ completed: boolean; activity?: string | null }>;
  /** Render only (tests / diagnostics): page count and PDF size in bytes. */
  render(opts: { html: string }): Promise<{ pages: number; bytes: number }>;
}

let sharePdfPlugin: SharePdfPlugin | null = null;
function getSharePdfPlugin(): SharePdfPlugin {
  sharePdfPlugin ??= registerPlugin<SharePdfPlugin>("SharePdf");
  return sharePdfPlugin;
}

export interface SharePdfResult {
  /** True when the student picked an app / saved the file; false when they cancelled the share sheet. */
  completed: boolean;
}

/**
 * Share a print-ready HTML document as a PDF.
 * Native: the `SharePdf` plugin (rejects with a readable message when rendering fails).
 * Web: the document is loaded into a hidden iframe and printed, so the browser offers "Save as PDF";
 * resolves `completed: true` once the print dialog has been shown. Never throws off-device
 * (node / jsdom): resolves `completed: false`.
 */
export async function sharePdf(html: string, fileName: string): Promise<SharePdfResult> {
  if (isNative()) {
    const res = await getSharePdfPlugin().share({ html, fileName });
    return { completed: res?.completed === true };
  }
  return webPrintHtml(html, fileName);
}

/** Exported for tests: the web fallback of `sharePdf`. */
export async function webPrintHtml(html: string, fileName: string): Promise<SharePdfResult> {
  if (typeof document === "undefined" || !document.body) return { completed: false };
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("title", "Print preview");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(frame);
  const cleanup = () => {
    try { frame.remove(); } catch { /* already gone */ }
  };
  try {
    const win = frame.contentWindow;
    const doc = frame.contentDocument ?? win?.document;
    if (!win || !doc) return { completed: false };
    doc.open();
    doc.write(html);
    doc.close();
    // Browsers name the saved PDF after the document title.
    try { doc.title = fileName.replace(/\.pdf$/i, ""); } catch { /* ignore */ }
    if (typeof win.print !== "function") return { completed: false };
    // Give the frame a tick to lay out, then print (blocks until the dialog closes in most browsers).
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    let printed = false;
    try {
      win.focus();
      win.print();
      printed = true;
    } catch {
      printed = false;
    }
    return { completed: printed };
  } finally {
    // Keep the frame alive briefly: some browsers print asynchronously after print() returns.
    setTimeout(cleanup, 5_000);
  }
}

// ───────────────────────────── Deadline reminders + Add to Calendar ─────────────────────────────
//
// Application-deadline reminders are local notifications scheduled by the in-app `DeadlineReminders`
// Capacitor plugin (ios/App/App/DeadlineRemindersPlugin.swift) with calendar triggers, identified by
// a common prefix so re-scheduling is idempotent (remove the prefix, add the new set). The same plugin
// shares an .ics file through the share sheet ("Add to Calendar"). Web: no notifications; the .ics is
// downloaded (or shared through the Web Share API where files are supported).

/** One scheduled reminder, as the native side takes it. */
export interface NativeReminder {
  id: string;
  title: string;
  body: string;
  /** Epoch milliseconds, local 9:00 on the lead day. */
  fireAt: number;
}

/** JS face of the native `DeadlineReminders` plugin. */
export interface DeadlineRemindersPlugin {
  /** Remove pending requests whose identifier starts with `prefix`, then add `reminders`. */
  schedule(opts: { prefix: string; reminders: NativeReminder[] }): Promise<{ scheduled: number }>;
  clear(opts: { prefix: string }): Promise<{ removed: number }>;
  pending(opts: { prefix: string }): Promise<{ ids: string[] }>;
  /** Write `ics` to a temporary file named `fileName` and present the share sheet. */
  shareCalendar(opts: { ics: string; fileName: string }): Promise<{ completed: boolean }>;
}

let deadlineRemindersPlugin: DeadlineRemindersPlugin | null = null;
function getDeadlineRemindersPlugin(): DeadlineRemindersPlugin {
  deadlineRemindersPlugin ??= registerPlugin<DeadlineRemindersPlugin>("DeadlineReminders");
  return deadlineRemindersPlugin;
}

/** True when deadline reminders can be scheduled (the iPhone app). */
export function supportsDeadlineReminders(): boolean {
  return isNative();
}

/**
 * Replace every pending deadline reminder with `prefix` by `reminders`. Resolves the number scheduled;
 * 0 on web or when the plugin is unavailable. Never throws.
 */
export async function scheduleDeadlineReminders(prefix: string, reminders: NativeReminder[]): Promise<number> {
  if (!isNative()) return 0;
  try {
    const res = await getDeadlineRemindersPlugin().schedule({ prefix, reminders });
    return typeof res?.scheduled === "number" ? res.scheduled : reminders.length;
  } catch {
    return 0;
  }
}

/** Remove every pending deadline reminder with `prefix`. No-op on web. */
export async function clearDeadlineReminders(prefix: string): Promise<void> {
  if (!isNative()) return;
  try { await getDeadlineRemindersPlugin().clear({ prefix }); } catch { /* best-effort */ }
}

/** Identifiers of the pending deadline reminders with `prefix` (diagnostics). Empty on web. */
export async function pendingDeadlineReminders(prefix: string): Promise<string[]> {
  if (!isNative()) return [];
  try { return (await getDeadlineRemindersPlugin().pending({ prefix })).ids ?? []; } catch { return []; }
}

/**
 * Hand an .ics calendar file to the student. Native: the share sheet (Calendar, Mail, Files…).
 * Web: the Web Share API with files when available, otherwise a download. Resolves `completed: false`
 * when the share sheet was cancelled or nothing could be offered (node / jsdom).
 */
export async function shareCalendarFile(ics: string, fileName: string): Promise<{ completed: boolean }> {
  if (isNative()) {
    try {
      const res = await getDeadlineRemindersPlugin().shareCalendar({ ics, fileName });
      return { completed: res?.completed === true };
    } catch {
      return { completed: false };
    }
  }
  return webDownloadText(ics, fileName, "text/calendar;charset=utf-8");
}

/** Exported for tests: the web fallback of `shareCalendarFile`. */
export async function webDownloadText(text: string, fileName: string, type: string): Promise<{ completed: boolean }> {
  if (typeof document === "undefined" || !document.body || typeof URL.createObjectURL !== "function") return { completed: false };
  const blob = new Blob([text], { type });
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (typeof File === "function" && nav.share && nav.canShare) {
      const file = new File([blob], fileName, { type });
      if (nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: fileName });
          return { completed: true };
        } catch {
          return { completed: false }; // cancelled
        }
      }
    }
  } catch {
    /* fall through to a download */
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }, 1_000);
  return { completed: true };
}

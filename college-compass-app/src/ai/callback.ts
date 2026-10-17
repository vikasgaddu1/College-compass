/**
 * Routing logic of public/callback.html, as a pure function (the HTML inlines an identical copy;
 * callback.test.ts checks they agree).
 *
 * The OAuth redirect URI is one HTTPS page for both builds. If `state` ends with ".n" the sign-in
 * started in the native app → forward to the custom scheme; otherwise hand the query to the SPA's
 * hash route. The query (code, state, error…) is passed through untouched.
 */
export const NATIVE_CALLBACK = "collegecompass://auth/callback";
export const WEB_CALLBACK = "./#/auth/callback";

export function callbackTarget(search: string): string {
  var s = search || "";
  if (s && s.charAt(0) !== "?") s = "?" + s;
  var state = new URLSearchParams(s).get("state") || "";
  var native = state.slice(-2) === ".n";
  return (native ? NATIVE_CALLBACK : WEB_CALLBACK) + s;
}

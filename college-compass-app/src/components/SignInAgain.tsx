/**
 * "Your ChatGPT session ended" card — the one place the app sends a student whose session expired
 * (or who was never signed in). It starts sign-in itself, so there is always a button to tap.
 *
 * `auth.signIn(returnTo)`:
 *  - web: full-page redirect to ChatGPT; the callback route navigates to `returnTo`.
 *  - iPhone: opens the in-app browser, completes sign-in on the loopback callback and then navigates
 *    to `returnTo` (self-serve resolves only when the whole flow is done; the partner flow resolves
 *    once the browser is open and finishes through the redirect listener).
 */
import { useEffect, useState } from "react";
import { auth, describeError } from "@/state/services";
import { isNative } from "@/platform";
import { Banner, Button } from "./ui";
import { IconChat } from "./icons";

export type SignInReason = "expired" | "signed_out";

export interface SignInAgainProps {
  /** Route to come back to after sign-in, e.g. "/research". */
  returnTo: string;
  /** "expired" (default): the session ended. "signed_out": the student was never signed in. */
  reason?: SignInReason;
  /** Replaces the one-line explanation. */
  line?: string;
  className?: string;
}

export const SIGN_IN_COPY = {
  expired: {
    title: "Your ChatGPT session ended",
    line: "Sign in again to keep researching — your answers and colleges are saved on this phone.",
  },
  signed_out: {
    title: "Sign in with ChatGPT",
    line: "Sign in to research colleges and ask questions — your answers and colleges are saved on this phone.",
  },
} as const;

export function SignInAgain({ returnTo, reason = "expired", line, className = "" }: SignInAgainProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const configured = auth.configured();
  const copy = SIGN_IN_COPY[reason];

  // iPhone partner flow: sign-in finishes (or fails) after `signIn()` resolved, through the redirect
  // listener — pick up a failure from there so the student can retry. Success unmounts this card.
  useEffect(
    () =>
      auth.subscribe(() => {
        const e = auth.lastError?.();
        if (e) {
          setErr(e);
          setBusy(false);
        }
      }),
    [],
  );

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await auth.signIn(returnTo);
      // Web: the page is leaving for ChatGPT, so keep the button busy. iPhone: the in-app browser is
      // up — let the button rest so a cancelled sign-in can be retried.
      if (isNative()) setBusy(false);
    } catch (e) {
      setErr(describeError(e).detail);
      setBusy(false);
    }
  };

  return (
    <section className={`cc-card p-4 ${className}`} aria-label={copy.title} data-testid="sign-in-again">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-contrast" aria-hidden>
          <IconChat size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-headline">{copy.title}</h3>
          <p className="mt-1 text-subhead text-text-muted">{line ?? copy.line}</p>
        </div>
      </div>
      {err && (
        <div className="mt-3" role="alert">
          <Banner tone="error">{err}</Banner>
        </div>
      )}
      {!configured && (
        <div className="mt-3">
          <Banner>Continue with ChatGPT works in the College Compass iPhone app. On the web it is waiting on OpenAI approval for this site.</Banner>
        </div>
      )}
      <div className="mt-3">
        <Button onClick={() => void signIn()} disabled={busy || !configured} aria-busy={busy}>
          {busy ? (
            "Opening ChatGPT…"
          ) : (
            <>
              <IconChat size={22} />
              Continue with ChatGPT
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

/** True for the AiError codes that mean "the student needs to sign in", so screens can swap a banner for the card. */
export function needsSignIn(code: string | undefined | null): code is "reauth_required" | "not_connected" {
  return code === "reauth_required" || code === "not_connected";
}

/** Which card to show for an AiError code. */
export function reasonFor(code: "reauth_required" | "not_connected"): SignInReason {
  return code === "not_connected" ? "signed_out" : "expired";
}

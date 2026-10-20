import { useEffect, useState } from "react";
import { navigate, useRoute } from "@/lib/router";
import { auth, describeError } from "@/state/services";
import { useStore } from "@/state/store";
import { Banner, Button, Spinner } from "@/components/ui";

export function AuthCallback() {
  const route = useRoute();
  const { hasProfile, prefs, refreshAuth } = useStore();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(route.query);
    auth
      .completeSignIn(params)
      .then(() => {
        if (cancelled) return;
        refreshAuth();
        // Where sign-in was started from (e.g. "/research" from the session-ended card), else the usual landing.
        const returnTo = params.get("return_to") ?? auth.takeReturnTo?.() ?? null;
        navigate(returnTo && returnTo.startsWith("/") ? returnTo : hasProfile && prefs.onboardingDone ? "/list" : "/onboarding/1", { replace: true });
      })
      .catch((e) => {
        if (!cancelled) setErr(describeError(e).detail);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="cc-shell">
      <div className="cc-column flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        {err ? (
          <>
            <Banner tone="error">
              <strong>Sign-in didn't finish.</strong> {err}
            </Banner>
            <Button onClick={() => navigate("/", { replace: true })}>Back to start</Button>
          </>
        ) : (
          <>
            <Spinner />
            <p className="text-body">Finishing sign-in…</p>
          </>
        )}
      </div>
    </div>
  );
}

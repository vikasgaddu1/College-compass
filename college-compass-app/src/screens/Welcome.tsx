import { useState } from "react";
import { navigate } from "@/lib/router";
import { useStore } from "@/state/store";
import { auth, describeError } from "@/state/services";
import { IconChat, IconCompass, IconList, IconStar } from "@/components/icons";
import { Banner, Button } from "@/components/ui";

const POINTS = [
  { Icon: IconList, title: "A balanced list, built for you", text: "Reach, target and likely colleges for your grades, budget and interests, in any field." },
  { Icon: IconStar, title: "Honest odds, not hype", text: "Chances shown as a range, with the reasons, from each college's own published numbers." },
  { Icon: IconChat, title: "Ask anything", text: "Chat with ChatGPT about your list. It already knows your profile and every college on it." },
];

export function Welcome() {
  const { enterDemo, connected, hasProfile, prefs } = useStore();
  const configured = auth.configured();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setErr(null);
    try {
      await auth.signIn(hasProfile && prefs.onboardingDone ? "/list" : "/onboarding/1");
    } catch (e) {
      setErr(describeError(e).detail);
      setBusy(false);
    }
  };

  const continueExisting = () => navigate(prefs.onboardingDone ? "/list" : "/onboarding/1", { replace: true });

  return (
    <div className="cc-shell">
      <div className="cc-scroll">
        <div className="cc-column flex min-h-full flex-col pt-[calc(var(--sat)+28px)]">
          <div className="flex items-center gap-3">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-accent-contrast shadow-card">
              <IconCompass size={34} />
            </span>
            <div>
              <h1 className="text-title1">College Compass</h1>
              <p className="text-subhead text-text-muted">Find colleges that fit you</p>
            </div>
          </div>

          <ul className="mt-8 space-y-5">
            {POINTS.map(({ Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden>
                  <Icon size={20} />
                </span>
                <div>
                  <h2 className="text-headline">{title}</h2>
                  <p className="mt-0.5 text-subhead text-text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex-1" />

          <div className="cc-sticky-actions mt-6">
            {err && <Banner tone="error">{err}</Banner>}
            {!configured && (
              <Banner>ChatGPT sign-in is being enabled for this app. Until then, try the demo or use a developer key.</Banner>
            )}
            {connected && hasProfile ? (
              <Button onClick={continueExisting}>Continue</Button>
            ) : (
              <Button onClick={signIn} disabled={busy || !configured} aria-busy={busy}>
                <IconChat size={22} />
                Continue with ChatGPT
              </Button>
            )}
            {connected && !hasProfile && (
              <Button variant="secondary" onClick={() => navigate("/onboarding/1")}>
                Start the questions
              </Button>
            )}
            <p className="px-2 text-center text-footnote text-text-muted">Free with your ChatGPT plan. Your answers and results stay on this phone.</p>
            {!configured && (
              <div className="flex items-center justify-center gap-5 pt-1 text-subhead">
                <button
                  type="button"
                  className="cc-link min-h-tap"
                  onClick={() => {
                    enterDemo();
                    navigate("/list", { replace: true });
                  }}
                >
                  Try demo
                </button>
                <button type="button" className="cc-link min-h-tap" onClick={() => navigate("/settings?dev=1")}>
                  Developer mode
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

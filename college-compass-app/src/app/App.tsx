import { useEffect, useState } from "react";
import "@/styles/app.css";
import { navigate, useRoute } from "@/lib/router";
import { StoreProvider, useStore } from "@/state/store";
import { MANAGE_USAGE_URL } from "@/state/services";
import { TabBar, type TabId } from "@/components/TabBar";
import { Sheet } from "@/components/Sheet";
import { Button } from "@/components/ui";
import { Welcome } from "@/screens/Welcome";
import { AuthCallback } from "@/screens/AuthCallback";
import { Onboarding } from "@/screens/Onboarding";
import { Research } from "@/screens/Research";
import { List } from "@/screens/List";
import { CollegeDetail } from "@/screens/CollegeDetail";
import { Shortlist } from "@/screens/Shortlist";
import { Ask } from "@/screens/Ask";
import { Settings } from "@/screens/Settings";

export function App() {
  return (
    <StoreProvider>
      <Router />
      <PlanSheet />
    </StoreProvider>
  );
}

function useWide() {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

function Router() {
  const route = useRoute();
  const { connected, demo, hasProfile, prefs, enterDemo, shortlist } = useStore();
  const wide = useWide();

  // `#/?demo=1` loads the sample data (used by App Review and screenshots).
  useEffect(() => {
    if (route.query.demo === "1" && !demo) {
      enterDemo();
      navigate("/list", { replace: true });
    }
  }, [route.query.demo, demo, enterDemo]);

  const gated = connected || demo;
  const badges: Partial<Record<TabId, number>> = shortlist.length ? { shortlist: shortlist.length } : {};
  const tab = (id: TabId) => <TabBar active={id} badges={badges} />;

  const path = route.path;
  if (path === "/auth/callback") return <AuthCallback />;
  if (path === "/") {
    if (gated && hasProfile && prefs.onboardingDone && !route.query.demo) {
      navigate("/list", { replace: true });
      return null;
    }
    return <Welcome />;
  }
  if (route.pattern === "/onboarding/:step") return <Onboarding />;
  if (path === "/research") {
    // Signed out with answers saved: Research shows the sign-in card and resumes once signed in.
    if (!gated && !hasProfile) return <Welcome />;
    return <Research />;
  }
  if (path === "/list" || route.pattern === "/college/:id") {
    const id = route.params.id;
    if (wide) {
      return (
        <div className="cc-two-pane h-[100dvh]">
          <div className="min-h-0 border-r border-border">
            <List selectedId={id} tabBar={tab("list")} />
          </div>
          <div className="min-h-0">{id ? <CollegeDetail id={id} embedded /> : <WidePlaceholder />}</div>
        </div>
      );
    }
    if (id) return <CollegeDetail id={id} />;
    return <List tabBar={tab("list")} />;
  }
  if (path === "/shortlist") return <Shortlist tabBar={tab("shortlist")} />;
  if (path === "/ask") return <Ask tabBar={tab("ask")} />;
  if (path === "/settings") return <Settings tabBar={tab("settings")} />;
  navigate("/", { replace: true });
  return null;
}

function WidePlaceholder() {
  return (
    <div className="grid h-full place-items-center p-8 text-center text-subhead text-text-muted">
      <p>Choose a college from your list to see the details here.</p>
    </div>
  );
}

/** First sign-in: "You're using your ChatGPT plan" (shown once). */
function PlanSheet() {
  const { account, prefs, setPrefs } = useStore();
  const open = !!account && !prefs.seenPlanSheet;
  const close = () => setPrefs({ seenPlanSheet: true });
  return (
    <Sheet open={open} onClose={close} label="You're using your ChatGPT plan" right={<span />}>
      <div className="px-1 pb-2 pt-3">
        <h2 className="text-title2">You're using your ChatGPT plan</h2>
        <p className="mt-2 text-subhead text-text-muted">
          Research and chat in College Compass run on your own ChatGPT account, so they count toward your plan's usage limits. Nothing is billed by this app, and your answers and results stay on this phone.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={close}>Got it</Button>
          <a className="cc-btn cc-btn-quiet cc-press" href={MANAGE_USAGE_URL} target="_blank" rel="noopener noreferrer">
            Manage usage
          </a>
        </div>
      </div>
    </Sheet>
  );
}

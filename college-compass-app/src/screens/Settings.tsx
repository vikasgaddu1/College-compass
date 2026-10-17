import { useEffect, useRef, useState, type ReactNode } from "react";
import { navigate, useRoute } from "@/lib/router";
import { useStore } from "@/state/store";
import { MANAGE_USAGE_URL, auth, describeError, devKey as readDevKey, setDevApiKey, setPreferredModel } from "@/state/services";
import { TIERS, majorLabel, stateName } from "@/state/catalog";
import { Screen } from "@/components/Screen";
import { ConfirmSheet, Sheet } from "@/components/Sheet";
import { Banner, Button, Group, Row } from "@/components/ui";
import { IconCheck, IconChat, IconExternal, IconPerson } from "@/components/icons";

const APP_VERSION = "0.1.0";

export function Settings({ tabBar }: { tabBar?: ReactNode }) {
  const route = useRoute();
  const { account, connected, hasDevKey, demo, exitDemo, prefs, setPrefs, profile, hasProfile, resetAll, exportJson, importJson, refreshAuth, colleges } = useStore();
  const [devOpen, setDevOpen] = useState(() => route.query.dev === "1" || hasDevKey);
  const [taps, setTaps] = useState(0);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [models, setModels] = useState<{ slug: string; display_name: string }[] | null>(null);
  const [modelsErr, setModelsErr] = useState<string | null>(null);
  const [oddsOpen, setOddsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [devKey, setDevKeyText] = useState(() => readDevKey() ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!modelsOpen || models) return;
    auth
      .listModels()
      .then(setModels)
      .catch((e) => setModelsErr(describeError(e).detail));
  }, [modelsOpen, models]);

  const onVersionTap = () => {
    const n = taps + 1;
    setTaps(n);
    if (n >= 5) {
      setDevOpen(true);
      setToast("Developer section shown");
    }
  };

  const doExport = async () => {
    const json = exportJson();
    const file = new File([json], `college-compass-${new Date().toISOString().slice(0, 10)}.json`, { type: "application/json" });
    try {
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: "College Compass export" });
        return;
      }
    } catch {
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    const n = importJson(await f.text());
    setToast(n > 0 ? `Imported ${n} items` : "That file isn't a College Compass export");
    if (fileRef.current) fileRef.current.value = "";
  };

  const saveDevKey = () => {
    const k = devKey.trim();
    setDevApiKey(k || null);
    refreshAuth();
    setToast(k ? "Developer key saved" : "Developer key removed");
  };

  const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer");

  return (
    <Screen title="Settings" footer={tabBar}>
      {toast && (
        <p role="status" className="mb-2 rounded-control bg-accent-soft px-4 py-2 text-center text-subhead text-accent">
          {toast}
        </p>
      )}

      {/* Account */}
      <Group label="Account" foot={account ? "AI requests use your own ChatGPT plan. Nothing is sent anywhere else." : demo ? "Demo mode uses sample data and no AI." : "Signing in lets the app research colleges and chat using your ChatGPT plan."}>
        {account ? (
          <>
            <Row
              left={
                account.picture ? (
                  <img src={account.picture} alt="" className="h-10 w-10 rounded-full" />
                ) : (
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-accent">
                    <IconPerson size={22} />
                  </span>
                )
              }
              label={account.name ?? "ChatGPT account"}
              hint={account.email ?? undefined}
            />
            <Row label="Model" value={prefs.model ?? "Default"} chevron onClick={() => setModelsOpen(true)} />
            <Row label="Manage usage" hint="Opens chatgpt.com" onClick={() => open(MANAGE_USAGE_URL)} right={<IconExternal size={18} className="text-text-muted" />} />
            <Row label="Sign out" danger onClick={() => setConfirmSignOut(true)} />
          </>
        ) : (
          <>
            <Row
              left={
                <span className="grid h-10 w-10 place-items-center rounded-full bg-accent text-accent-contrast">
                  <IconChat size={22} />
                </span>
              }
              label="Continue with ChatGPT"
              hint={auth.configured() ? "Required for research and chat" : "Sign-in is being enabled for this app"}
              chevron
              onClick={() => navigate("/")}
              disabled={!auth.configured()}
            />
            {hasDevKey && <Row label="Developer key in use" hint="Requests go straight to OpenAI with your API key" />}
            {demo && (
              <Row
                label="Exit demo"
                hint="Clears the sample profile and colleges"
                onClick={() => {
                  exitDemo();
                  navigate("/", { replace: true });
                }}
              />
            )}
          </>
        )}
      </Group>

      {/* Your answers */}
      <Group label="Your answers">
        {hasProfile ? (
          <>
            <Row
              label="Edit answers"
              hint={`${profile.home_state ? stateName(profile.home_state) : "—"} · class of ${profile.grad_year} · ${profile.majors.map(majorLabel).join(", ") || "no majors yet"}`}
              chevron
              onClick={() => navigate("/onboarding/1")}
            />
            <Row label="Re-run research" hint={prefs.researchedAt ? `Last run ${new Date(prefs.researchedAt).toLocaleDateString()} · ${colleges.length} colleges` : "Not run yet"} chevron onClick={() => navigate("/research")} disabled={!connected && !demo} />
          </>
        ) : (
          <Row label="Answer the questions" hint="About 3 minutes" chevron onClick={() => navigate("/onboarding/1")} />
        )}
      </Group>

      {/* Data */}
      <Group label="Your data" foot="Everything lives in this app on this phone. Export a backup before switching devices.">
        <Row label="Export backup" hint="JSON file with answers, colleges, notes and chat" onClick={doExport} />
        <Row label="Import backup" hint="Replaces what's on this phone" onClick={() => fileRef.current?.click()} />
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} aria-label="Import backup file" />
        <Row label="Delete everything" danger onClick={() => setConfirmDelete(true)} />
      </Group>

      {/* About */}
      <Group label="About">
        <Row label="How odds work" chevron onClick={() => setOddsOpen(true)} />
        <Row label="Privacy policy" onClick={() => open("./privacy.html")} right={<IconExternal size={18} className="text-text-muted" />} />
        <Row label="Support" onClick={() => open("./support.html")} right={<IconExternal size={18} className="text-text-muted" />} />
        <Row label="Version" value={APP_VERSION} onClick={onVersionTap} />
      </Group>

      {/* Developer */}
      {devOpen && (
        <Group label="Developer" foot="For testing before ChatGPT sign-in is enabled. The key is stored only on this phone and sent only to api.openai.com.">
          <div className="px-4 py-3">
            <label className="block text-footnote text-text-muted" htmlFor="devkey">
              OpenAI API key
            </label>
            <input id="devkey" className="cc-input mt-1.5 font-mono !text-[15px]" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="sk-…" value={devKey} onChange={(e) => setDevKeyText(e.target.value)} />
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={saveDevKey}>
                Save key
              </Button>
              {hasDevKey && (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    setDevKeyText("");
                    setDevApiKey(null);
                    refreshAuth();
                    setToast("Developer key removed");
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        </Group>
      )}

      <p className="mt-8 text-center text-footnote text-text-muted">College Compass {APP_VERSION}</p>

      {/* Model picker */}
      <Sheet open={modelsOpen} onClose={() => setModelsOpen(false)} title="Model">
        {modelsErr && <Banner tone="error">{modelsErr}</Banner>}
        {!models && !modelsErr && <p className="py-6 text-center text-subhead text-text-muted">Loading models…</p>}
        {models && (
          <div className="cc-group">
            <button type="button" className="cc-row cc-row-press" onClick={() => { setPrefs({ model: null }); setPreferredModel(null); setModelsOpen(false); }}>
              <span className="flex-1 text-body">Default</span>
              {prefs.model == null && <IconCheck size={20} className="text-accent" />}
            </button>
            {models.map((m) => (
              <button key={m.slug} type="button" className="cc-row cc-row-press" onClick={() => { setPrefs({ model: m.slug }); setPreferredModel(m.slug); setModelsOpen(false); }}>
                <span className="min-w-0 flex-1">
                  <span className="block text-body">{m.display_name}</span>
                  <span className="block text-footnote text-text-muted">{m.slug}</span>
                </span>
                {prefs.model === m.slug && <IconCheck size={20} className="text-accent" />}
              </button>
            ))}
            {models.length === 0 && <p className="px-4 py-6 text-center text-subhead text-text-muted">No models listed for this account.</p>}
          </div>
        )}
      </Sheet>

      {/* How odds work */}
      <Sheet open={oddsOpen} onClose={() => setOddsOpen(false)} title="How odds work">
        <div className="space-y-3 pb-2 text-subhead leading-relaxed">
          <p>Each estimate starts from the college's overall admit rate, then moves up or down for your test scores against their middle 50%, your GPA against their average, course rigor and activities, residency at public universities, Early Decision where offered and you're open to it, capacity-limited majors, and first-generation status at selective colleges.</p>
          <p>The result is shown as a range, never a single number. The range is wider when the researched data is less certain. Below a 15% admit rate the estimate is capped and the college is always a high reach, because strong applicants are routinely turned away.</p>
          <div className="cc-group">
            {TIERS.map((t) => (
              <div key={t.id} className="cc-row-static">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.cssVar }} aria-hidden />
                <span className="flex-1 text-body">{t.label}</span>
                <span className="tnum text-subhead text-text-muted">{t.range}</span>
              </div>
            ))}
          </div>
          <p>Figures come from each college's latest Common Data Set and official pages, as found by ChatGPT research. Every college shows its data year, sources and a confidence level. If something looks off, tap Refresh research on that college.</p>
          <p className="text-text-muted">These are estimates to help you build a balanced list, not predictions.</p>
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete everything?"
        message="Your answers, researched colleges, shortlist, notes and chat are removed from this phone. This can't be undone."
        confirmLabel="Delete everything"
        destructive
        onConfirm={() => {
          resetAll();
          navigate("/", { replace: true });
        }}
      />
      <ConfirmSheet
        open={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        title="Sign out of ChatGPT?"
        message="Your answers and list stay on this phone. Research and chat need you to sign in again."
        confirmLabel="Sign out"
        onConfirm={() => {
          auth.signOut();
          refreshAuth();
        }}
      />
    </Screen>
  );
}

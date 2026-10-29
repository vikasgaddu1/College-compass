import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AiMessage } from "@/types";
import { useStore } from "@/state/store";
import { MANAGE_USAGE_URL, aiClient, auth, chatInstructions, deadlinesBrief, describeError, summarizeListForAi } from "@/state/services";
import { ConfirmSheet } from "@/components/Sheet";
import { SignInAgain, needsSignIn, reasonFor } from "@/components/SignInAgain";
import { Banner, Chip, Empty } from "@/components/ui";
import { IconSend, IconStop, IconTrash } from "@/components/icons";
import { Screen } from "@/components/Screen";
import { ASK_PROMPT_TEXT, CounselorPrompt, askWantsCounselor, useCounselorAvailability } from "@/components/CounselorPrompt";
import { AiNoticeLine } from "@/components/AiNotice";
import { AI_NOTICE_CHAT } from "@/legal/notice";

const SUGGESTIONS = ["Which of these should I apply early to?", "Where will I likely get the most merit aid?", "What's missing from my list?", "Compare my top two targets", "What should I do this semester to improve my odds?"];

/** Keeps the composer above the iOS keyboard by tracking the visual viewport. */
function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--kb", `${Math.round(inset)}px`);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.documentElement.style.setProperty("--kb", "0px");
    };
  }, []);
}

export function Ask({ tabBar }: { tabBar?: ReactNode }) {
  const { chat, setChat, ranked, profile, connected, demo, prefs, colleges } = useStore();
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [err, setErr] = useState<{ title: string; detail: string; code?: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useKeyboardInset();

  const summary = useMemo(() => summarizeListForAi(ranked), [ranked]);
  const deadlines = useMemo(() => deadlinesBrief(colleges), [colleges]);
  const busy = streaming != null;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, streaming]);

  // Signed in again from the card (iPhone completes sign-in in place): drop the card so they can keep chatting.
  const needsSession = !!err && needsSignIn(err.code);
  useEffect(() => {
    if (!needsSession) return;
    return auth.subscribe(() => {
      if (auth.account() && !auth.lastError?.()) setErr(null);
    });
  }, [needsSession]);

  const send = async (content: string) => {
    const msg = content.trim();
    if (!msg || busy) return;
    setErr(null);
    setText("");
    if (taRef.current) taRef.current.style.height = "";
    const history: AiMessage[] = [...chat, { role: "user", content: msg }];
    setChat(history);
    if (demo && !connected) {
      setStreaming("");
      const reply = demoReply(msg, ranked.length);
      let i = 0;
      await new Promise<void>((resolve) => {
        const tick = () => {
          i = Math.min(reply.length, i + 3);
          setStreaming(reply.slice(0, i));
          if (i < reply.length) setTimeout(tick, 16);
          else resolve();
        };
        tick();
      });
      setChat([...history, { role: "assistant", content: reply }]);
      setStreaming(null);
      return;
    }
    const c = new AbortController();
    ctrl.current = c;
    setStreaming("");
    let acc = "";
    try {
      const res = await aiClient.call({
        instructions: chatInstructions(profile, summary, new Date(), deadlines),
        input: history.slice(-20),
        model: prefs.model ?? undefined,
        signal: c.signal,
        onDelta: (d) => {
          acc += d;
          setStreaming(acc);
        },
      });
      const final = res.text || acc;
      setChat([...history, { role: "assistant", content: final }]);
    } catch (e) {
      if (c.signal.aborted) {
        if (acc) setChat([...history, { role: "assistant", content: acc }]);
      } else {
        setErr(describeError(e));
      }
    } finally {
      setStreaming(null);
      ctrl.current = null;
    }
  };

  const stop = () => ctrl.current?.abort();

  const canChat = connected || demo;

  // After an answer about essays, recommendations, early plans or "which should I…": offer a person.
  // A chip under the bubble, never words inside the AI's answer; only when the directory lists someone.
  const counselors = useCounselorAvailability();
  const askPrompt = useMemo(() => {
    if (busy || !counselors.eligible || counselors.count === 0) return null;
    const last = chat[chat.length - 1];
    const lastUser = [...chat].reverse().find((m) => m.role === "user");
    if (!last || last.role !== "assistant" || !lastUser) return null;
    const want = askWantsCounselor(lastUser.content);
    if (!want.match) return null;
    // Open the specialty's filter only when someone lists it; otherwise the whole directory.
    return want.specialty && !counselors.bySpecialty[want.specialty] ? { ...want, specialty: null } : want;
  }, [chat, busy, counselors.eligible, counselors.count, counselors.bySpecialty]);

  return (
    <Screen
      title="Ask"
      largeTitle={false}
      scrollRef={scrollRef}
      right={
        chat.length > 0 ? (
          <button type="button" className="grid h-11 w-11 place-items-center text-accent" aria-label="Clear conversation" onClick={() => setConfirmClear(true)}>
            <IconTrash size={21} />
          </button>
        ) : null
      }
      footer={
        <>
        {canChat && (
          <div className="cc-chrome border-t border-border bg-bg" style={{ paddingBottom: "var(--kb)" }}>
            <div className="cc-column py-2">
              {chat.length === 0 && !busy && (
                <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: "none" }}>
                  {SUGGESTIONS.map((s) => (
                    <Chip key={s} onClick={() => send(s)} className="shrink-0">
                      {s}
                    </Chip>
                  ))}
                </div>
              )}
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  send(text);
                }}
              >
                <textarea
                  ref={taRef}
                  className="cc-input !min-h-[44px] flex-1 !rounded-[22px] !py-[11px] !pl-4 !pr-4"
                  rows={1}
                  placeholder={ranked.length ? "Ask about your list" : "Ask about colleges"}
                  value={text}
                  aria-label="Message"
                  enterKeyHint="send"
                  onChange={(e) => {
                    setText(e.target.value);
                    const el = e.target;
                    el.style.height = "";
                    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(text);
                    }
                  }}
                />
                {busy ? (
                  <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-2 text-text" aria-label="Stop" onClick={stop}>
                    <IconStop size={20} />
                  </button>
                ) : (
                  <button type="submit" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-contrast disabled:opacity-40" aria-label="Send" disabled={!text.trim()}>
                    <IconSend size={22} />
                  </button>
                )}
              </form>
              <AiNoticeLine className="mt-1.5 !text-caption" text={AI_NOTICE_CHAT} />
            </div>
          </div>
        )}
        {tabBar}
        </>
      }
    >
      {!canChat ? (
        <div className="pt-4">
          {needsSession ? (
            <SignInAgain returnTo="/ask" reason={reasonFor(err?.code as "reauth_required" | "not_connected")} line="Sign in again to keep chatting — your conversation and colleges are saved on this phone." />
          ) : (
            <SignInAgain returnTo="/ask" reason="signed_out" line="Sign in to ask about your list. Your profile and colleges are sent only with your question, and stay on this phone." />
          )}
        </div>
      ) : chat.length === 0 && !busy ? (
        <Empty
          icon="💬"
          title={ranked.length ? "Ask about your list" : "Ask about colleges"}
          message={ranked.length ? `ChatGPT sees your profile and all ${ranked.length} colleges on your list, so you can ask for comparisons, strategy or next steps.` : "Run research first for answers specific to your list. You can still ask general questions."}
        />
      ) : (
        <ol className="space-y-3 pt-3" aria-live="polite">
          {chat.map((m, i) => (
            <li key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`cc-bubble ${m.role === "user" ? "cc-bubble-user" : "cc-bubble-ai"}`}>{m.content}</div>
            </li>
          ))}
          {busy && (
            <li className="flex justify-start">
              <div className="cc-bubble cc-bubble-ai">
                {streaming || <span className="cc-dot-pulse text-text-muted">Thinking…</span>}
              </div>
            </li>
          )}
        </ol>
      )}
      {askPrompt && (
        <CounselorPrompt kind="ask" compact specialty={askPrompt.specialty} className="mt-2">
          {ASK_PROMPT_TEXT.question} <span className="whitespace-nowrap text-accent">{ASK_PROMPT_TEXT.action}</span>
        </CounselorPrompt>
      )}
      {canChat && err && needsSignIn(err.code) && (
        <div className="mt-3">
          <SignInAgain returnTo="/ask" reason={reasonFor(err.code)} line="Sign in again to keep chatting — your conversation and colleges are saved on this phone." />
        </div>
      )}
      {err && !needsSignIn(err.code) && (
        <div className="mt-3">
          <Banner tone="error">
            <strong>{err.title}.</strong> {err.detail}{" "}
            {err.code === "usage_limit" && (
              <a className="underline" href={MANAGE_USAGE_URL} target="_blank" rel="noopener noreferrer">
                Manage usage
              </a>
            )}
          </Banner>
        </div>
      )}
      {demo && !connected && colleges.length > 0 && <p className="mt-4 text-center text-footnote text-text-muted">Demo mode: replies are canned. Sign in with ChatGPT for real answers.</p>}
      <ConfirmSheet open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear this conversation?" message="Messages are only stored on this phone." confirmLabel="Clear" destructive onConfirm={() => setChat([])} />
    </Screen>
  );
}

function demoReply(q: string, n: number) {
  const lower = q.toLowerCase();
  if (lower.includes("early")) return "In demo mode I can't run ChatGPT, but here's how to think about it: apply Early Action anywhere it's offered and non-binding (Georgia Tech, Michigan, Purdue, NC State all have EA). Use Early Decision only at a college you'd attend regardless of cost — the odds bump is real at Duke or NYU, but you give up comparing aid offers.";
  if (lower.includes("merit") || lower.includes("aid") || lower.includes("money")) return "Demo answer: automatic merit is strongest at Alabama (Presidential Scholarship covers out-of-state tuition with a 3.5 GPA and 1360 SAT) and Arizona State. Purdue's frozen tuition keeps the sticker low. The private colleges on your list mostly award need-based aid instead.";
  if (lower.includes("missing")) return `Demo answer: your list has ${n} colleges. Check that at least two are likely or safety schools you'd actually be happy at, and that your main major is a direct-admit program at your targets — CS is capacity-limited at several public universities here.`;
  return "This is demo mode, so I can't reach ChatGPT. Sign in with your ChatGPT account and I'll answer using your real profile and research. Until then, tap into any college for its odds breakdown, deadlines and cost details.";
}

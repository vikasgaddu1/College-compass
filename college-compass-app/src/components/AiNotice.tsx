/**
 * The AI-assistance notice in the app: the one-time "Before you start" acknowledgement, the full-text
 * sheet (Settings → About Tierwise, "Learn more") and the short line under AI-derived figures.
 * Wording lives in src/legal/notice.ts.
 */
import { useState, type ReactNode } from "react";
import { AI_NOTICE_FULL, AI_NOTICE_SHORT, AI_NOTICE_TITLE } from "@/legal/notice";
import { Sheet } from "./Sheet";
import { Button } from "./ui";
import { IconInfo } from "./icons";

/** The full notice as body copy. `lead` prints the bold "About Tierwise." opener (off under a heading that already says it). */
export function AiNoticeText({ className = "", lead = true }: { className?: string; lead?: boolean }) {
  return (
    <p className={`text-subhead leading-relaxed ${className}`}>
      {lead && (
        <>
          <strong className="font-semibold">{AI_NOTICE_TITLE}.</strong>{" "}
        </>
      )}
      {AI_NOTICE_FULL}
    </p>
  );
}

/** "About Tierwise": the full notice in a sheet, optionally with extra rows (e.g. the version) under it. */
export function AiNoticeSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children?: ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} title={AI_NOTICE_TITLE}>
      <div className="pb-2 pt-1">
        <AiNoticeText lead={false} />
        {children}
      </div>
    </Sheet>
  );
}

/**
 * One-time acknowledgement before the first research run. "I understand" accepts; "Not now" (and
 * dismissing the sheet) declines — the caller decides where that leads.
 */
export function AiNoticeGate({ open, onAccept, onDecline }: { open: boolean; onAccept: () => void; onDecline: () => void }) {
  return (
    <Sheet open={open} onClose={onDecline} label="Before you start" right={<span />}>
      <div className="px-1 pb-2 pt-3">
        <h2 className="text-title2">Before you start</h2>
        <AiNoticeText className="mt-3 text-text" />
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={onAccept}>I understand</Button>
          <Button variant="quiet" onClick={onDecline}>
            Not now
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * Small muted line under AI-derived figures, with an "i" that opens the full notice.
 * `text` defaults to the short notice; the chat tab passes its own.
 */
export function AiNoticeLine({ text = AI_NOTICE_SHORT, className = "", align = "center" }: { text?: string; className?: string; align?: "center" | "left" }) {
  const [open, setOpen] = useState(false);
  // The "i" stays glued to the last word, so it never wraps onto a line of its own.
  const cut = text.lastIndexOf(" ");
  const head = cut < 0 ? "" : text.slice(0, cut + 1);
  const last = cut < 0 ? text : text.slice(cut + 1);
  return (
    <>
      <p className={`text-footnote text-text-muted ${align === "center" ? "text-center" : ""} ${className}`} data-testid="ai-notice-line">
        {head}
        <span className="whitespace-nowrap">
          {last}{" "}
          {/* 28px tap target that doesn't grow the line. */}
          <button type="button" className="-my-2 inline-grid h-7 w-7 translate-y-px place-items-center rounded-full align-middle text-text-muted hover:text-accent" aria-label={`Learn more: ${AI_NOTICE_TITLE}`} onClick={() => setOpen(true)}>
            <IconInfo size={15} />
          </button>
        </span>
      </p>
      <AiNoticeSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

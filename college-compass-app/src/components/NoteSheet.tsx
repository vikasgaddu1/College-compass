/** Quick per-college notes: a bottom sheet with an auto-growing, autosaving textarea.
 *  Notes are read and written through the store (`notes` / `setNote`), so the sheet works
 *  from any card without threading props through the list screens. */
import { useLayoutEffect, useRef, type ChangeEvent, type RefObject, type SVGProps } from "react";
import { navigate } from "@/lib/router";
import { useStore } from "@/state/store";
import { Sheet } from "./Sheet";
import { IconChevronRight } from "./icons";

export const NOTE_PLACEHOLDER = "Visit dates, people to email, gut feeling…";

/** Route for a college page scrolled to and focused on its notes box. */
export function notesHref(collegeId: string) {
  return `/college/${encodeURIComponent(collegeId)}?notes=1`;
}

/** First non-empty line of a note, whitespace collapsed, for one-line previews. */
export function notePreview(text: string | undefined): string {
  if (!text) return "";
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return line.replace(/\s+/g, " ").trim();
}

/** Note glyph (SF Symbols "note.text" flavoured), consistent with icons.tsx. */
export const IconNote = ({ size, ...r }: SVGProps<SVGSVGElement> & { size?: number }) => (
  <svg width={size ?? 24} height={size ?? 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false} {...r}>
    <path d="M6 3.5h8.5L19 8v12.5H6z" />
    <path d="M14.5 3.5V8H19" />
    <path d="M9 12.5h6M9 16h4" />
  </svg>
);

/** Textarea that grows with its content (no inner scrollbar) — the surrounding sheet or page scrolls instead. */
export function NoteTextarea({
  value,
  onChange,
  minRows = 4,
  className = "",
  inputRef,
  autoFocus,
  id,
  label = "Your notes",
}: {
  value: string;
  onChange: (text: string) => void;
  minRows?: number;
  className?: string;
  inputRef?: RefObject<HTMLTextAreaElement>;
  autoFocus?: boolean;
  id?: string;
  label?: string;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? own;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const h = el.scrollHeight;
    if (h > 0) el.style.height = `${h + 3}px`; // + top/bottom border (border-box)
  }, [value, ref]);
  return (
    <textarea
      ref={ref}
      id={id}
      className={`cc-input ${className}`}
      rows={minRows}
      placeholder={NOTE_PLACEHOLDER}
      value={value}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      aria-label={label}
      autoFocus={autoFocus}
      autoCapitalize="sentences"
      enterKeyHint="enter"
    />
  );
}

/** Bottom sheet for editing one college's note. `collegeId` may be null while closed. */
export function NoteSheet({ collegeId, open, onClose }: { collegeId: string | null; open: boolean; onClose: () => void }) {
  const { byId, notes, setNote } = useStore();
  const item = collegeId ? byId.get(collegeId) : undefined;
  const short = item?.college.short ?? "College";
  const value = collegeId ? (notes[collegeId] ?? "") : "";
  return (
    <Sheet open={open && !!collegeId} onClose={onClose} title={`Notes · ${short}`}>
      <div className="pt-1">
        {/* autoFocus happens inside the tap that opened the sheet, so the iPhone keyboard comes up with it.
            Sheet leaves focus alone when a field inside it already has focus. */}
        <NoteTextarea value={value} onChange={(t) => collegeId && setNote(collegeId, t)} autoFocus minRows={5} label={`Notes for ${short}`} />
        <div className="mt-2 flex min-h-tap items-center justify-between gap-3 text-footnote text-text-muted">
          <span>Saved automatically on this phone.</span>
          {collegeId && (
            <button
              type="button"
              className="cc-link flex min-h-tap shrink-0 items-center gap-0.5 text-footnote"
              onClick={() => {
                onClose();
                navigate(notesHref(collegeId));
              }}
            >
              Open {short} page
              <IconChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

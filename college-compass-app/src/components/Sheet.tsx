/** Bottom sheet (modal) with backdrop, grab handle, title row and a scrollable body. */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Accessible label when there is no title. */
  label?: string;
}

export function Sheet({ open, onClose, title, left, right, children, footer, label }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    // Focus the sheet so VoiceOver / keyboard users land inside it.
    setTimeout(() => ref.current?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <>
      <div className="cc-sheet-backdrop" onClick={onClose} aria-hidden />
      <div ref={ref} className="cc-sheet" role="dialog" aria-modal="true" aria-label={title ?? label} tabIndex={-1}>
        <div className="cc-sheet-grab cc-chrome" aria-hidden />
        {(title || left || right) && (
          <div className="cc-sheet-head cc-chrome">
            <div className="flex items-center justify-start">{left}</div>
            <h2 className="text-headline">{title}</h2>
            <div className="flex items-center justify-end">
              {right ?? (
                <button type="button" className="cc-link min-h-tap px-1 text-body" onClick={onClose}>
                  Done
                </button>
              )}
            </div>
          </div>
        )}
        <div className="cc-sheet-body">{children}</div>
        {footer && <div className="cc-chrome px-4 pb-3 pt-2">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

/** A compact confirmation dialog built on the sheet. */
export function ConfirmSheet({
  open,
  onClose,
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} label={title} right={<span />}>
      <div className="px-1 pb-2 pt-3 text-center">
        <h2 className="text-title3">{title}</h2>
        <p className="mt-2 text-subhead text-text-muted">{message}</p>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          className={`cc-btn cc-press ${destructive ? "bg-bad text-white" : "cc-btn-primary"}`}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
        <button type="button" className="cc-btn cc-btn-quiet cc-press" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

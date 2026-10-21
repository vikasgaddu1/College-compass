/** Screen scaffold: fixed nav bar with a collapsing large title, plus a contained scroll area. */
import { useEffect, useRef, useState, type ReactNode, type UIEvent } from "react";
import { back } from "@/lib/router";
import { IconChevronLeft } from "./icons";

interface ScreenProps {
  title: string;
  /** Large title shown at the top of the content (defaults to `title`); a node for a tappable title. */
  largeTitle?: ReactNode | false;
  subtitle?: ReactNode;
  back?: boolean | string; // true = history back; string = fallback route
  backLabel?: string;
  left?: ReactNode;
  right?: ReactNode;
  /** Rendered below the nav row, inside the fixed bar (e.g. search / segmented). */
  bar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Pad the content for the tab bar when the screen lives in a tab. */
  className?: string;
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScrollEnd?: () => void;
}

export function Screen({ title, largeTitle, subtitle, back: showBack, backLabel, left, right, bar, children, footer, className, scrollRef, onScrollEnd }: ScreenProps) {
  const [collapsed, setCollapsed] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);
  const ref = scrollRef ?? innerRef;
  const large = largeTitle === undefined ? title : largeTitle;

  useEffect(() => {
    setCollapsed(false);
    ref.current?.scrollTo({ top: 0 });
  }, [title, ref]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const c = large === false ? el.scrollTop > 4 : el.scrollTop > 36;
    if (c !== collapsed) setCollapsed(c);
    if (onScrollEnd && el.scrollHeight - el.scrollTop - el.clientHeight < 80) onScrollEnd();
  };

  return (
    <div className="cc-shell">
      <header className="cc-nav cc-chrome" data-collapsed={collapsed || large === false}>
        <div className="cc-column">
          <div className="cc-nav-row">
            <div className="flex items-center justify-start">
              {showBack ? (
                <button
                  type="button"
                  className="-ml-2 flex min-h-tap items-center gap-0.5 pr-2 text-accent text-body"
                  onClick={() => back(typeof showBack === "string" ? showBack : "/list")}
                  aria-label="Back"
                >
                  <IconChevronLeft size={26} />
                  <span>{backLabel ?? "Back"}</span>
                </button>
              ) : (
                left
              )}
            </div>
            <h1 className="cc-nav-title" aria-live="polite">
              {title}
            </h1>
            <div className="flex items-center justify-end gap-1">{right}</div>
          </div>
          {bar && <div className="pb-2">{bar}</div>}
        </div>
      </header>
      <div ref={ref} className={`cc-scroll ${className ?? ""}`} onScroll={onScroll}>
        <div className="cc-column pb-6">
          {large !== false && (
            <div className="pt-1">
              <h2 className="cc-large-title">{large}</h2>
              {subtitle && <p className="-mt-1 pb-3 text-subhead text-text-muted">{subtitle}</p>}
            </div>
          )}
          {children}
        </div>
      </div>
      {footer}
    </div>
  );
}

/** Sticky primary-action area above the home indicator (used inside Screen.footer or inline). */
export function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div className="cc-sticky-actions cc-chrome">
      <div className="cc-column flex flex-col gap-2">{children}</div>
    </div>
  );
}

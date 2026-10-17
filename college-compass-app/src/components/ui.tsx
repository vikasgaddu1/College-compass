/** Small building blocks: buttons, chips, segmented control, options, rows, badges, skeletons. */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Tier } from "@/types";
import { tierInfo } from "@/state/catalog";
import { IconCheck, IconChevronRight, IconDash, IconDown, IconUp } from "./icons";

type Variant = "primary" | "secondary" | "quiet" | "danger";
export function Button({ variant = "primary", size, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" }) {
  return (
    <button type="button" className={`cc-btn cc-btn-${variant} cc-press cc-chrome ${size === "sm" ? "cc-btn-sm" : ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Chip({ selected, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button type="button" className={`cc-chip cc-press cc-chrome ${className}`} aria-pressed={!!selected} {...rest}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="cc-seg cc-chrome" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One-per-screen choice row with a radio/check indicator. */
export function OptionRow({ checked, label, hint, icon, onClick, multi }: { checked: boolean; label: string; hint?: string; icon?: ReactNode; onClick: () => void; multi?: boolean }) {
  return (
    <button type="button" role={multi ? "checkbox" : "radio"} aria-checked={checked} className="cc-option cc-press cc-chrome" onClick={onClick}>
      {icon && <span className="text-[22px] leading-none" aria-hidden>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-footnote text-text-muted">{hint}</span>}
      </span>
      <span className="cc-option-check" aria-hidden>
        {checked && <IconCheck size={14} />}
      </span>
    </button>
  );
}

export function Group({ label, foot, children, className = "" }: { label?: string; foot?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mt-5 ${className}`}>
      {label && <h3 className="cc-group-label">{label}</h3>}
      <div className="cc-group">{children}</div>
      {foot && <p className="cc-group-foot">{foot}</p>}
    </section>
  );
}

export function Row({ label, value, hint, onClick, chevron, danger, left, right, disabled }: { label: ReactNode; value?: ReactNode; hint?: ReactNode; onClick?: () => void; chevron?: boolean; danger?: boolean; left?: ReactNode; right?: ReactNode; disabled?: boolean }) {
  const inner = (
    <>
      {left}
      <span className="min-w-0 flex-1">
        <span className={`block text-body ${danger ? "text-bad" : ""}`}>{label}</span>
        {hint && <span className="block text-footnote text-text-muted">{hint}</span>}
      </span>
      {value != null && <span className="tnum max-w-[45%] truncate text-right text-body text-text-muted">{value}</span>}
      {right}
      {chevron && <IconChevronRight size={18} className="-mr-1 text-text-muted opacity-70" />}
    </>
  );
  if (onClick)
    return (
      <button type="button" className="cc-row cc-row-press" onClick={onClick} disabled={disabled}>
        {inner}
      </button>
    );
  return <div className="cc-row-static">{inner}</div>;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="cc-switch cc-chrome" onClick={() => onChange(!checked)} />;
}

export function TierPill({ tier, className = "" }: { tier: Tier; className?: string }) {
  const t = tierInfo(tier);
  return (
    <span className={`cc-pill ${className}`} style={{ background: `color-mix(in srgb, ${t.cssVar} 16%, transparent)`, color: t.cssVar }}>
      {t.label}
    </span>
  );
}

export function OddsChip({ low, high, tier }: { low: number; high: number; tier: Tier }) {
  const t = tierInfo(tier);
  return (
    <span className="inline-flex items-center gap-2" aria-label={`Estimated odds ${Math.round(low * 100)} to ${Math.round(high * 100)} percent`}>
      <span className="cc-band w-12" style={{ ["--rail" as string]: t.cssVar }} aria-hidden>
        <span style={{ left: `${low * 100}%`, width: `${Math.max(4, (high - low) * 100)}%` }} />
      </span>
      <span className="tnum text-subhead font-semibold" style={{ color: t.cssVar }}>
        {Math.round(low * 100)}–{Math.round(high * 100)}%
      </span>
    </span>
  );
}

export function ConfidenceDot({ level, withLabel }: { level: "high" | "medium" | "low"; withLabel?: boolean }) {
  const color = level === "high" ? "var(--good)" : level === "medium" ? "var(--warn)" : "var(--bad)";
  const text = level === "high" ? "High confidence" : level === "medium" ? "Medium confidence" : "Low confidence";
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-text-muted" title={text} aria-label={`Data: ${text}`}>
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
      {withLabel && <span>{text}</span>}
    </span>
  );
}

export function EffectIcon({ effect }: { effect: "up" | "down" | "neutral" }) {
  const cls = "h-6 w-6 shrink-0 rounded-full grid place-items-center";
  if (effect === "up") return <span className={`${cls} text-good`} style={{ background: "color-mix(in srgb, var(--good) 15%, transparent)" }} aria-label="Helps"><IconUp size={14} /></span>;
  if (effect === "down") return <span className={`${cls} text-bad`} style={{ background: "color-mix(in srgb, var(--bad) 15%, transparent)" }} aria-label="Hurts"><IconDown size={14} /></span>;
  return <span className={`${cls} bg-surface-2 text-text-muted`} aria-label="Neutral"><IconDash size={14} /></span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`cc-skel ${className}`} aria-hidden />;
}

export function CardSkeleton() {
  return (
    <div className="cc-card p-4" aria-hidden>
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="mt-2 h-3.5 w-1/3" />
      <div className="mt-4 flex gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-14" />
      </div>
      <Skeleton className="mt-3 h-3.5 w-5/6" />
    </div>
  );
}

export function Empty({ icon, title, message, action }: { icon?: ReactNode; title: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-[40px] leading-none">{icon}</div>}
      <h3 className="text-title3">{title}</h3>
      <p className="mt-1.5 max-w-xs text-subhead text-text-muted">{message}</p>
      {action && <div className="mt-5 w-full max-w-xs">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <span className="cc-spinner" aria-hidden />
      {label && <span className="text-subhead text-text-muted">{label}</span>}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="cc-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}>
      <div style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

/** A plain stat: big number with a unit and a small label beneath. */
export function Stat({ value, label, unit }: { value: ReactNode; label: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="tnum text-title3 leading-tight">
        {value}
        {unit && <span className="ml-0.5 text-footnote font-medium text-text-muted">{unit}</span>}
      </div>
      <div className="mt-0.5 text-caption text-text-muted">{label}</div>
    </div>
  );
}

export function Banner({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
  const style =
    tone === "error"
      ? { background: "color-mix(in srgb, var(--bad) 12%, transparent)", color: "var(--bad)" }
      : tone === "warn"
        ? { background: "color-mix(in srgb, var(--warn) 14%, transparent)", color: "var(--warn)" }
        : { background: "var(--accent-soft)", color: "var(--accent)" };
  return (
    <div className="rounded-control px-4 py-3 text-subhead" style={style}>
      {children}
    </div>
  );
}

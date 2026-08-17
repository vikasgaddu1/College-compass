import { School, fitClass, fmtCost, fmtEnroll, scoreClass, archetypeLabels, shortlistLabel } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { useNotes, hasContent, statusLabel, statusTone } from "@/lib/notes";
import { EyeOff, Eye, ExternalLink, StickyNote, Star } from "lucide-react";
import { ReactNode } from "react";

export function FitBadge({ fit }: { fit: string }) {
  return <span className={`chip ${fitClass(fit)}`}>{fit}</span>;
}

export function ArchetypeChips({ codes }: { codes: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {codes.map(c => (
        <span key={c} className="chip chip-outline" title={archetypeLabels[c] || c}>
          {c} · {archetypeLabels[c] || ""}
        </span>
      ))}
    </div>
  );
}

export function AccessBadge({ status }: { status: School["major_access_status"] }) {
  const cls =
    status === "DIRECT" ? "fit-top" :
    status === "MIXED" ? "fit-conditional" :
    status === "GATED" ? "fit-lower" : "";
  return <span className={`chip ${cls}`}>{status}</span>;
}

export function ScoreCell({ value }: { value: number | null }) {
  return <span className={`score-cell ${scoreClass(value)}`}>{value ?? "?"}</span>;
}

export function AxisBar({ value, label }: { value: number | null; label: string }) {
  const pct = value == null ? 0 : (value / 5) * 100;
  const hue = value == null ? "var(--score-unk)"
    : value >= 4.5 ? "var(--score-5)"
    : value >= 3.5 ? "var(--score-4)"
    : value >= 2.5 ? "var(--score-3)"
    : value >= 1.5 ? "var(--score-2)"
    : "var(--score-1)";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[11.5px]">
        <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
        <span className="num font-semibold">{value == null ? "—" : value.toFixed(1)}</span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%`, background: `hsl(${hue})` }} />
      </div>
    </div>
  );
}

export function HideButton({ slug, compact }: { slug: string; compact?: boolean }) {
  const { isHidden, toggle } = useHidden();
  const on = isHidden(slug);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); toggle(slug); }}
      className={`inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 border border-[hsl(var(--border))] hover:bg-[hsl(var(--elevate-1))]
        ${on ? "text-[hsl(var(--muted-foreground))]" : "text-[hsl(var(--foreground))]"}`}
      title={on ? "Show this school" : "Hide this school from every view"}
    >
      {on ? <Eye size={12} /> : <EyeOff size={12} />}
      {!compact && (on ? "Show" : "Hide")}
    </button>
  );
}

export function ShortlistPill({ group }: { group: School["shortlist_group"] }) {
  const cls =
    group === "strongest" ? "fit-top" :
    group === "alternative" ? "fit-strong" :
    group === "weakened" ? "fit-lower" : "chip-outline";
  return <span className={`chip ${cls}`}>{shortlistLabel[group]}</span>;
}

export function SchoolCard({ s, children, onClick }: { s: School; children?: ReactNode; onClick?: () => void }) {
  const { isHidden } = useHidden();
  const hidden = isHidden(s.slug);
  return (
    <div
      className={`card card-hover p-4 ${hidden ? "opacity-50" : ""}`}
      onClick={onClick}
      style={onClick ? { cursor: "pointer" } : undefined}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="serif text-[17px] font-semibold leading-tight truncate">{s.short}</div>
          <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] truncate">{s.city_state} · {fmtEnroll(s.undergrad_enrollment)} UG</div>
        </div>
        <div className="flex items-center gap-1" onClick={e=>e.stopPropagation()}>
          <NoteButton slug={s.slug} />
          <HideButton slug={s.slug} compact />
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        <FitBadge fit={s.fit_classification} />
        <AccessBadge status={s.major_access_status} />
        <MyRatingChip slug={s.slug} />
      </div>
      {children}
    </div>
  );
}

/** Small icon button that opens the note drawer. Shows a filled state if a note exists. */
export function NoteButton({ slug }: { slug: string }) {
  const { openDrawer, getNote } = useNotes();
  const has = hasContent(getNote(slug));
  return (
    <button
      onClick={(e) => { e.stopPropagation(); openDrawer(slug); }}
      className={`inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 border
        ${has ? "border-[hsl(var(--accent))] text-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.10)]"
              : "border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--elevate-1))]"}`}
      title={has ? "Edit your notes" : "Add a note"}>
      <StickyNote size={12}/>
      {has ? "Notes" : "Note"}
    </button>
  );
}

/** Small chip showing the user's own rating + status, if any. */
export function MyRatingChip({ slug }: { slug: string }) {
  const { getNote, openDrawer } = useNotes();
  const n = getNote(slug);
  if (!hasContent(n)) return null;
  const parts: ReactNode[] = [];
  if (n && n.rating > 0) {
    parts.push(<span key="r" className="inline-flex items-center gap-0.5"><Star size={10} fill="currentColor"/>{n.rating}</span>);
  }
  if (n?.status) {
    parts.push(<span key="s">{statusLabel[n.status]}</span>);
  }
  if (!parts.length) parts.push(<span key="n">My notes</span>);
  return (
    <button onClick={(e)=>{e.stopPropagation(); openDrawer(slug);}}
      className={`chip ${n?.status ? statusTone[n.status] : "chip-accent"} cursor-pointer`}
      title="My personal notes on this school">
      {parts.reduce<ReactNode[]>((acc, p, i) => acc.length ? [...acc, <span key={`d${i}`} className="opacity-60 mx-0.5">·</span>, p] : [p], [])}
    </button>
  );
}

export function CostChip({ s }: { s: School }) {
  const inState = s.state === "NC" && s.is_public;
  const v = s.cost_for_nc_resident;
  return (
    <span className="chip num" title={inState ? "In-state (NC resident)" : "Out-of-state / private published"}>
      {fmtCost(v)}{inState ? " · in-state" : ""}
    </span>
  );
}

/** A green chip if the school meets full demonstrated need; useful on card summaries. */
export function AidChip({ s }: { s: School }) {
  const o = s.outcomes;
  if (!o) return null;
  const meets = (o.meets_full_need || "").toLowerCase().startsWith("y");
  const netMid = o.avg_net_price_48_to_75k;
  if (meets) {
    return (
      <span className="chip fit-top" title="Meets 100% of demonstrated financial need">
        Meets full need{netMid != null ? ` · ${fmtCost(netMid)} @ $48-75k` : ""}
      </span>
    );
  }
  if (netMid != null) {
    return <span className="chip chip-outline num" title="IPEDS average net price for $48-75k family income">{fmtCost(netMid)} @ $48-75k</span>;
  }
  return null;
}

export function SourceLinks({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {urls.slice(0,4).map((u,i) => (
        <a key={i} href={u} target="_blank" rel="noreferrer noopener"
          className="text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--accent))] inline-flex items-center gap-0.5">
          source {i+1} <ExternalLink size={9} />
        </a>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * ABET accreditation badge for robotics-titled credentials.
 * EAC = engineering (theory track, cleanest path to grad school / PE).
 * ETAC = engineering technology (applied; grad-school and licensure friction).
 * CAC = computing. NOT_ABET_ACCREDITED is common and fine at strong CS schools.
 * ------------------------------------------------------------------ */

const ABET_META: Record<string, { label: string; hue: string; blurb: string }> = {
  EAC: {
    label: "ABET EAC — engineering",
    hue: "var(--fit-strong)",
    blurb: "Accredited as an engineering degree: theory and calculus-heavy, the cleanest route to engineering graduate school and PE licensure.",
  },
  ETAC: {
    label: "ABET ETAC — engineering technology",
    hue: "var(--fit-lower)",
    blurb: "Accredited as engineering technology: applied and hands-on rather than theory-heavy. Can mean catch-up coursework for engineering graduate school, and PE licensure rules vary by state.",
  },
  CAC: {
    label: "ABET CAC — computing",
    hue: "var(--fit-top)",
    blurb: "Accredited as a computing program rather than an engineering one. Fine for software and AI paths; not an engineering-licensure route.",
  },
  NOT_ABET_ACCREDITED: {
    label: "No ABET accreditation",
    hue: "var(--fit-top)",
    blurb: "This degree has not sought ABET accreditation. Materially different from engineering technology: the curriculum is still theory-heavy, so engineering graduate school is unaffected. The one real consequence is that it is not a route to PE licensure.",
  },
  "n.a.": {
    label: "Accreditation unverified",
    hue: "var(--score-unk)",
    blurb: "No first-party accreditation statement was found for this credential. Confirm with the department before relying on it.",
  },
};

export function AbetBadge({ credential, compact }:
  { credential?: School["robotics_credential"]; compact?: boolean }) {
  if (!credential) return null;
  const meta = ABET_META[credential.abet_commission] ?? ABET_META["n.a."];
  const title = [
    credential.program_name,
    meta.blurb,
    credential.abet_evidence_quote ? `Source states: "${credential.abet_evidence_quote}"` : null,
    credential.eac_alternative ? `EAC alternative at this school: ${credential.eac_alternative}` : null,
    credential.notes,
  ].filter(Boolean).join("\n\n");

  return (
    <span
      className="chip text-[10.5px] py-0 whitespace-nowrap"
      style={{
        color: `hsl(${meta.hue})`,
        borderColor: `hsl(${meta.hue} / 0.5)`,
        background: `hsl(${meta.hue} / 0.08)`,
      }}
      title={title}
    >
      {compact ? credential.abet_commission.replace("NOT_ABET_ACCREDITED", "No ABET") : meta.label}
    </span>
  );
}

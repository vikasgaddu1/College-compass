import { useMemo, useState } from "react";
import { schools, School } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import deadlinesData from "@/data/deadlines.json";
import { FitBadge, HideButton } from "@/components/SchoolBits";
import { ExternalLink, Info } from "lucide-react";

interface DeadlineRow {
  slug: string;
  cycle_label: string;                // "2026-27" or "2025-26 previous cycle"
  ed1?: string | null;
  ed2?: string | null;
  ea?: string | null;
  rea_scea?: string | null;
  rd?: string | null;
  rolling?: string | null;
  notify_ed1?: string | null;
  notify_ed2?: string | null;
  notify_ea?: string | null;
  notify_rd?: string | null;
  aid_priority?: string | null;
  source_url?: string | null;
}

type Round = "ed1" | "ed2" | "ea" | "rea_scea" | "rd" | "aid_priority";

const roundMeta: { key: Round; label: string; short: string; color: string }[] = [
  { key: "ed1",          label: "Early Decision I",      short: "ED I",   color: "hsl(var(--fit-lower))" },
  { key: "ed2",          label: "Early Decision II",     short: "ED II",  color: "hsl(var(--fit-conditional))" },
  { key: "rea_scea",     label: "Restrictive / Single-Choice EA", short: "REA/SCEA", color: "hsl(var(--chart-5))" },
  { key: "ea",           label: "Early Action",          short: "EA",     color: "hsl(var(--fit-strong))" },
  { key: "rd",           label: "Regular Decision",      short: "RD",     color: "hsl(var(--primary))" },
  { key: "aid_priority", label: "Financial aid priority",short: "Aid",    color: "hsl(var(--accent))" },
];

// Timeline runs Aug 2026 → Jun 2027 for a Fall 2027 entry
const months = [
  { m: 8,  y: 2026, label: "Aug" },
  { m: 9,  y: 2026, label: "Sep" },
  { m: 10, y: 2026, label: "Oct" },
  { m: 11, y: 2026, label: "Nov" },
  { m: 12, y: 2026, label: "Dec" },
  { m: 1,  y: 2027, label: "Jan" },
  { m: 2,  y: 2027, label: "Feb" },
  { m: 3,  y: 2027, label: "Mar" },
  { m: 4,  y: 2027, label: "Apr" },
  { m: 5,  y: 2027, label: "May" },
  { m: 6,  y: 2027, label: "Jun" },
];

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === "—" || s.toLowerCase().startsWith("n.a") || s.toLowerCase() === "none" || s.toLowerCase() === "rolling") return null;
  // Try common formats: "November 1, 2026", "Jan 3", "2026-11-01"
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const long = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/.exec(s);
  if (long) {
    const mo = monthIx(long[1]);
    const d = +long[2];
    const y = long[3] ? +long[3] : inferYear(mo);
    if (mo != null) return new Date(y, mo, d);
  }
  // "1 November 2026"
  const dLong = /^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/.exec(s);
  if (dLong) {
    const mo = monthIx(dLong[2]);
    const d = +dLong[1];
    const y = dLong[3] ? +dLong[3] : inferYear(mo);
    if (mo != null) return new Date(y, mo, d);
  }
  return null;
}
function monthIx(name: string): number | null {
  const n = name.toLowerCase().slice(0,3);
  const list = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const ix = list.indexOf(n);
  return ix < 0 ? null : ix;
}
function inferYear(mo: number | null): number {
  if (mo == null) return 2026;
  return mo >= 7 ? 2026 : 2027;   // Aug-Dec → 2026, Jan-Jun → 2027
}

function toXPct(d: Date): number | null {
  const start = new Date(2026, 7, 1);  // Aug 1 2026
  const end   = new Date(2027, 5, 30); // Jun 30 2027
  const t = d.getTime();
  if (t < start.getTime() || t > end.getTime()) return null;
  return ((t - start.getTime()) / (end.getTime() - start.getTime())) * 100;
}

export default function TimelinePage() {
  const { hidden } = useHidden();
  const [enabledRounds, setEnabledRounds] = useState<Round[]>(["ed1","ed2","ea","rea_scea","rd"]);

  const bySlug = useMemo(() => {
    const m: Record<string, DeadlineRow> = {};
    (deadlinesData.rows || []).forEach((r: DeadlineRow) => { m[r.slug] = r; });
    return m;
  }, []);

  const missing = schools.filter(s => !bySlug[s.slug] && !hidden.has(s.slug)).length;
  const rowsToShow = schools.filter(s => !hidden.has(s.slug));

  // Sort by earliest deadline shown
  rowsToShow.sort((a,b) => {
    const da = earliest(bySlug[a.slug], enabledRounds);
    const db = earliest(bySlug[b.slug], enabledRounds);
    if (!da && !db) return a.short.localeCompare(b.short);
    if (!da) return 1;
    if (!db) return -1;
    return da.getTime() - db.getTime();
  });

  const toggleRound = (r: Round) =>
    setEnabledRounds(e => e.includes(r) ? e.filter(x=>x!==r) : [...e, r]);

  const hasData = (deadlinesData.rows || []).length > 0;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="serif text-[17px] font-semibold mb-1">Application timeline · {deadlinesData.cycle}</div>
        <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-3xl">
          Every deadline is plotted on a single Aug 2026 → June 2027 timeline so you can see when each school's ED, ED II, EA, REA/SCEA, and RD windows land relative to one another. Toggle rounds off to declutter, or hide schools to focus.
        </div>
      </div>

      {!hasData && (
        <div className="card p-4 border-l-4 border-l-[hsl(var(--accent))]">
          <div className="flex items-start gap-2 text-[12.5px]">
            <Info size={14} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]"/>
            <div>
              <strong>{deadlinesData.note || "Deadline data is still being verified."}</strong>
              <br/>
              The timeline structure and controls are live below. Each school's actual dates will populate when the fetch of official admissions pages finishes.
            </div>
          </div>
        </div>
      )}

      {/* Round toggles */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-[hsl(var(--muted-foreground))]">Rounds shown:</span>
          {roundMeta.map(r => (
            <button key={r.key}
              onClick={()=>toggleRound(r.key)}
              className={`chip ${enabledRounds.includes(r.key) ? "" : "chip-outline opacity-60"} hover:bg-[hsl(var(--elevate-1))]`}
              style={enabledRounds.includes(r.key) ? { background: r.color, color: "white", borderColor: r.color } : undefined}>
              <span className="dot" style={{ background: r.color }} /> {r.short}
            </button>
          ))}
        </div>
      </div>

      {/* The timeline grid */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            {/* Month header */}
            <div className="grid" style={{ gridTemplateColumns: "220px 1fr 24px" }}>
              <div className="p-2 text-[11px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider">School</div>
              <div className="relative border-l border-b border-[hsl(var(--border))]">
                <div className="grid" style={{ gridTemplateColumns: `repeat(${months.length}, 1fr)` }}>
                  {months.map(m => (
                    <div key={`${m.y}-${m.m}`} className="p-2 text-[11px] text-[hsl(var(--muted-foreground))] border-r border-[hsl(var(--border))] text-center">
                      {m.label}<span className="text-[9px] ml-0.5">'{String(m.y).slice(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div />
            </div>

            {/* Rows */}
            {rowsToShow.map(s => {
              const d = bySlug[s.slug];
              return (
                <div key={s.slug} className="grid items-center border-b border-[hsl(var(--border))]/60 hover:bg-[hsl(var(--elevate-1))]"
                  style={{ gridTemplateColumns: "220px 1fr 24px" }}>
                  <div className="p-2">
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0">
                        <div className="serif text-[13px] font-medium truncate">{s.short}</div>
                        <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] truncate">{s.city_state}</div>
                      </div>
                    </div>
                  </div>
                  <div className="relative border-l border-[hsl(var(--border))]" style={{ height: 42 }}>
                    {/* month grid lines */}
                    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${months.length}, 1fr)` }}>
                      {months.map(m => <div key={m.m} className="border-r border-[hsl(var(--border))]/40" />)}
                    </div>
                    {d ? enabledRounds.map(r => {
                      const raw = (d as any)[r] as string | null | undefined;
                      const dt = parseDate(raw);
                      if (!dt) return null;
                      const x = toXPct(dt);
                      if (x == null) return null;
                      const meta = roundMeta.find(m => m.key === r)!;
                      return (
                        <div key={r} className="absolute top-1/2 -translate-y-1/2 group"
                          style={{ left: `calc(${x}% - 6px)`, width: 12, height: 12 }}>
                          <div className="w-3 h-3 rounded-full ring-2 ring-white shadow-sm"
                            style={{ background: meta.color }} />
                          <div className="pointer-events-none absolute z-10 -top-2 left-4 whitespace-nowrap px-2 py-1 rounded bg-[hsl(var(--foreground))] text-[hsl(var(--background))] text-[11px] opacity-0 group-hover:opacity-100 transition-opacity">
                            {meta.short}: {raw}
                          </div>
                        </div>
                      );
                    }) : (
                      <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[hsl(var(--muted-foreground))]">
                        deadlines pending
                      </div>
                    )}
                  </div>
                  <div className="pr-1"><HideButton slug={s.slug} compact /></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detail table */}
      {hasData && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="dense w-full">
              <thead>
                <tr>
                  <th>School</th>
                  <th>Cycle</th>
                  {roundMeta.map(r => <th key={r.key}>{r.short}</th>)}
                  <th>Rolling / notes</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rowsToShow.map(s => {
                  const d = bySlug[s.slug];
                  if (!d) return null;
                  const stale = d.cycle_label && d.cycle_label.toLowerCase().includes("previous");
                  return (
                    <tr key={s.slug}>
                      <td className="serif font-medium">{s.short}</td>
                      <td>
                        {stale ? <span className="chip fit-conditional">{d.cycle_label}</span> : <span className="chip fit-top">{d.cycle_label}</span>}
                      </td>
                      {roundMeta.map(r => (
                        <td key={r.key} className="text-[11.5px] whitespace-nowrap">{(d as any)[r.key] || "—"}</td>
                      ))}
                      <td className="text-[11.5px]">{d.rolling || "—"}</td>
                      <td>
                        {d.source_url ? (
                          <a href={d.source_url} target="_blank" rel="noreferrer noopener"
                            className="text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--accent))] inline-flex items-center gap-0.5">
                            official <ExternalLink size={9}/>
                          </a>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {missing > 0 && hasData && (
        <div className="text-[11.5px] text-[hsl(var(--muted-foreground))]">
          {missing} school{missing>1?"s":""} in view do not have verified deadline data yet.
        </div>
      )}
    </div>
  );
}

function earliest(d: DeadlineRow | undefined, rounds: Round[]): Date | null {
  if (!d) return null;
  let earliest: Date | null = null;
  for (const r of rounds) {
    const parsed = parseDate((d as any)[r]);
    if (parsed && (!earliest || parsed < earliest)) earliest = parsed;
  }
  return earliest;
}

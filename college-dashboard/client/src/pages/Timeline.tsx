import { useMemo, useState } from "react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import deadlinesData from "@/data/deadlines.json";
import { HideButton, PlanBadge } from "@/components/SchoolBits";
import { applications, applicationsBySlug } from "@/lib/applications";
import { ExternalLink, Info } from "lucide-react";
import { todayIso, daysUntil, dateUTC } from "@/lib/calendar";

interface DeadlineEvent {
  round: Round; label: string; date: string; source_url: string; verified_on: string; cycle: string; year_inferred?: boolean;
}

interface DeadlineRow {
  events?: DeadlineEvent[];
  verified_on?: string;
  verification_status?: string;
  cycle_inferred?: boolean;
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

type Round = "ed1" | "ed2" | "ea" | "rea_scea" | "rd" | "aid_priority" | "materials" | "scholarship";

const roundMeta: { key: Round; label: string; short: string; color: string }[] = [
  { key: "ed1",          label: "Early Decision I",      short: "ED I",   color: "hsl(var(--fit-lower))" },
  { key: "ed2",          label: "Early Decision II",     short: "ED II",  color: "hsl(var(--fit-conditional))" },
  { key: "rea_scea",     label: "Restrictive / Single-Choice EA", short: "REA/SCEA", color: "hsl(var(--chart-5))" },
  { key: "ea",           label: "Early Action",          short: "EA",     color: "hsl(var(--fit-strong))" },
  { key: "rd",           label: "Regular Decision",      short: "RD",     color: "hsl(var(--primary))" },
  { key: "aid_priority", label: "Financial aid priority",short: "Aid",    color: "hsl(var(--accent))" },
  { key: "materials", label: "Supporting materials", short: "Materials", color: "hsl(var(--chart-5))" },
  { key: "scholarship", label: "Scholarship deadline", short: "Scholarship", color: "hsl(var(--accent))" },
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

// Plot only sourced current-cycle events; legacy prose stays visible as reference.
function currentEvents(row: DeadlineRow | undefined): DeadlineEvent[] {
  return (row?.events ?? []).filter(e => /^202[67]-\d{2}-\d{2}$/.test(e.date)
    && Boolean(e.source_url && e.verified_on) && /2027|2026.?27/.test(e.cycle));
}

function toXPct(d: Date): number | null {
  const start = dateUTC("2026-08-01");  // Aug 1 2026
  const end   = dateUTC("2027-06-30"); // Jun 30 2027
  const t = d.getTime();
  if (t < start.getTime() || t > end.getTime()) return null;
  return ((t - start.getTime()) / (end.getTime() - start.getTime())) * 100;
}

export default function TimelinePage() {
  const { hidden } = useHidden();
  const today = todayIso();
  const [enabledRounds, setEnabledRounds] = useState<Round[]>(["ed1","ed2","ea","rea_scea","rd"]);

  const bySlug = useMemo(() => {
    const m: Record<string, DeadlineRow> = {};
    (deadlinesData.rows || []).forEach(r => { m[r.slug] = r as DeadlineRow; });
    return m;
  }, []);

  const missing = schools.filter(s => !currentEvents(bySlug[s.slug]).length && !hidden.has(s.slug)).length;
  const rowsToShow = schools.filter(s => !hidden.has(s.slug));

  // Sort by earliest deadline shown
  // Pin Anurag's applications on top, then sort by earliest deadline shown
  rowsToShow.sort((a,b) => {
    const pa = applicationsBySlug[a.slug], pb = applicationsBySlug[b.slug];
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    if (pa && pb) return (pa.deadline ?? "9999-12-31").localeCompare(pb.deadline ?? "9999-12-31") || a.short.localeCompare(b.short);
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
          Every deadline is plotted on a single Aug 2026 → June 2027 timeline so you can see when each school's ED, ED II, EA, REA/SCEA, and RD windows land relative to one another. Sourced deadline dates are plotted; dates whose cycle year is inferred are marked with ~. Reference dates with a pending cycle stay in the table. Today: {today} (America/New_York). Toggle rounds off to declutter, or hide schools to focus.
        </div>
      </div>

      {/* My applications */}
      {applications.length > 0 && (
        <div className="card p-4 border-l-4 border-l-[hsl(var(--primary))]">
          <div className="serif text-[15px] font-semibold mb-2">My applications</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {[...applications].sort((a,b)=>(a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31")).map(a => {
              const s = schools.find(x => x.slug === a.slug);
              const d = bySlug[a.slug];
              const verified = currentEvents(d).find(e => e.round === a.round && e.date === a.deadline && !e.year_inferred && !d?.cycle_inferred);
              const days = a.deadline ? daysUntil(a.deadline, today) : null;
              return (
                <div key={a.slug} className="rounded border border-[hsl(var(--border))] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="serif text-[14px] font-medium truncate">{s?.short ?? a.slug}</div>
                    <PlanBadge slug={a.slug} />
                  </div>
                  <div className="text-[12px] mt-1">
                    {a.plan_label}{a.binding ? " (binding)" : ""} · {a.deadline ? "due " : ""}<strong>{a.deadline_label}</strong>
                    {verified && days !== null && <span className="text-[hsl(var(--muted-foreground))]"> · {days < 0 ? `${-days} days past` : days === 0 ? "today" : `${days} day${days===1?"":"s"} left`}</span>}
                  </div>
                  {d?.aid_priority && <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">Aid: {d.aid_priority}</div>}
                  {(!verified || a.note) && <div className="mt-1"><span className="chip fit-conditional">{a.plan === "PENDING" ? "Round and deadline unconfirmed" : !verified ? "Saved plan date · cycle confirmation pending" : a.note}</span>{a.plan === "PENDING" && a.note && <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">{a.note}</div>}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
              const app = applicationsBySlug[s.slug];
              return (
                <div key={s.slug} className={`grid items-center border-b border-[hsl(var(--border))]/60 hover:bg-[hsl(var(--elevate-1))] ${app ? "bg-[hsl(var(--elevate-1))] border-l-4 border-l-[hsl(var(--primary))]" : ""}`}
                  style={{ gridTemplateColumns: "220px 1fr 24px" }}>
                  <div className="p-2">
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0">
                        <div className="serif text-[13px] font-medium truncate flex items-center gap-1">{s.short}{app && <PlanBadge slug={s.slug} />}</div>
                        <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] truncate">{s.city_state}</div>
                      </div>
                    </div>
                  </div>
                  <div className="relative border-l border-[hsl(var(--border))]" style={{ height: 62 }}>
                    {/* month grid lines */}
                    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${months.length}, 1fr)` }}>
                      {months.map(m => <div key={m.m} className="border-r border-[hsl(var(--border))]/40" />)}
                    </div>
                    {currentEvents(d).length ? currentEvents(d).filter(e => enabledRounds.includes(e.round)).map((event, i) => {
                      const x = toXPct(dateUTC(event.date));
                      if (x == null) return null;
                      const meta = roundMeta.find(m => m.key === event.round);
                      if (!meta) return null;
                      const mine = app?.round === event.round && app.deadline === event.date;
                      return (
                        <div key={`${event.round}-${event.date}-${i}`} className={`absolute group ${mine ? "z-[5]" : ""}`}
                          style={{ left: `calc(${x}% - 6px)`, top: 8 + (i % 3) * 16, width: 12, height: 12 }}>
                          <a href={event.source_url} target="_blank" rel="noreferrer noopener" aria-label={`${s.short} ${event.label}: ${event.date}`}
                            className={`block w-3 h-3 rounded-full ring-2 shadow-sm ${mine ? "ring-[hsl(var(--foreground))] scale-125" : "ring-white"}`}
                            style={{ background: meta.color, opacity: event.year_inferred || d?.cycle_inferred ? 0.65 : 1, outline: event.year_inferred || d?.cycle_inferred ? "1px dashed currentColor" : undefined }} />
                          <div className="pointer-events-none absolute z-10 -top-2 left-4 whitespace-nowrap px-2 py-1 rounded bg-[hsl(var(--foreground))] text-[hsl(var(--background))] text-[11px] opacity-0 group-hover:opacity-100 transition-opacity">
                            {event.label}: {event.date}{event.year_inferred || d?.cycle_inferred ? " · cycle year inferred" : ""} · checked {event.verified_on}{mine ? " · saved application" : ""}
                          </div>
                        </div>
                      );
                    }) : (
                      <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[hsl(var(--muted-foreground))]">
                        current-cycle deadlines pending
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
                  const verified = currentEvents(d);
                  const stale = verified.length === 0 || d.cycle_inferred || verified.some(e => e.year_inferred);
                  return (
                    <tr key={s.slug}>
                      <td className="serif font-medium"><span className="inline-flex items-center gap-1">{s.short}<PlanBadge slug={s.slug} /></span></td>
                      <td>
                        <span className={`chip ${stale ? "fit-conditional" : "fit-top"}`}>{d.cycle_label} · {stale ? verified.length ? "year inferred" : "pending verification" : `verified ${d.verified_on || verified[0]?.verified_on}`}</span>
                      </td>
                      {roundMeta.map(r => (
                        <td key={r.key} className={`text-[11.5px] whitespace-nowrap ${applicationsBySlug[s.slug]?.round === r.key ? "font-semibold bg-[hsl(var(--elevate-2))]" : ""}`}>{verified.filter(e => e.round === r.key).length ? verified.filter(e => e.round === r.key).map((e, i) => <div key={`${e.date}-${i}`}>{e.label}: {e.date}{e.year_inferred || d.cycle_inferred ? " ~ (year inferred)" : ""}</div>) : (d as any)[r.key] ? <span className="text-[hsl(var(--muted-foreground))]">{(d as any)[r.key]} · reference / unverified</span> : "—"}</td>
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
          {missing} school{missing>1?"s":""} in view do not have sourced deadline events yet. Cycle-year inference is marked separately.
        </div>
      )}
    </div>
  );
}

function earliest(d: DeadlineRow | undefined, rounds: Round[]): Date | null {
  const dates = currentEvents(d).filter(e => rounds.includes(e.round)).map(e => e.date).sort();
  return dates.length ? dateUTC(dates[0]) : null;
}

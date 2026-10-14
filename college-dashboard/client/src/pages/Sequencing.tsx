import { useMemo, useState } from "react";
import { GitBranch, AlertTriangle, Info, Trophy, Plus, Trash2 } from "lucide-react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import deadlinesData from "@/data/deadlines.json";
import { dateUTC, daysUntil } from "@/lib/calendar";
import { applicationsBySlug } from "@/lib/applications";

type PlanKind = "ED I" | "ED II" | "EA" | "RD";
interface Event {
  slug: string; short: string; plan: PlanKind;
  deadline: string;            // ISO
  notify: string | null;       // ISO
  deadlineText?: string;       // original prose, for tooltips
  notifyText?: string;
  label?: string;
  approx?: boolean;            // date was fuzzy ("mid-December") and got snapped
}

// FRC bands (approx US High-School FIRST Robotics season)
const FRC_BANDS = [
  { label: "Kickoff + Build season", start: "01-04", end: "02-22", color: "hsl(200 55% 55% / 0.15)", stroke: "hsl(200 55% 45%)" },
  { label: "Competition season",     start: "02-28", end: "04-25", color: "hsl(30 75% 55% / 0.18)",  stroke: "hsl(30 75% 45%)"  },
  { label: "FIRST Championship",     start: "04-16", end: "04-20", color: "hsl(0 75% 50% / 0.22)",   stroke: "hsl(0 75% 40%)"   },
];

const PLAN_COLORS: Record<PlanKind, string> = {
  "ED I": "hsl(0 65% 42%)",
  "ED II": "hsl(0 55% 50%)",
  "EA":    "hsl(200 65% 40%)",
  "RD":    "hsl(145 45% 35%)",
};

export default function SequencingPage() {
  const { hidden } = useHidden();
  const visible = schools.filter(s => !hidden.has(s.slug));
  const [onlySelectedPlans, setOnlySelectedPlans] = useState(true);
  const [teamEvents, setTeamEvents] = useState<{ id: string; label: string; date: string }[]>(() => {
    try { return JSON.parse(window.localStorage.getItem("frc-team-events") || "[]"); } catch { return []; }
  });
  const saveTeamEvents = (next: typeof teamEvents) => { setTeamEvents(next); window.localStorage.setItem("frc-team-events", JSON.stringify(next)); };

  // Flatten decision events
  const events = useMemo(() => {
    const out: Event[] = [];
    visible.forEach(s => {
      const row = (deadlinesData.rows as any[]).find(r => r.slug === s.slug);
      const dd = s.admissions?.decision_dates as any;
      if (!row || !dd) return;
      const plans: Record<string, PlanKind> = { ed1: "ED I", ed2: "ED II", ea: "EA", rd: "RD" };
      (row.events ?? []).forEach((e: any) => {
        const selected = applicationsBySlug[s.slug];
        if (onlySelectedPlans && (!selected || selected.round !== e.round || selected.deadline !== e.date)) return;
        const plan = plans[e.round];
        if (!plan || !e.source_url || !e.verified_on || !/2027|2026.?27/.test(e.cycle ?? "")) return;
        const notifyText = dd[`${e.round}_notify`] as string | undefined;
        // A window such as "mid-December" is not an exact notification day.
        // EA II is a separate event; do not reuse the EA I notification.
        const exactNotify = !/mid|late|early|by|before|after|;|\(EA/i.test(notifyText ?? "")
          && !dd[`${e.round}_notify_approx`]
          && !(e.round === "ea" && /II|2/.test(e.label));
        out.push({ slug: s.slug, short: s.short, plan, label: onlySelectedPlans ? selected.plan_short ?? selected.plan_label : e.label,
          deadline: e.date, notify: exactNotify ? dd[`${e.round}_notify_iso`] ?? null : null,
          deadlineText: `${e.label}: ${e.date}`, notifyText,
          approx: Boolean(e.year_inferred || row.cycle_inferred),
        });
      });
    });
    return out.sort((a, b) => a.deadline.localeCompare(b.deadline));
  }, [visible, onlySelectedPlans]);

  // Compute earliest & latest dates in the visible plan
  const bounds = useMemo(() => {
    const dates: string[] = teamEvents.map(e => e.date);
    events.forEach(e => { dates.push(e.deadline); if (e.notify) dates.push(e.notify); });
    if (dates.length === 0) return { start: "2026-09-01", end: "2027-05-15" };
    const sorted = [...dates].sort();
    return { start: earlier(sorted[0], "2026-09-01"), end: later(sorted[sorted.length-1], "2027-05-15") };
  }, [events, teamEvents]);

  const timelineDays = Math.max(1, daysBetween(bounds.start, bounds.end));
  const xForDate = (isoDate: string) => {
    const d = daysBetween(bounds.start, isoDate);
    return (d / timelineDays) * 100;   // percentage
  };

  // Identify conflicts: an ED I notify falling AFTER an ED II or RD deadline elsewhere; or EA/RD deadlines
  // falling inside FRC bands (in the same calendar year window).
  const conflicts = useMemo(() => {
    const out: string[] = [];
    const ed1 = events.filter(e => e.plan === "ED I");
    const ed2 = events.filter(e => e.plan === "ED II");
    ed1.forEach(a => {
      if (!a.notify) return;
      ed2.forEach(b => {
        if (a.slug !== b.slug && b.deadline < a.notify!) {
          out.push(`${a.short} ED I notifies ${a.notify} — AFTER ${b.short} ED II deadline ${b.deadline}. Prepare the second application while the first decision is pending; confirm the notification date.`);
        }
      });
    });
    // RD deadlines that land before an ED I notification (same risk, different plan)
    const rd = events.filter(e => e.plan === "RD");
    ed1.forEach(a => {
      if (!a.notify) return;
      rd.forEach(b => {
        if (a.slug !== b.slug && b.deadline < a.notify!) {
          out.push(`${a.short} ED I notifies ${a.notify} — AFTER ${b.short} RD deadline ${b.deadline}. You must submit that RD application before knowing the ED I outcome.`);
        }
      });
    });
    // deadlines inside FRC bands
    events.forEach(e => {
      const md = e.deadline.slice(5); // MM-DD
      FRC_BANDS.forEach(b => {
        if (md >= b.start && md <= b.end) {
          out.push(`${e.short} ${e.plan} deadline ${e.deadline} falls inside the illustrative FRC ${b.label} window; confirm the actual team calendar.`);
        }
      });
    });
    return out;
  }, [events]);

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
          <GitBranch size={16}/>
          <div className="text-[11px] tracking-wider uppercase">Sequencing & FRC overlay</div>
        </div>
        <h2 className="serif text-[22px] font-semibold mt-1">The application calendar as a dependency graph</h2>
        <p className="text-[13px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed max-w-[820px]">
          Vertical bands are illustrative FIRST Robotics season windows, not a confirmed event calendar. Sourced application dates are plotted; ~ marks an inferred cycle year. Only exact notification days are plotted, and published windows remain in tooltips. Add your team's confirmed dates below; verify round timing before using a dependency warning.
        </p>
        <label className="mt-3 flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={onlySelectedPlans} onChange={e => setOnlySelectedPlans(e.target.checked)} />
          Show only my selected application plans
        </label>
      </div>

      {/* Team events editor */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] tracking-wider uppercase text-[hsl(var(--muted-foreground))]">Team-specific FRC events</div>
          <TeamEventForm onAdd={(e) => saveTeamEvents([...teamEvents, { ...e, id: Math.random().toString(36).slice(2,8) }])}/>
        </div>
        {teamEvents.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {teamEvents.map(t => (
              <li key={t.id} className="chip chip-outline inline-flex items-center gap-1 text-[11px]">
                <Trophy size={10}/> {t.label} · {t.date}
                <button onClick={() => saveTeamEvents(teamEvents.filter(x => x.id !== t.id))} className="ml-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--fit-lower))]"><Trash2 size={10}/></button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] italic">Add team competition dates (regionals, district events) to see them on the timeline.</div>
        )}
      </div>

      {/* Timeline */}
      <div className="card p-4">
        <div className="text-[11px] tracking-wider uppercase text-[hsl(var(--muted-foreground))] mb-2">
          Timeline · {bounds.start} → {bounds.end}
        </div>
        <div className="relative border border-[hsl(var(--border))] rounded" style={{ height: `${Math.max(240, events.length * 22 + 60)}px` }}>
          {/* FRC bands */}
          {FRC_BANDS.map((b, i) => {
            const bandYear = 2027; // assume band inside cycle year
            const s = xForDate(`${bandYear}-${b.start}`);
            const e = xForDate(`${bandYear}-${b.end}`);
            return <div key={i} className="absolute top-0 bottom-0" style={{ left: `${s}%`, width: `${e-s}%`, background: b.color, borderLeft: `1px dashed ${b.stroke}`, borderRight: `1px dashed ${b.stroke}` }} title={b.label}/>;
          })}
          {/* Team events */}
          {teamEvents.map(t => (
            <div key={t.id} className="absolute top-0 bottom-0 w-[2px]" style={{ left: `${xForDate(t.date)}%`, background: "hsl(280 55% 45%)" }} title={`${t.label} · ${t.date}`}/>
          ))}
          {/* Month grid */}
          {monthTicks(bounds.start, bounds.end).map((m, i) => (
            <div key={i} className="absolute top-0 bottom-0 border-l border-[hsl(var(--border))/0.4]" style={{ left: `${xForDate(m.iso)}%` }}>
              <div className="absolute top-0 text-[9.5px] text-[hsl(var(--muted-foreground))] pl-1">{m.label}</div>
            </div>
          ))}
          {/* Events */}
          {events.map((ev, i) => {
            const y = 20 + i * 22;
            const xd = xForDate(ev.deadline);
            const xn = ev.notify ? xForDate(ev.notify) : null;
            return (
              <div key={`${ev.slug}-${ev.plan}-${ev.deadline}`} className="absolute" style={{ top: `${y}px`, left: 0, right: 0, height: 20 }}>
                {/* deadline → notify segment */}
                {xn !== null && (
                  <div className="absolute h-[2px] rounded" style={{ top: 8, left: `${xd}%`, width: `${xn - xd}%`, background: PLAN_COLORS[ev.plan], opacity: 0.4 }}/>
                )}
                {/* deadline dot */}
                <div className="absolute w-2 h-2 rounded-full" style={{ top: 7, left: `calc(${xd}% - 4px)`, background: PLAN_COLORS[ev.plan] }} title={`${ev.short} ${ev.plan} deadline: ${ev.deadlineText || ev.deadline}`}/>
                {/* notify triangle */}
                {xn !== null && (
                  <div className="absolute w-0 h-0" style={{ top: 5, left: `calc(${xn}% - 4px)`, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderRightWidth: 8, borderRightStyle: "solid", borderRightColor: PLAN_COLORS[ev.plan] }} title={`${ev.short} ${ev.plan} notify: ${ev.notifyText || ev.notify}`}/>
                )}
                {/* label */}
                <div className="absolute text-[10.5px] font-medium whitespace-nowrap" style={{ top: 1, left: `min(calc(${xd}% + 6px), calc(100% - 150px))`, color: PLAN_COLORS[ev.plan] }}>
                  {ev.short} <span className="opacity-70" title={ev.notifyText ? `Notification: ${ev.notifyText}` : "Notification date pending"}>{ev.label || ev.plan}</span>
                  {ev.approx && <span className="opacity-60" title="Published month/day mapped to this cycle; year inferred"> ~</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-3 text-[11px]">
          {(Object.entries(PLAN_COLORS) as [PlanKind, string][]).map(([k, c]) => (
            <div key={k} className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: c }}/> {k} deadline → notify</div>
          ))}
          <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "hsl(200 55% 55% / 0.15)", border: "1px dashed hsl(200 55% 45%)" }}/> FRC build</div>
          <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "hsl(30 75% 55% / 0.18)", border: "1px dashed hsl(30 75% 45%)" }}/> FRC comp</div>
          <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "hsl(0 75% 50% / 0.22)", border: "1px dashed hsl(0 75% 40%)" }}/> Championship</div>
        </div>
      </div>

      {/* Conflicts */}
      <div className="card p-4">
        <div className="text-[11px] tracking-wider uppercase text-[hsl(var(--muted-foreground))] mb-2">Advisory conflicts & dependencies</div>
        {conflicts.length === 0 ? (
          <div className="text-[12px] text-[hsl(var(--muted-foreground))] italic flex items-center gap-1"><Info size={12}/> No conflicts detected among plotted dates. Unpublished notification windows are not evaluated.</div>
        ) : (
          <ul className="space-y-1.5 text-[11.5px]">
            {conflicts.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5"><AlertTriangle size={11} className="mt-0.5 flex-shrink-0 text-[hsl(var(--fit-lower))]"/> {c}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TeamEventForm({ onAdd }: { onAdd: (e: { label: string; date: string }) => void }) {
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1">
      <input placeholder="Event name" value={label} onChange={e => setLabel(e.target.value)} className="px-2 py-0.5 text-[11px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded w-[130px]"/>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} className="px-1 py-0.5 text-[11px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"/>
      <button onClick={() => { if (!label || !date) return; onAdd({ label, date }); setLabel(""); setDate(""); }} className="chip chip-outline inline-flex items-center gap-0.5 text-[10.5px]"><Plus size={10}/> Add event</button>
    </div>
  );
}

// -- Date helpers --------------------------------------------------------

function daysBetween(a: string, b: string): number {
  return daysUntil(b, a);
}
function earlier(a: string, b: string): string { return a < b ? a : b; }
function later(a: string, b: string): string { return a > b ? a : b; }
function monthTicks(startISO: string, endISO: string): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  const s = dateUTC(startISO); s.setUTCDate(1);
  const e = dateUTC(endISO);
  const cur = new Date(s);
  while (cur <= e) {
    out.push({
      iso: `${cur.getUTCFullYear()}-${String(cur.getUTCMonth()+1).padStart(2,"0")}-01`,
      label: cur.toLocaleString(undefined, { month: "short", timeZone: "UTC" }) + (cur.getUTCMonth() === 0 ? ` '${String(cur.getUTCFullYear()).slice(2)}` : ""),
    });
    cur.setUTCMonth(cur.getUTCMonth()+1);
  }
  return out;
}

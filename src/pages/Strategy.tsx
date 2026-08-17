import { useMemo, useState } from "react";
import { Grid3x3, Calendar, Plus, Trash2, MapPin, Mail, MessageSquare } from "lucide-react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";

// C7 factors in Common Data Set order
const C7_FACTORS: { key: string; label: string }[] = [
  { key: "rigor",                 label: "Rigor of HS record" },
  { key: "class_rank",            label: "Class rank" },
  { key: "gpa",                   label: "Academic GPA" },
  { key: "test_scores",           label: "Standardized tests" },
  { key: "essay",                 label: "Application essay" },
  { key: "recommendations",       label: "Recommendations" },
  { key: "interview",             label: "Interview" },
  { key: "extracurriculars",      label: "Extracurriculars" },
  { key: "talent_ability",        label: "Talent / ability" },
  { key: "character",             label: "Character / qualities" },
  { key: "first_generation",      label: "First generation" },
  { key: "volunteer_work",        label: "Volunteer work" },
  { key: "work_experience",       label: "Work experience" },
  { key: "demonstrated_interest", label: "Demonstrated interest" },
];

const IMPORTANCE_COLOR: Record<string, string> = {
  very_important:  "hsl(200 75% 30%)",   // dark blue
  important:       "hsl(200 65% 50%)",   // medium blue
  considered:      "hsl(200 40% 78%)",   // light blue
  not_considered:  "hsl(0 0% 92%)",      // grey
};
const IMPORTANCE_LABEL: Record<string, string> = {
  very_important: "Very important",
  important: "Important",
  considered: "Considered",
  not_considered: "Not considered",
};

// -------- Interest log (localStorage-backed) --------
type InterestAction = "info_session" | "visit" | "rep_email" | "interview" | "open_house" | "tour" | "fair_meeting" | "other";
interface InterestEntry { id: string; slug: string; action: InterestAction; date: string; note: string; }
const LOG_KEY = "college-compass-interest-log";
function loadLog(): InterestEntry[] { try { return JSON.parse(window.localStorage.getItem(LOG_KEY) || "[]"); } catch { return []; } }
function saveLog(l: InterestEntry[]) { window.localStorage.setItem(LOG_KEY, JSON.stringify(l)); }

const ACTION_META: Record<InterestAction, { label: string; icon: any }> = {
  info_session: { label: "Info session", icon: Calendar },
  visit:        { label: "Campus visit", icon: MapPin },
  rep_email:    { label: "Rep email",    icon: Mail },
  interview:    { label: "Interview",    icon: MessageSquare },
  open_house:   { label: "Open house",   icon: Calendar },
  tour:         { label: "Tour",         icon: MapPin },
  fair_meeting: { label: "Fair meeting", icon: Calendar },
  other:        { label: "Other",        icon: Plus },
};

export default function StrategyPage() {
  const { hidden } = useHidden();
  const visible = schools.filter(s => !hidden.has(s.slug));
  const [log, setLog] = useState<InterestEntry[]>(loadLog);

  const trackers = useMemo(() =>
    visible.filter(s => {
      const c7 = (s as any).admissions?.c7_factors;
      if (!c7) return false;
      return c7.demonstrated_interest && c7.demonstrated_interest !== "not_considered";
    }),
    [visible]
  );

  const addEntry = (entry: Omit<InterestEntry, "id">) => {
    const next = [...log, { ...entry, id: Math.random().toString(36).slice(2, 10) }];
    setLog(next); saveLog(next);
  };
  const deleteEntry = (id: string) => {
    const next = log.filter(e => e.id !== id);
    setLog(next); saveLog(next);
  };

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
          <Grid3x3 size={16}/>
          <div className="text-[11px] tracking-wider uppercase">Strategy map</div>
        </div>
        <h2 className="serif text-[22px] font-semibold mt-1">Where each school actually looks — CDS Section C7</h2>
        <p className="text-[13px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed max-w-[820px]">
          Every US undergrad reports these 14 factors in Common Data Set C7. The heatmap below shows which schools weight essays vs rigor vs interest vs interview — a fast map of where to invest applicant effort. Below the heatmap: a demonstrated-interest tracker for schools where "level of applicant's interest" is above "not considered".
        </p>
      </div>

      {/* Legend */}
      <div className="card p-3 flex flex-wrap gap-3 text-[11.5px]">
        <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mr-1">Legend</div>
        {(["very_important","important","considered","not_considered"] as const).map(k => (
          <div key={k} className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: IMPORTANCE_COLOR[k] }}/> {IMPORTANCE_LABEL[k]}</div>
        ))}
      </div>

      {/* Heatmap */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="dense w-full">
            <thead>
              <tr>
                <th className="text-left sticky left-0 z-[2] bg-[hsl(var(--card))] w-[180px]">School</th>
                {C7_FACTORS.map(f => (
                  <th key={f.key} className="text-center px-1" style={{ minWidth: 46 }}>
                    <div className="text-[9.5px] leading-tight [writing-mode:vertical-rl] rotate-180 whitespace-nowrap py-2">{f.label}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(s => {
                const c7 = (s as any).admissions?.c7_factors;
                return (
                  <tr key={s.slug}>
                    <td className="serif font-medium sticky left-0 z-[1] bg-[hsl(var(--card))]">{s.short}</td>
                    {C7_FACTORS.map(f => {
                      const v = c7?.[f.key];
                      const c = v ? IMPORTANCE_COLOR[v] || "hsl(0 0% 88%)" : "hsl(0 0% 96%)";
                      return (
                        <td key={f.key} className="text-center p-0" title={`${s.short} — ${f.label}: ${IMPORTANCE_LABEL[v] || (v || "not reported")}`}>
                          <div className="w-full h-8" style={{ background: c }}/>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Demonstrated-interest tracker */}
      <div className="card p-4">
        <div className="text-[11px] tracking-wider uppercase text-[hsl(var(--muted-foreground))] mb-3">Demonstrated-interest tracker · schools that track interest</div>
        {trackers.length === 0 ? (
          <div className="text-[12px] text-[hsl(var(--muted-foreground))] italic">No schools in your visible list track demonstrated interest.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {trackers.map(s => {
              const entries = log.filter(e => e.slug === s.slug);
              return (
                <div key={s.slug} className="rounded-md border border-[hsl(var(--border))] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="serif font-medium text-[13.5px]">{s.short}</div>
                    <span className="chip chip-outline text-[10px]" style={{ color: IMPORTANCE_COLOR[(s as any).admissions?.c7_factors?.demonstrated_interest] }}>
                      {IMPORTANCE_LABEL[(s as any).admissions?.c7_factors?.demonstrated_interest] || "tracked"}
                    </span>
                  </div>
                  <AddEntryForm slug={s.slug} onAdd={addEntry}/>
                  {entries.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {entries.map(e => {
                        const Icon = ACTION_META[e.action].icon;
                        return (
                          <li key={e.id} className="flex items-start justify-between gap-2 py-1 text-[11.5px] border-b border-[hsl(var(--border))/0.5]">
                            <div className="flex items-start gap-1.5">
                              <Icon size={11} className="mt-0.5 flex-shrink-0 text-[hsl(var(--muted-foreground))]"/>
                              <div>
                                <div><strong>{ACTION_META[e.action].label}</strong> · {e.date || "—"}</div>
                                {e.note && <div className="text-[10.5px] text-[hsl(var(--muted-foreground))]">{e.note}</div>}
                              </div>
                            </div>
                            <button onClick={() => deleteEntry(e.id)} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--fit-lower))]"><Trash2 size={11}/></button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AddEntryForm({ slug, onAdd }: { slug: string; onAdd: (e: Omit<InterestEntry, "id">) => void }) {
  const [action, setAction] = useState<InterestAction>("info_session");
  const [date, setDate] = useState<string>("");
  const [note, setNote] = useState<string>("");
  return (
    <div className="flex flex-wrap gap-1 items-center">
      <select value={action} onChange={e => setAction(e.target.value as any)} className="px-1 py-0.5 text-[11px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded">
        {Object.entries(ACTION_META).map(([k,m]) => <option key={k} value={k}>{m.label}</option>)}
      </select>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} className="px-1 py-0.5 text-[11px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"/>
      <input type="text" placeholder="Note" value={note} onChange={e => setNote(e.target.value)} className="flex-1 min-w-[100px] px-1 py-0.5 text-[11px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded"/>
      <button onClick={() => { if (!date && !note) return; onAdd({ slug, action, date, note }); setDate(""); setNote(""); }} className="chip chip-outline inline-flex items-center gap-0.5 text-[10.5px]"><Plus size={10}/> Add</button>
    </div>
  );
}

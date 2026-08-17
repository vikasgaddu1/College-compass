import { useState, useMemo } from "react";
import { schools, School, scoreGroups, fmtCost, fmtEnroll, stripSourceTags } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { FitBadge, AccessBadge, ArchetypeChips, ShortlistPill, NoteButton, MyRatingChip } from "@/components/SchoolBits";
import { X, GitCompare, StickyNote, Bot, Wrench, ExternalLink, Trophy } from "lucide-react";
import { useNotes, statusLabel, hasContent } from "@/lib/notes";
import roboticsPaths from "@/data/robotics_paths.json";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Legend, Tooltip,
} from "recharts";

const MAX = 4;
const seriesColors = ["hsl(220 40% 22%)","hsl(15 85% 55%)","hsl(175 45% 42%)","hsl(262 45% 45%)"];

const rows: { label: string; get: (s: School) => any; }[] = [
  { label: "Location", get: s => s.city_state },
  { label: "Region", get: s => s.region },
  { label: "Institution type", get: s => s.institution_type },
  { label: "Undergrad enrollment", get: s => fmtEnroll(s.undergrad_enrollment) },
  { label: "Fit tier", get: s => <FitBadge fit={s.fit_classification} /> },
  { label: "Shortlist group", get: s => <ShortlistPill group={s.shortlist_group} /> },
  { label: "Degree", get: s => s.degree_name },
  { label: "Program archetype(s)", get: s => <ArchetypeChips codes={s.archetypes} /> },
  { label: "Major access", get: s => <AccessBadge status={s.major_access_status}/> },
  { label: "Access rules (detail)", get: s => s.major_access_full },
  { label: "Recommended route", get: s => s.recommended_major_route },
  { label: "Alternative route", get: s => s.alternative_route },
  { label: "Primary structural risk", get: s => s.primary_structural_risk },
  { label: "Notable AI institute", get: s => s.notable_ai_institute || "—" },
  { label: "UG research program", get: s => s.notable_undergraduate_research_program || "—" },
  { label: "4+1 available", get: s => `${s.fourplusone_available}${s.fourplusone_name ? " · " + s.fourplusone_name : ""}` },
  { label: "Cost (in-state)", get: s => fmtCost(s.cost_total_instate) },
  { label: "Cost (out-of-state / private)", get: s => fmtCost(s.cost_total_outofstate) },
  { label: "Cost for a NC resident", get: s => fmtCost(s.cost_for_nc_resident) },
  { label: "Meets full demonstrated need", get: s => s.outcomes?.meets_full_need || "n.a." },
  { label: "Need-blind admission", get: s => s.outcomes?.need_blind || "n.a." },
  { label: "Avg net price ($48-75k family)", get: s => fmtCost(s.outcomes?.avg_net_price_48_to_75k ?? null) },
  { label: "Avg institutional need grant", get: s => fmtCost(s.outcomes?.avg_need_grant ?? null) },
  { label: "4-year graduation rate", get: s => s.outcomes?.grad_rate_4yr != null ? `${s.outcomes.grad_rate_4yr}%` : "n.a." },
  { label: "6-year graduation rate", get: s => s.outcomes?.grad_rate_6yr != null ? `${s.outcomes.grad_rate_6yr}%` : "n.a." },
  { label: "Freshman retention", get: s => s.outcomes?.retention_rate != null ? `${s.outcomes.retention_rate}%` : "n.a." },
  { label: "Median CS starting salary", get: s => {
      const o = s.outcomes;
      if (!o?.cs_median_starting_salary) return "n.a.";
      return `${fmtCost(o.cs_median_starting_salary)}${o.cs_salary_scope ? " (" + o.cs_salary_scope + ")" : ""}`;
    } },
  { label: "Top CS/AI employers", get: s => (s.outcomes?.cs_top_employers?.slice(0,6).join(", ") || "n.a.") },
  { label: "Top grad-school destinations", get: s => (s.outcomes?.cs_top_grad_schools?.slice(0,5).join(", ") || "n.a.") },
  { label: "Travel from Raleigh (RDU)", get: s => s.distance_from_rdu },
  { label: "Housing guarantee", get: s => s.housing_guarantee },
  { label: "Greek participation", get: s => s.greek_participation },
  { label: "Sports influence", get: s => s.sports_influence },
  { label: "Rec center", get: s => s.recreation_center },
  { label: "Why here", get: s => stripSourceTags(s.best_fit_reason) },
  { label: "Biggest concern", get: s => stripSourceTags(s.biggest_concern) },
];

// Rows for the "my notes" strip, computed per-render from the notes context.
const noteRowMakers: { label: string; key: keyof import("@/lib/notes").SchoolNote | "status_label" | "rating_stars" | "visited_label" }[] = [
  { label: "My rating", key: "rating_stars" },
  { label: "My status", key: "status_label" },
  { label: "Visited", key: "visited_label" },
  { label: "My notes", key: "notes" },
  { label: "What I like", key: "pros" },
  { label: "What worries me", key: "cons" },
  { label: "Questions for the visit", key: "questions_for_visit" },
  { label: "My tags", key: "tags" },
];

export default function ComparePage() {
  const { hidden } = useHidden();
  const { getNote } = useNotes();
  const [picked, setPicked] = useState<string[]>([]);
  const [showNotes, setShowNotes] = useState(true);

  const available = useMemo(() =>
    schools.filter(s => !hidden.has(s.slug) && !picked.includes(s.slug))
      .sort((a,b) => a.short.localeCompare(b.short)),
  [hidden, picked]);

  const selected = picked.map(p => schools.find(s => s.slug === p)!).filter(Boolean);
  const add = (slug: string) => { if (picked.length < MAX) setPicked([...picked, slug]); };
  const remove = (slug: string) => setPicked(picked.filter(x => x !== slug));

  const radarData = useMemo(() => {
    return scoreGroups.map(g => {
      const row: any = { axis: g.short };
      selected.forEach(s => { row[s.short] = (s.axes as any)[g.key] ?? 0; });
      return row;
    });
  }, [selected]);

  return (
    <div className="space-y-4">
      <div className="card p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
            <GitCompare size={18}/>
          </div>
          <div className="flex-1">
            <div className="serif text-[18px] font-semibold">Side-by-side comparison</div>
            <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-2xl">
              Pick 2-4 schools. The radar shows their overall program shape; the table below lines up every field. Disagreeing rows highlight so differences pop.
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-[12px] text-[hsl(var(--muted-foreground))]">Selected ({selected.length}/{MAX}):</span>
          {selected.length === 0 && <span className="text-[12px] italic text-[hsl(var(--muted-foreground))]">none yet</span>}
          {selected.map((s, i) => (
            <span key={s.slug} className="chip chip-primary" style={{ background: seriesColors[i], color: "white", borderColor: seriesColors[i]}}>
              {s.short}
              <button onClick={()=>remove(s.slug)} className="ml-1 hover:opacity-80" title="Remove"><X size={11}/></button>
            </span>
          ))}
          {picked.length > 0 && (
            <button onClick={()=>setPicked([])} className="text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] ml-2 underline">
              Clear all
            </button>
          )}
        </div>
        {picked.length < MAX && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {available.map(s => (
              <button key={s.slug} onClick={()=>add(s.slug)}
                className="chip chip-outline hover:bg-[hsl(var(--elevate-1))]">+ {s.short}</button>
            ))}
          </div>
        )}
      </div>

      {selected.length >= 2 && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-4">
            {/* Radar */}
            <div className="card p-4">
              <div className="text-[13px] font-medium mb-1">Overall program shape</div>
              <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mb-3">Seven aggregate axes, each 0-5.</div>
              <ResponsiveContainer width="100%" height={360}>
                <RadarChart data={radarData} outerRadius="72%">
                  <PolarGrid stroke="hsl(var(--border))"/>
                  <PolarAngleAxis dataKey="axis" tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }}/>
                  <PolarRadiusAxis angle={90} domain={[0, 5]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickCount={6}/>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12, borderRadius: 6 }}/>
                  <Legend wrapperStyle={{ fontSize: 11 }}/>
                  {selected.map((s, i) => (
                    <Radar key={s.slug} name={s.short} dataKey={s.short}
                      stroke={seriesColors[i]} fill={seriesColors[i]} fillOpacity={0.15} strokeWidth={2}/>
                  ))}
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Verdict summary */}
            <div className="card p-4">
              <div className="text-[13px] font-medium mb-3">Headline reasons at a glance</div>
              <div className="space-y-3">
                {selected.map((s, i) => (
                  <div key={s.slug} className="border-l-2 pl-3" style={{ borderColor: seriesColors[i] }}>
                    <div className="serif text-[14px] font-semibold flex items-baseline gap-2">
                      {s.short}
                      <FitBadge fit={s.fit_classification}/>
                    </div>
                    <div className="text-[11.5px] text-[hsl(var(--accent))] mt-1.5 uppercase tracking-wider font-medium">Why choose</div>
                    <div className="text-[12.5px]">{stripSourceTags(s.best_fit_reason)}</div>
                    <div className="text-[11.5px] text-[hsl(var(--fit-lower))] mt-1.5 uppercase tracking-wider font-medium">Biggest concern</div>
                    <div className="text-[12.5px]">{stripSourceTags(s.biggest_concern)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* My-notes strip (opt-in) */}
          {selected.some(s => hasContent(getNote(s.slug))) && (
            <div className="card overflow-hidden">
              <div className="p-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StickyNote size={14} className="text-[hsl(var(--accent))]"/>
                  <div className="text-[13px] font-medium">Your notes on these schools</div>
                </div>
                <button onClick={()=>setShowNotes(v=>!v)}
                  className="text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] underline">
                  {showNotes ? "Hide" : "Show"}
                </button>
              </div>
              {showNotes && (
                <div className="overflow-x-auto">
                  <table className="dense w-full">
                    <thead>
                      <tr>
                        <th className="w-[220px] sticky left-0 z-[2]">My take</th>
                        {selected.map((s, i) => (
                          <th key={s.slug} className="serif font-semibold text-[13px]" style={{ color: seriesColors[i] }}>
                            <div className="flex items-center gap-1">{s.short}<NoteButton slug={s.slug}/></div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {noteRowMakers.map(r => {
                        const cells = selected.map(s => {
                          const n = getNote(s.slug);
                          if (!n) return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
                          if (r.key === "rating_stars") return n.rating ? "★".repeat(n.rating) + "☆".repeat(5-n.rating) : <span className="text-[hsl(var(--muted-foreground))]">—</span>;
                          if (r.key === "status_label") return n.status ? statusLabel[n.status] : <span className="text-[hsl(var(--muted-foreground))]">—</span>;
                          if (r.key === "visited_label") return n.visited ? "Yes" : <span className="text-[hsl(var(--muted-foreground))]">No</span>;
                          const v = (n as any)[r.key] as string;
                          return v?.trim() ? <div className="whitespace-pre-wrap">{v}</div> : <span className="text-[hsl(var(--muted-foreground))]">—</span>;
                        });
                        // Skip rows where nothing has content
                        const anyContent = cells.some(c => typeof c !== "object" || (c as any)?.props?.className !== "text-[hsl(var(--muted-foreground))]");
                        if (!anyContent) return null;
                        return (
                          <tr key={r.label}>
                            <td className="sticky left-0 bg-[hsl(var(--card))] font-medium text-[11.5px] text-[hsl(var(--muted-foreground))]">{r.label}</td>
                            {cells.map((c, i) => <td key={i} className="align-top text-[12.5px] leading-snug max-w-[280px]">{c}</td>)}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Robotics-paths strip */}
          <RoboticsPathsStrip selected={selected} seriesColors={seriesColors}/>

          {/* Diff table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="dense w-full">
                <thead>
                  <tr>
                    <th className="w-[220px] sticky left-0 z-[2]">Attribute</th>
                    {selected.map((s, i) => (
                      <th key={s.slug} className="serif font-semibold text-[14px]" style={{ color: seriesColors[i] }}>{s.short}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const vals = selected.map(s => r.get(s));
                    const strVals = vals.map(v => typeof v === "string" ? v : "");
                    const disagree = strVals.length > 1 && new Set(strVals).size > 1 && strVals.every(v => v !== "");
                    return (
                      <tr key={r.label} className={disagree ? "bg-[hsl(var(--accent)/0.05)]" : ""}>
                        <td className="sticky left-0 bg-[hsl(var(--card))] font-medium text-[11.5px] text-[hsl(var(--muted-foreground))]">{r.label}</td>
                        {vals.map((v,i) => (
                          <td key={i} className="align-top text-[12.5px] leading-snug max-w-[280px]">{v}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {selected.length < 2 && (
        <div className="card p-8 text-center text-[13px] text-[hsl(var(--muted-foreground))]">
          Pick at least two schools above to build a comparison.
        </div>
      )}
    </div>
  );
}

// -------------------- Robotics-paths comparison strip --------------------

function RoboticsPathsStrip({ selected, seriesColors }: { selected: School[]; seriesColors: string[] }) {
  const rows = selected.map(s => ({ s, d: (roboticsPaths.schools as any)[s.slug] }));
  // Only render if at least one selected school has any robotics data
  if (!rows.some(r => r.d)) return null;

  return (
    <div className="card overflow-hidden">
      <div className="p-3 border-b border-[hsl(var(--border))] flex items-center gap-2">
        <Bot size={14} className="text-[hsl(var(--accent))]"/>
        <div className="text-[13px] font-medium">Robotics paths at these schools</div>
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">CS-AI vs ME + Robotics vs dedicated BS Robotics</span>
      </div>
      <div className="overflow-x-auto">
        <table className="dense w-full">
          <thead>
            <tr>
              <th className="w-[200px] sticky left-0 z-[2]">Path attribute</th>
              {rows.map(({ s }, i) => (
                <th key={s.slug} className="serif font-semibold text-[13px]" style={{ color: seriesColors[i] }}>{s.short}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Row: dedicated BS */}
            <RoboRow label="Dedicated BS Robotics" rows={rows} render={({ d }) => {
              if (!d || !String(d.has_bs_robotics || "").startsWith("Yes")) {
                return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
              }
              return (
                <div className="space-y-0.5">
                  <div className="text-[12.5px] font-medium leading-tight">{d.bs_robotics_name}</div>
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    {d.bs_robotics_admit && (
                      <span className="chip chip-outline text-[10px] py-0" title="Admission mechanism">
                        {d.bs_robotics_admit === "Not published" ? "admit unpublished" : `${d.bs_robotics_admit} admit`}
                      </span>
                    )}
                    {d.bs_robotics_year_started && <span className="chip chip-outline text-[10px] py-0">est. {d.bs_robotics_year_started}</span>}
                    {d.bs_robotics_size && <span className="chip chip-outline text-[10px] py-0">{d.bs_robotics_size} majors</span>}
                  </div>
                  {d.bs_robotics_url && (
                    <a href={d.bs_robotics_url} target="_blank" rel="noopener"
                      className="text-[10px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">
                      Program page <ExternalLink size={8}/>
                    </a>
                  )}
                </div>
              );
            }}/>
            {/* Row: ME + Robotics track */}
            <RoboRow label="ME + Robotics track" rows={rows} render={({ d }) => {
              if (!d || !d.me_robotics_track_name) {
                return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
              }
              return (
                <div className="space-y-0.5">
                  <div className="text-[12.5px] font-medium leading-tight">{d.me_robotics_track_name}</div>
                  {d.me_robotics_courses && d.me_robotics_courses.length > 0 && (
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))] leading-snug">
                      {d.me_robotics_courses.slice(0, 3).join(" · ")}
                      {d.me_robotics_courses.length > 3 ? ` (+${d.me_robotics_courses.length - 3})` : ""}
                    </div>
                  )}
                  {d.me_robotics_url && (
                    <a href={d.me_robotics_url} target="_blank" rel="noopener"
                      className="text-[10px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">
                      Track page <ExternalLink size={8}/>
                    </a>
                  )}
                </div>
              );
            }}/>
            {/* Row: easier than CS? */}
            <RoboRow label="Easier than CS?" rows={rows} render={({ d }) => {
              if (!d || !d.robotics_easier_than_cs) {
                return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
              }
              const color =
                d.robotics_easier_than_cs === "Yes" ? "hsl(145 55% 35%)" :
                d.robotics_easier_than_cs === "No" ? "hsl(0 60% 45%)" :
                "hsl(30 60% 40%)";
              return (
                <div className="space-y-0.5">
                  <span className="chip chip-outline inline-flex items-center gap-1 text-[10.5px]" style={{ color }}>
                    <Trophy size={10}/> {d.robotics_easier_than_cs}
                  </span>
                  {d.robotics_easier_than_cs_reason && (
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))] leading-snug italic">
                      {d.robotics_easier_than_cs_reason}
                    </div>
                  )}
                </div>
              );
            }}/>
            {/* Row: alt paths + notes */}
            <RoboRow label="Alt paths & notes" rows={rows} render={({ d }) => {
              if (!d || !d.ecs_robotics_alt) return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
              return <div className="text-[11.5px] leading-snug">{d.ecs_robotics_alt}</div>;
            }}/>
            {/* NEW: Row: university-admissions differential */}
            <RoboRow label="Univ-admissions differential" rows={rows} render={({ d }) => {
              if (!d || !d.university_admit_differential) return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
              const v = d.university_admit_differential;
              const label =
                v === "YES-MATERIAL" ? "Materially easier via robotics/ME" :
                v === "YES-MODEST" ? "Modestly easier via robotics/ME" :
                v === "SAME" ? "Same bar" :
                v === "MORE_GATED" ? "ME/robotics HARDER" :
                v === "NOT_PUBLISHED" ? "Not published" : "N/A";
              const color =
                v === "YES-MATERIAL" ? "hsl(145 55% 35%)" :
                v === "YES-MODEST" ? "hsl(30 60% 40%)" :
                v === "MORE_GATED" ? "hsl(0 60% 45%)" : "hsl(0 0% 50%)";
              return (
                <div className="space-y-0.5">
                  <span className="chip chip-outline inline-flex items-center gap-1 text-[10.5px]" style={{ color }}>{label}</span>
                  {d.university_admit_differential_reason && (
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))] leading-snug italic">{d.university_admit_differential_reason}</div>
                  )}
                  {d.university_admit_differential_source && (
                    <a href={d.university_admit_differential_source} target="_blank" rel="noopener" className="text-[10px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">source <ExternalLink size={8}/></a>
                  )}
                </div>
              );
            }}/>
            {/* NEW: Row: internal-gate differential */}
            <RoboRow label="Internal-gate differential" rows={rows} render={({ d }) => {
              if (!d || !d.internal_gate_differential) return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
              const v = d.internal_gate_differential;
              const label =
                v === "YES-MATERIAL" ? "ME/robotics materially less gated" :
                v === "YES-MODEST" ? "ME/robotics modestly less gated" :
                v === "SAME" ? "Same gate" :
                v === "MORE_GATED" ? "ME/robotics HARDER internally" :
                v === "NOT_PUBLISHED" ? "Not published" : "N/A";
              const color =
                v === "YES-MATERIAL" ? "hsl(145 55% 35%)" :
                v === "YES-MODEST" ? "hsl(30 60% 40%)" :
                v === "MORE_GATED" ? "hsl(0 60% 45%)" : "hsl(0 0% 50%)";
              return (
                <div className="space-y-0.5">
                  <span className="chip chip-outline inline-flex items-center gap-1 text-[10.5px]" style={{ color }}>{label}</span>
                  {d.internal_gate_differential_reason && (
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))] leading-snug italic">{d.internal_gate_differential_reason}</div>
                  )}
                  {d.internal_gate_differential_source && (
                    <a href={d.internal_gate_differential_source} target="_blank" rel="noopener" className="text-[10px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">source <ExternalLink size={8}/></a>
                  )}
                </div>
              );
            }}/>
            {/* NEW: Row: admission strategy summary */}
            <RoboRow label="Admissions strategy" rows={rows} render={({ d }) => {
              if (!d || !d.admission_strategy) return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
              return <div className="text-[11.5px] leading-snug italic">{d.admission_strategy}</div>;
            }}/>
            {/* NEW: Row: ED/EA lift */}
            <RoboRow label="ED/EA rate lift" rows={rows} render={({ d }) => {
              if (!d || !d.early_admit_lift_verdict) return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
              const v = d.early_admit_lift_verdict;
              const label = v === "LARGE" ? "Large (≥2× RD)" : v === "MODERATE" ? "Moderate (1.3-2×)" : v === "SMALL" ? "Small (<1.3×)" : v === "NONE" ? "No plan or no lift" : "Not published";
              const color = v === "LARGE" ? "hsl(145 55% 35%)" : v === "MODERATE" ? "hsl(30 60% 40%)" : v === "SMALL" ? "hsl(30 40% 55%)" : "hsl(0 0% 50%)";
              return (
                <div className="space-y-0.5">
                  <span className="chip chip-outline inline-flex items-center gap-1 text-[10.5px]" style={{ color }}>{label}</span>
                  {d.best_early_deadline && <div className="text-[11px] text-[hsl(var(--muted-foreground))] leading-snug">{d.best_early_deadline}</div>}
                  {d.early_admit_lift_reason && <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] leading-snug italic">{d.early_admit_lift_reason}</div>}
                  {d.early_admit_lift_source && <a href={d.early_admit_lift_source} target="_blank" rel="noopener" className="text-[10px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">source <ExternalLink size={8}/></a>}
                </div>
              );
            }}/>
            {/* NEW: Row: NC residency / OOS gap */}
            <RoboRow label="NC residency effect" rows={rows} render={({ d }) => {
              if (!d || !d.oos_gap_verdict) return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
              const isNCAdv = (d.nc_applicant_note || "").includes("MAJOR ADVANTAGE") || (d.nc_applicant_note || "").includes("friendliest");
              const v = d.oos_gap_verdict;
              const label = isNCAdv ? "NC = MAJOR advantage" :
                v === "MASSIVE" ? "Massive OOS gap (hurts NC)" :
                v === "LARGE"   ? "Large OOS gap (hurts NC)" :
                v === "MODERATE"? "Moderate OOS gap" :
                v === "SMALL"   ? "Near parity" :
                v === "NONE"    ? "No residency preference" : "Not published";
              const color = isNCAdv ? "hsl(145 60% 32%)" :
                v === "MASSIVE" ? "hsl(0 60% 45%)" :
                v === "LARGE"   ? "hsl(0 50% 50%)" :
                v === "MODERATE"? "hsl(30 60% 40%)" : "hsl(0 0% 50%)";
              return (
                <div className="space-y-0.5">
                  <span className="chip chip-outline inline-flex items-center gap-1 text-[10.5px]" style={{ color }}>{label}</span>
                  {d.nc_applicant_note && <div className="text-[11px] text-[hsl(var(--muted-foreground))] leading-snug">{d.nc_applicant_note}</div>}
                  {d.oos_gap_reason && <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] leading-snug italic">{d.oos_gap_reason}</div>}
                  {d.oos_gap_source && <a href={d.oos_gap_source} target="_blank" rel="noopener" className="text-[10px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">source <ExternalLink size={8}/></a>}
                </div>
              );
            }}/>
            {/* NEW: Row: Mechatronics route */}
            <RoboRow label="Mechatronics route" rows={rows} render={({ d }) => {
              if (!d || (!d.has_mechatronics_bs && !d.has_mechatronics_track)) return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
              const admit = d.mechatronics_admit_vs_me;
              const adv = d.mechatronics_advantage_verdict;
              const admitLabel = admit === "EASIER-MATERIAL" ? "Easier admit than ME" :
                admit === "EASIER-MODEST" ? "Modestly easier" :
                admit === "SAME" ? "Same admit as ME" :
                admit === "HARDER" ? "Harder than ME" :
                admit === "NOT_PUBLISHED" ? "Admit not published" : "";
              const admitColor = admit === "EASIER-MATERIAL" ? "hsl(145 55% 35%)" : admit === "HARDER" ? "hsl(0 60% 45%)" : "hsl(0 0% 50%)";
              const advLabel = adv === "STRONG_ROBOTICS_FIT" ? "Better robotics fit than ME" : adv === "COMPARABLE" ? "Comparable to ME" : adv === "WEAKER_THAN_ME" ? "Weaker than ME" : "";
              const advColor = adv === "STRONG_ROBOTICS_FIT" ? "hsl(145 55% 35%)" : adv === "WEAKER_THAN_ME" ? "hsl(0 60% 45%)" : "hsl(0 0% 50%)";
              return (
                <div className="space-y-0.5">
                  {d.mechatronics_bs_name && (
                    <div className="text-[12.5px] font-medium leading-tight">{d.mechatronics_bs_name}</div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {admitLabel && <span className="chip chip-outline text-[10px] py-0" style={{ color: admitColor }}>{admitLabel}</span>}
                    {advLabel && <span className="chip chip-outline text-[10px] py-0" style={{ color: advColor }}>{advLabel}</span>}
                  </div>
                  {d.mechatronics_summary && <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] leading-snug italic">{d.mechatronics_summary}</div>}
                  {d.mechatronics_bs_url && <a href={d.mechatronics_bs_url} target="_blank" rel="noopener" className="text-[10px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">program <ExternalLink size={8}/></a>}
                </div>
              );
            }}/>
            {/* NEW: Row: robotics ecosystem tier */}
            <RoboRow label="Robotics ecosystem" rows={rows} render={({ d }) => {
              if (!d || !d.robotics_ecosystem_tier) return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
              const v = d.robotics_ecosystem_tier;
              const label = v === "TIER_1" ? "Tier 1 — world-class" : v === "TIER_2" ? "Tier 2 — strong depth" : v === "TIER_3" ? "Tier 3 — solid" : "Tier 4 — limited";
              const color = v === "TIER_1" ? "hsl(145 55% 35%)" : v === "TIER_2" ? "hsl(30 60% 40%)" : v === "TIER_3" ? "hsl(0 0% 45%)" : "hsl(0 0% 55%)";
              return (
                <div className="space-y-0.5">
                  <span className="chip chip-outline inline-flex items-center gap-1 text-[10.5px]" style={{ color }}>{label}</span>
                  {d.robotics_ecosystem_reason && <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] leading-snug italic">{d.robotics_ecosystem_reason}</div>}
                  {d.undergrad_research_program && <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] leading-snug"><strong>UROP:</strong> {d.undergrad_research_program}</div>}
                  {d.coop_pipeline && <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] leading-snug"><strong>Co-op:</strong> {d.coop_pipeline}</div>}
                  {d.robotics_ecosystem_source && <a href={d.robotics_ecosystem_source} target="_blank" rel="noopener" className="text-[10px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">source <ExternalLink size={8}/></a>}
                </div>
              );
            }}/>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoboRow({ label, rows, render }: {
  label: string;
  rows: { s: School; d: any }[];
  render: (row: { s: School; d: any }) => any;
}) {
  return (
    <tr>
      <td className="sticky left-0 bg-[hsl(var(--card))] font-medium text-[11.5px] text-[hsl(var(--muted-foreground))]">{label}</td>
      {rows.map((row, i) => (
        <td key={i} className="align-top max-w-[280px]">{render(row)}</td>
      ))}
    </tr>
  );
}

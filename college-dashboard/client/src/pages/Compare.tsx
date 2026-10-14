import { useState, useMemo } from "react";
import { schools, School, scoreGroups, fmtCost, fmtEnroll, stripSourceTags } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { FitBadge, AccessBadge, ArchetypeChips, ShortlistPill, NoteButton, MyRatingChip, AbetBadge } from "@/components/SchoolBits";
import { X, GitCompare, StickyNote, Bot, Wrench, ExternalLink, Trophy } from "lucide-react";
import { useNotes, statusLabel, hasContent } from "@/lib/notes";
import roboticsRoutes from "@/data/robotics_routes.json";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Legend, Tooltip,
} from "recharts";

const MAX = 4;
const seriesColors = ["hsl(220 40% 22%)","hsl(15 85% 55%)","hsl(175 45% 42%)","hsl(262 45% 45%)"];

/**
 * `cmp` supplies a comparable string for rows whose `get` returns JSX.
 *
 * The difference highlight only ever compared string cells, so every rendered
 * row -- badges, chips, scores -- silently opted out of the one feature the page
 * advertises. Rows that render markup can now say how they should be compared.
 */
const rows: { label: string; get: (s: School) => any; cmp?: (s: School) => string }[] = [
  { label: "Location", get: s => s.city_state },
  { label: "Region", get: s => s.region },
  { label: "Institution type", get: s => s.institution_type },
  { label: "Undergrad enrollment", get: s => fmtEnroll(s.undergrad_enrollment) },
  { label: "Fit tier", get: s => <FitBadge fit={s.fit_classification} /> },
  { label: "Shortlist group", get: s => <ShortlistPill group={s.shortlist_group} /> },
  { label: "Degree", get: s => s.degree_name },
  { label: "Program archetype(s)", get: s => <ArchetypeChips codes={s.archetypes} /> },
  { label: "Robotics curriculum", get: s => <ScoreOutOfFive v={s.axes.robotics_curriculum ?? null} />,
    cmp: s => s.axes.robotics_curriculum != null ? s.axes.robotics_curriculum.toFixed(1) : "" },
  { label: "Robotics access", get: s => <ScoreOutOfFive v={s.axes.robotics_access ?? null} />,
    cmp: s => s.axes.robotics_access != null ? s.axes.robotics_access.toFixed(1) : "" },
  { label: "Undergrad robotics courses",
    cmp: s => {
      const n = s.robotics_curriculum_detail?.course_count_undergrad;
      return n == null ? "" : String(n);
    },
    get: s => {
      const n = s.robotics_curriculum_detail?.course_count_undergrad;
      if (n == null) return "—";
      return <span className="num">{n}</span>;
    } },
  { label: "Robotics credential",
    cmp: s => {
      const c = s.robotics_credential;
      if (!c || c.credential_type === "none") return "none";
      return `${c.credential_type}|${c.abet_commission}|${c.program_name}`;
    },
    get: s => {
      const c = s.robotics_credential;
      if (!c || c.credential_type === "none") {
        return <span className="text-[hsl(var(--muted-foreground))]">No robotics-titled credential</span>;
      }
      return (
        <div className="space-y-1">
          <div className="text-[11.5px] leading-snug">{c.program_name}</div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="chip chip-outline text-[10px] py-0">{String(c.credential_type).replace(/_/g, " ")}</span>
            <AbetBadge credential={c} compact />
          </div>
        </div>
      );
    } },
  { label: "Robotics subdomains covered",
    cmp: s => {
      const dom = s.robotics_domains;
      if (!dom) return "";
      const v = Object.values(dom);
      return `${v.filter(d => d.coverage === "strong").length}/${v.filter(d => d.coverage === "present").length}`;
    },
    get: s => {
      const dom = s.robotics_domains;
      if (!dom) return "—";
      const vals = Object.values(dom);
      const strong = vals.filter(d => d.coverage === "strong").length;
      const present = vals.filter(d => d.coverage === "present").length;
      return (
        <span className="text-[11.5px]">
          <span className="num font-medium">{strong}</span> strong ·{" "}
          <span className="num font-medium">{present}</span> present
          <span className="text-[hsl(var(--muted-foreground))]"> of {vals.length}</span>
        </span>
      );
    } },
  { label: "Major access", get: s => <AccessBadge status={s.major_access_status}/> },
  { label: "Access rules (detail)", get: s => s.major_access_full },
  { label: "Recommended route", get: s => s.recommended_major_route },
  { label: "Alternative route", get: s => s.alternative_route },
  { label: "Primary structural risk", get: s => s.primary_structural_risk },
  { label: "Robotics research setting", get: s => s.robotics_access_detail?.institute_or_center || "—" },
  { label: "Undergraduate robotics participation", get: s => s.robotics_access_detail?.undergrad_access_mode || "Not verified" },
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
  { label: "Historical reported starting salary (scope varies)", get: s => {
      const o = s.outcomes;
      if (!o?.cs_median_starting_salary) return "n.a.";
      return `${fmtCost(o.cs_median_starting_salary)}${o.cs_salary_scope ? " (" + o.cs_salary_scope + ")" : " (scope unknown)"}${o.first_dest_year ? " · cohort " + o.first_dest_year : ""}; not a robotics salary`;
    } },
  { label: "Historical reported employers (CS/context)", get: s => (s.outcomes?.cs_top_employers?.slice(0,6).join(", ") || "n.a.") },
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

/** A 0-5 axis score with a proportional bar, so a column scan reads at a glance. */
function ScoreOutOfFive({ v }: { v: number | null }) {
  if (v == null) return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="num font-medium">{v.toFixed(1)}</span>
      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">/5</span>
      <span className="inline-block w-[52px] h-[5px] rounded-sm bg-[hsl(var(--border))] align-middle">
        <span className="block h-full rounded-sm"
          style={{ width: `${(v / 5) * 100}%`, background: "hsl(var(--accent))" }}/>
      </span>
    </span>
  );
}

export default function ComparePage() {
  const { hidden } = useHidden();
  const { getNote } = useNotes();
  const [picked, setPicked] = useState<string[]>(() => ["wpi", "michigan", "carnegie-mellon", "nc-state"].filter(slug => !hidden.has(slug)));
  const [showNotes, setShowNotes] = useState(true);

  const available = useMemo(() =>
    schools.filter(s => !hidden.has(s.slug) && !picked.includes(s.slug))
      .sort((a,b) => a.short.localeCompare(b.short)),
  [hidden, picked]);

  const selected = picked.filter(slug => !hidden.has(slug)).map(p => schools.find(s => s.slug === p)!).filter(Boolean);
  const add = (slug: string) => { if (picked.length < MAX) setPicked([...picked, slug]); };
  const remove = (slug: string) => setPicked(picked.filter(x => x !== slug));

  const radarData = useMemo(() => {
    return scoreGroups.map(g => {
      const row: any = { axis: g.short };
      selected.forEach(s => { row[s.short] = (s.axes as any)[g.key] ?? null; });
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
              <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mb-3">
                {scoreGroups.length} aggregate axes, each 0-5. Robotics curriculum and access are
                separate axes because "Hands-on" blends robotics with project work and clubs, which
                hid real differences between schools.
              </div>
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
                    const strVals = selected.map((s, i) =>
                      r.cmp ? r.cmp(s) : (typeof vals[i] === "string" ? vals[i] as string : ""));
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
  const routeRows = selected.map(s => ({ s, r: (roboticsRoutes.schools as any)[s.slug] }));
  const attributes = [
    { label: "Recommended robotics route", value: (r: any) => r.recommended_summary },
    { label: "Primary robotics degree / other credential", value: (r: any) => r.bs_robotics.offered ? `${r.bs_robotics.degree_name} · ${String(r.bs_robotics.kind).replace(/_/g, " ")}. ${r.bs_robotics.entry ?? "Entry not verified"}` : "No dedicated robotics bachelor's degree" },
    { label: "ECE route: hardware, embedded systems and controls", value: (r: any) => `${r.ece.degree_names.join(" / ")} · ${r.ece.robotics_track ?? "Elective-built route"}. ${r.ece.entry}` },
    { label: "ECE key courses", value: (r: any) => r.ece.key_courses.map((c: any) => `${c.code} ${c.title}`).join(" · ") },
    { label: "CS route: autonomy and supporting AI", value: (r: any) => `${r.cs.degree_names.join(" / ")} · ${r.cs.robotics_track ?? "Elective-built route"}. ${r.cs.entry}` },
    { label: "CS key courses", value: (r: any) => r.cs.key_courses.map((c: any) => `${c.code} ${c.title}`).join(" · ") },
    { label: "Robotics minor / certificate", value: (r: any) => r.robotics_minor ? `${r.robotics_minor.name}. ${r.robotics_minor.open_to}` : "None verified" },
    { label: "Robotics setting", value: (r: any) => r.ecosystem },
    { label: "Route trade-off", value: (r: any) => r.tradeoff },
  ];
  return <div className="card overflow-hidden">
    <div className="p-3 border-b border-[hsl(var(--border))]">
      <div className="text-[13px] font-medium inline-flex items-center gap-2"><Bot size={14}/> Robotics routes at these schools</div>
      <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">Primary Robotics BS, ECE and CS routes use the same current evidence as the Robotics routes page. Key courses are examples; prerequisites, permission and seats still apply.</p>
    </div>
    <div className="overflow-x-auto"><table className="dense w-full"><thead><tr>
      <th className="w-[220px] sticky left-0 z-[2]">Route attribute</th>
      {routeRows.map(({s}, i) => <th key={s.slug} className="serif font-semibold" style={{ color: seriesColors[i] }}>{s.short}</th>)}
    </tr></thead><tbody>
      {attributes.map(attribute => <tr key={attribute.label}>
        <td className="sticky left-0 bg-[hsl(var(--card))] text-[11.5px] font-medium">{attribute.label}</td>
        {routeRows.map(({s,r}) => <td key={s.slug} className="align-top text-[11.5px] leading-relaxed max-w-[280px]">{r ? attribute.value(r) : "Not verified"}</td>)}
      </tr>)}
      <tr><td className="sticky left-0 bg-[hsl(var(--card))] text-[11.5px] font-medium">Official route sources</td>
        {routeRows.map(({s,r}) => <td key={s.slug}><div className="flex flex-wrap gap-2">
          {r?.sources?.map((source: any, i: number) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="text-[10.5px] hover:underline text-[hsl(var(--accent))]" title={source.supports}>Source {i+1}</a>)}
        </div></td>)}
      </tr>
    </tbody></table></div>
  </div>;
}

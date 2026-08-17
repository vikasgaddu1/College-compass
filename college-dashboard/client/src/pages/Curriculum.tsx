import { useState, useMemo, Fragment } from "react";
import { School, scoreGroups, schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { ScoreCell, FitBadge, AccessBadge, ArchetypeChips, HideButton, NoteButton } from "@/components/SchoolBits";
import { ChevronRight, ChevronDown, Bot, Wrench } from "lucide-react";
import roboticsPaths from "@/data/robotics_paths.json";
import { Link } from "wouter";

const columns = [
  { key: "ai_curriculum_breadth", label: "AI breadth" },
  { key: "ai_curriculum_depth", label: "AI depth" },
  { key: "emerging_ai_topics", label: "LLMs / agents / RL" },
  { key: "course_availability", label: "Courses run" },
  { key: "curricular_flexibility", label: "Flexibility" },
  { key: "cs_foundations", label: "CS foundations" },
  { key: "math_foundations", label: "Math foundations" },
  { key: "undergraduate_research_access", label: "UG research" },
  { key: "faculty_mentorship", label: "Faculty" },
  { key: "computing_resources", label: "GPU / compute" },
  { key: "project_based_learning", label: "Projects" },
  { key: "robotics_autonomy_options", label: "Robotics" },
  { key: "industry_preparation", label: "Industry prep" },
  { key: "graduate_school_preparation", label: "Grad-school prep" },
  { key: "fourplusone_quality", label: "4+1" },
];

type Sort = { key: string; asc: boolean };

export default function CurriculumPage() {
  const { hidden } = useHidden();
  const [sort, setSort] = useState<Sort>({ key: "ai_curriculum_depth", asc: false });
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = schools.filter(s => !hidden.has(s.slug));
    return [...list].sort((a,b) => {
      const av = (a.scores[sort.key] as number) ?? -1;
      const bv = (b.scores[sort.key] as number) ?? -1;
      return sort.asc ? av - bv : bv - av;
    });
  }, [hidden, sort]);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="serif text-[17px] font-semibold mb-1">Curriculum & undergraduate access — heatmap</div>
        <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-3xl">
          Each cell is a 1-5 evidence-based score, not a ranking. Hover a cell for the concrete fact behind it. Gray "?" = insufficient evidence to score responsibly. Click any row for the full curriculum & access story.
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="dense w-full">
            <thead>
              <tr>
                <th className="w-[210px] sticky left-0 z-[2]">School</th>
                <th className="w-[110px]">Access</th>
                <th className="w-[130px]">Robotics paths</th>
                {columns.map(c => (
                  <th key={c.key} className="text-center cursor-pointer whitespace-nowrap"
                    onClick={()=>setSort(s => ({ key: c.key, asc: s.key===c.key ? !s.asc : false }))}>
                    <div className="inline-flex items-center gap-1">
                      <span>{c.label}</span>
                      {sort.key===c.key && <span className="text-[10px]">{sort.asc?"↑":"↓"}</span>}
                    </div>
                  </th>
                ))}
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s: School) => (
                <Fragment key={s.slug}>
                  <tr className="cursor-pointer" onClick={()=>setExpanded(x => x===s.slug ? null : s.slug)}>
                    <td className="sticky left-0 z-[1] bg-[hsl(var(--card))]">
                      <div className="flex items-center gap-1.5">
                        {expanded===s.slug ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
                        <div>
                          <div className="serif font-medium">{s.short}</div>
                          <div className="text-[10.5px] text-[hsl(var(--muted-foreground))]">{s.city_state}</div>
                        </div>
                      </div>
                    </td>
                    <td><AccessBadge status={s.major_access_status} /></td>
                    <td><RoboticsCell slug={s.slug}/></td>
                    {columns.map(c => (
                      <td key={c.key} className="text-center">
                        <span title={s.score_notes[c.key] || ""}>
                          <ScoreCell value={s.scores[c.key] as any} />
                        </span>
                      </td>
                    ))}
                    <td onClick={e=>e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <NoteButton slug={s.slug}/>
                        <HideButton slug={s.slug} compact />
                      </div>
                    </td>
                  </tr>
                  {expanded===s.slug && (
                    <tr>
                      <td colSpan={columns.length+4} className="bg-[hsl(var(--muted)/0.35)]">
                        <ExpandedRow s={s} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-3 flex flex-wrap items-center gap-3 text-[12px]">
        <span className="text-[hsl(var(--muted-foreground))]">Score legend:</span>
        {[5,4,3,2,1].map(v => (
          <span key={v} className="inline-flex items-center gap-1.5">
            <ScoreCell value={v}/>
            <span>{ ({5:"Exceptional",4:"Strong",3:"Typical",2:"Thin",1:"Weak"} as Record<number,string>)[v] }</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5"><ScoreCell value={null}/> Not enough evidence</span>
      </div>
    </div>
  );
}

function ExpandedRow({ s }: { s: School }) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FitBadge fit={s.fit_classification} />
        <ArchetypeChips codes={s.archetypes} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[12.5px]">
        <div>
          <Label>Degree</Label>
          <div>{s.degree_name}</div>
          <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] mt-0.5">{s.degree_type}</div>

          <Label>Access rules</Label>
          <div>{s.major_access_full}</div>

          <Label>Structural risk</Label>
          <div>{s.primary_structural_risk}</div>
        </div>
        <div>
          <Label>Notable AI institute</Label>
          <div>{s.notable_ai_institute || "—"}</div>

          <Label>UG research program</Label>
          <div>{s.notable_undergraduate_research_program || "—"}</div>

          <Label>Accelerated MS (4+1)</Label>
          <div>{s.fourplusone_available}{s.fourplusone_name ? " · " + s.fourplusone_name : ""}</div>
        </div>
      </div>

      <details className="text-[12px]">
        <summary className="cursor-pointer text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
          Score notes (concrete fact behind each score)
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 mt-2">
          {scoreGroups.flatMap(g => g.keys).map(k => (
            <div key={k} className="flex gap-2">
              <ScoreCell value={s.scores[k] as any} />
              <div>
                <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{k.replace(/_/g,' ')}</div>
                <div className="text-[11.5px]">{s.score_notes[k] || "—"}</div>
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
function Label({ children }: { children: any }) {
  return <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mt-3 first:mt-0 mb-0.5">{children}</div>;
}

function RoboticsCell({ slug }: { slug: string }) {
  const d = (roboticsPaths.schools as any)[slug];
  if (!d) return <span className="text-[hsl(var(--muted-foreground))] text-[11px]">—</span>;
  const hasBS = d.has_bs_robotics?.startsWith("Yes");
  const hasME = !!d.me_robotics_track_name;
  const easier = d.robotics_easier_than_cs === "Yes";
  return (
    <Link href="/robotics" className="flex flex-col gap-0.5 text-[10.5px] hover:opacity-80" title={d.robotics_easier_than_cs_reason || undefined}>
      {hasBS ? (
        <span className="inline-flex items-center gap-0.5 text-[hsl(var(--fit-strong))] font-medium">
          <Bot size={10}/> BS Robotics
        </span>
      ) : (
        <span className="text-[hsl(var(--muted-foreground))]">No BS</span>
      )}
      {hasME && (
        <span className="inline-flex items-center gap-0.5 text-[hsl(var(--accent))]">
          <Wrench size={10}/> ME track
        </span>
      )}
      {easier && (
        <span className="text-[hsl(var(--fit-top))] font-medium">Easier via ME</span>
      )}
    </Link>
  );
}

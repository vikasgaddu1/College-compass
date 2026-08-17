import { useState } from "react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import admissionsData from "@/data/admissions_context.json";
import { FileText, Home, Globe, Plane, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";

type Ctx = typeof admissionsData.schools[keyof typeof admissionsData.schools];

/** Compact context strip surfaced on Culture & Cost tabs. Testing policy,
 *  housing, international share, and study-abroad rate for every visible
 *  school in a scannable grid. */
export function AdmissionsContextStrip() {
  const { hidden } = useHidden();
  const [open, setOpen] = useState(false);
  const rows = schools
    .filter(s => !hidden.has(s.slug))
    .map(s => ({ s, d: (admissionsData.schools as any)[s.slug] as Ctx | undefined }))
    .filter((x): x is { s: typeof schools[number]; d: Ctx } => !!x.d);

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full p-3 flex items-center justify-between hover:bg-[hsl(var(--elevate-1))]">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-[hsl(var(--accent))]" />
          <div className="text-[13px] font-medium">Admissions context · testing, housing, international share</div>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">Fall 2027 cycle · from each school's IR pages</span>
        </div>
        {open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
      </button>
      {open && (
        <div className="border-t border-[hsl(var(--border))] overflow-x-auto">
          <table className="dense w-full">
            <thead>
              <tr>
                <th className="sticky left-0 z-[2] w-[160px]">School</th>
                <th className="min-w-[200px]"><span className="inline-flex items-center gap-1"><FileText size={11}/>Testing policy</span></th>
                <th className="text-right w-[80px]"><span className="inline-flex items-center gap-1"><Globe size={11}/>Intl %</span></th>
                <th className="text-right w-[100px]"><span className="inline-flex items-center gap-1"><Plane size={11}/>Study abroad</span></th>
                <th className="w-[160px]"><span className="inline-flex items-center gap-1"><Home size={11}/>Housing req'd</span></th>
                <th className="min-w-[240px]">Housing notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, d }) => (
                <tr key={s.slug}>
                  <td className="sticky left-0 z-[1] bg-[hsl(var(--card))]">
                    <div className="serif font-medium text-[12.5px]">{s.short}</div>
                  </td>
                  <td className="text-[11.5px] leading-snug">
                    <div>{d.testing}</div>
                    {d.testing_source && (
                      <a href={d.testing_source} target="_blank" rel="noopener"
                        className="text-[10px] text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5 mt-0.5">
                        source <ExternalLink size={8}/>
                      </a>
                    )}
                  </td>
                  <td className="text-right num text-[12px]">{d.intl_pct != null ? `${d.intl_pct}%` : <span className="text-[hsl(var(--muted-foreground))]">n.a.</span>}</td>
                  <td className="text-right num text-[12px]">{d.study_abroad_pct != null ? `${d.study_abroad_pct}%` : <span className="text-[hsl(var(--muted-foreground))]">n.a.</span>}</td>
                  <td className="text-[11.5px] leading-snug">
                    <div>{d.housing_req}</div>
                    <div className="text-[10.5px] text-[hsl(var(--muted-foreground))]">{d.housing_years}</div>
                  </td>
                  <td className="text-[11px] leading-snug text-[hsl(var(--muted-foreground))]">{d.housing_note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

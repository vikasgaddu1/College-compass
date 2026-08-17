import { useState } from "react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import alumniData from "@/data/alumni.json";
import { Building2, ChevronDown, ChevronRight } from "lucide-react";

type Row = typeof alumniData.schools[keyof typeof alumniData.schools];

const bandTone: Record<string, { bg: string; fg: string; label: string }> = {
  "Very high": { bg: "hsl(145 55% 88%)", fg: "hsl(145 65% 22%)", label: "V high" },
  "High":      { bg: "hsl(200 65% 90%)", fg: "hsl(200 65% 30%)", label: "High" },
  "Moderate":  { bg: "hsl(35 60% 92%)",  fg: "hsl(35 70% 35%)",  label: "Mod" },
  "Low":       { bg: "hsl(0 0% 95%)",    fg: "hsl(0 0% 40%)",    label: "Low" },
  "n.a.":      { bg: "hsl(0 0% 97%)",    fg: "hsl(0 0% 60%)",    label: "n.a." },
};

/** Compact big-tech alumni-footprint heatmap for the Careers tab.
 *  Sourced from College Transitions LinkedIn analyses; LinkedIn People
 *  pages are blocked so exact counts are not available. */
export function AlumniStrip() {
  const { hidden } = useHidden();
  const [open, setOpen] = useState(true);
  const rows = schools
    .filter(s => !hidden.has(s.slug))
    .map(s => ({ s, d: (alumniData.schools as any)[s.slug] as Row | undefined }))
    .filter((x): x is { s: typeof schools[number]; d: Row } => !!x.d);

  const companies = alumniData.companies as string[];

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full p-3 flex items-center justify-between hover:bg-[hsl(var(--elevate-1))]">
        <div className="flex items-center gap-2">
          <Building2 size={14} className="text-[hsl(var(--accent))]" />
          <div className="text-[13px] font-medium">Alumni footprint at big AI / tech companies</div>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">Qualitative bands · LinkedIn pages block exact counts</span>
        </div>
        {open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
      </button>
      {open && (
        <>
          <div className="border-t border-[hsl(var(--border))] overflow-x-auto">
            <table className="dense w-full">
              <thead>
                <tr>
                  <th className="sticky left-0 z-[2] w-[160px]">School</th>
                  {companies.map(c => <th key={c} className="text-center min-w-[70px]">{c}</th>)}
                  <th className="min-w-[280px]">Notable</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ s, d }) => (
                  <tr key={s.slug}>
                    <td className="sticky left-0 z-[1] bg-[hsl(var(--card))]">
                      <div className="serif font-medium text-[12.5px]">{s.short}</div>
                    </td>
                    {companies.map(c => {
                      const band = (d.bands as any)[c] || "n.a.";
                      const tone = bandTone[band] || bandTone["n.a."];
                      return (
                        <td key={c} className="text-center">
                          <span className="chip text-[10px] py-0" title={band}
                            style={{ background: tone.bg, color: tone.fg, borderColor: tone.bg }}>
                            {tone.label}
                          </span>
                        </td>
                      );
                    })}
                    <td className="text-[11px] leading-snug text-[hsl(var(--muted-foreground))]">{d.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 text-[10.5px] text-[hsl(var(--muted-foreground))] border-t border-[hsl(var(--border))]">
            <strong>Band scale (relative to these schools):</strong> Very high = top-tier feeder · High = 500+/900+/&quot;hundreds&quot; · Moderate = named significant employer · Low = &lt;100 · n.a. = no evidence.
            {" "}Sources: College Transitions LinkedIn-derived tech-feeder counts, Resume Genius Nov 2025 LinkedIn Alumni analysis, workforce.ai OpenAI alma-mater ranking, school first-destination reports.
          </div>
        </>
      )}
    </div>
  );
}

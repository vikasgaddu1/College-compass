import { useMemo, useState } from "react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { HideButton, ScoreCell, NoteButton } from "@/components/SchoolBits";
import { AdmissionsContextStrip } from "@/components/AdmissionsContext";

const dims = [
  { key: "greek_participation",  label: "Greek life presence" },
  { key: "sports_influence",     label: "Varsity sports influence" },
  { key: "recreation_center",    label: "Rec center / gym" },
  { key: "housing_guarantee",    label: "Housing guarantee" },
];

const scoreCols = [
  { key: "intellectual_energy",      label: "Intellectual energy" },
  { key: "healthy_ambition",         label: "Healthy (not cutthroat)" },
  { key: "student_agency",           label: "Student agency" },
  { key: "community_within_scale",   label: "Community within scale" },
  { key: "technical_club_ecosystem", label: "Technical clubs" },
  { key: "nonacademic_club_variety", label: "Non-technical clubs" },
  { key: "non_greek_social_life",    label: "Non-Greek social life" },
  { key: "campus_engagement",        label: "Campus stays engaged" },
  { key: "recreation_facilities",    label: "Rec facilities" },
  { key: "daily_life",               label: "Daily life around campus" },
];

export default function CulturePage() {
  const { hidden } = useHidden();
  const [sortKey, setSortKey] = useState("non_greek_social_life");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const list = schools.filter(s => !hidden.has(s.slug));
    return [...list].sort((a,b) => {
      const av = (a.scores[sortKey] as number) ?? -1;
      const bv = (b.scores[sortKey] as number) ?? -1;
      return asc ? av - bv : bv - av;
    });
  }, [hidden, sortKey, asc]);

  return (
    <div className="space-y-4">
      <AdmissionsContextStrip />

      <div className="card p-4">
        <div className="serif text-[17px] font-semibold mb-1">Culture, community, and quality of life</div>
        <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-3xl">
          Two questions this view answers: <em>can I have a great social life without Greek life?</em> and <em>is the intense pace healthy or cutthroat?</em> The four text columns on the left carry the raw wording from the underlying research so nothing is hidden behind a color.
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="dense w-full">
            <thead>
              <tr>
                <th className="w-[190px] sticky left-0 z-[2]">School</th>
                {dims.map(d => <th key={d.key} className="min-w-[180px]">{d.label}</th>)}
                {scoreCols.map(c => (
                  <th key={c.key} className="text-center cursor-pointer whitespace-nowrap"
                    onClick={()=>{ if (sortKey===c.key) setAsc(a=>!a); else { setSortKey(c.key); setAsc(false); } }}>
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {sortKey===c.key && <span className="text-[10px]">{asc?"↑":"↓"}</span>}
                    </span>
                  </th>
                ))}
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.slug}>
                  <td className="sticky left-0 z-[1] bg-[hsl(var(--card))]">
                    <div className="serif font-medium">{s.short}</div>
                    <div className="text-[10.5px] text-[hsl(var(--muted-foreground))]">{s.city_state}</div>
                  </td>
                  {dims.map(d => (
                    <td key={d.key} className="text-[11.5px] leading-snug max-w-[220px]">
                      {(s as any)[d.key] || <span className="text-[hsl(var(--muted-foreground))]">—</span>}
                    </td>
                  ))}
                  {scoreCols.map(c => (
                    <td key={c.key} className="text-center">
                      <span title={s.score_notes[c.key] || ""}>
                        <ScoreCell value={s.scores[c.key] as any}/>
                      </span>
                    </td>
                  ))}
                  <td>
                    <div className="flex items-center gap-1">
                      <NoteButton slug={s.slug}/>
                      <HideButton slug={s.slug} compact/>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

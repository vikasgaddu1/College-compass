import { useMemo, useState } from "react";
import { schools, School, stripSourceTags } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { FitBadge, HideButton, AccessBadge, NoteButton, MyRatingChip } from "@/components/SchoolBits";
import { AlertTriangle, Info } from "lucide-react";

/**
 * "Biggest drawback" — the honest counterpart to "why to choose."
 * Every school here has documented weaknesses. Rather than hide them behind
 * numbers, this view foregrounds them and helps a senior say "OK, if I hate
 * X, that rules this school out."
 *
 * Sources of drawbacks:
 *  1. `biggest_concern` — the top-level headline concern from the study
 *  2. `primary_structural_risk` — the structural gate/curriculum risk
 *  3. Any score ≤ 2 (real weaknesses, not just "unknown")
 *  4. Any UNK score on a decision-critical axis (evidence gap, not a fix)
 */

const criticalKeys: Record<string, string> = {
  ai_curriculum_depth: "AI curriculum depth",
  emerging_ai_topics: "Modern AI (LLMs, agents, RL)",
  undergraduate_research_access: "Undergrad research access",
  faculty_mentorship: "Faculty mentorship",
  course_availability: "Advanced courses actually run",
  computing_resources: "GPU / compute access",
  healthy_ambition: "Healthy (not cutthroat) ambition",
  non_greek_social_life: "Non-Greek social life",
  robotics_autonomy_options: "Robotics / autonomy",
  fourplusone_quality: "Accelerated master's option",
  daily_life: "Daily life around campus",
  campus_engagement: "Campus stays engaged",
};

interface Weakness { key: string; label: string; score: number | null; note: string; kind: "weak" | "unknown"; }

function findWeaknesses(s: School): Weakness[] {
  const out: Weakness[] = [];
  for (const [k, label] of Object.entries(criticalKeys)) {
    const v = s.scores[k];
    const note = s.score_notes[k] || "";
    if (typeof v === "number" && v <= 2) out.push({ key: k, label, score: v, note, kind: "weak" });
    else if (v == null && note && !note.toLowerCase().startsWith("—"))
      out.push({ key: k, label, score: null, note, kind: "unknown" });
  }
  // Weak first, then unknowns, then most-important-fields first
  return out.sort((a,b) => {
    if (a.kind !== b.kind) return a.kind === "weak" ? -1 : 1;
    if (a.kind === "weak") return (a.score ?? 0) - (b.score ?? 0);
    return 0;
  });
}

// A rule-of-thumb "walk away if" tagline based on the concern + risk
function walkAwayIf(s: School): string {
  const risk = (s.primary_structural_risk || "").toLowerCase();
  const concern = (s.biggest_concern || "").toLowerCase();
  const bits: string[] = [];
  if (/(gate|coda|lep|selection|change of major|entrance to major|codo|internal admit)/i.test(risk))
    bits.push("you need certainty of getting into the CS/AI major on day one");
  if (/(cutthroat|stress|workload|misery|pressure|competitive)/i.test(concern) || /(cutthroat|stress|misery)/i.test(risk))
    bits.push("you want a low-pressure college experience");
  if (/(greek|frat|sorority)/i.test(concern) || /(greek|frat|sorority)/i.test(risk))
    bits.push("you'd feel excluded by a large Greek presence");
  if (/(rural|isolated|small town|weekends?)/i.test(concern) || /(rural|isolated|small town)/i.test(risk))
    bits.push("you need an urban feel and easy weekend variety");
  if (/(cost|expensive|price|tuition)/i.test(concern))
    bits.push("cost is your primary constraint");
  if (/(rotation|frequency|not offered|thin|weak)/i.test(concern))
    bits.push("you need every advanced AI course guaranteed each year");
  if (/(unverified|unpublished|unknown|unk)/i.test(concern) && bits.length === 0)
    bits.push("you can't wait for evidence to be confirmed");
  if (bits.length === 0) bits.push("the concern below would truly stop you");
  return bits.slice(0, 2).join(", or ");
}

const kindStyles: Record<string, string> = {
  weak: "bg-[hsl(var(--fit-lower)/0.10)] border-l-[hsl(var(--fit-lower))] text-[hsl(var(--fit-lower))]",
  unknown: "bg-[hsl(var(--fit-conditional)/0.10)] border-l-[hsl(var(--fit-conditional))] text-[hsl(var(--fit-conditional))]",
};

export default function DrawbacksPage() {
  const { hidden } = useHidden();
  const [sortBy, setSortBy] = useState<"severity"|"name"|"fit">("severity");

  const list = useMemo(() => {
    const arr = schools.filter(s => !hidden.has(s.slug))
      .map(s => ({ s, weaknesses: findWeaknesses(s) }));
    if (sortBy === "name") arr.sort((a,b)=>a.s.short.localeCompare(b.s.short));
    else if (sortBy === "severity") arr.sort((a,b) => {
      const wa = a.weaknesses.filter(w=>w.kind==="weak").length;
      const wb = b.weaknesses.filter(w=>w.kind==="weak").length;
      return wb - wa || b.weaknesses.length - a.weaknesses.length;
    });
    else {
      const rank: Record<string,number> = { "TOP FIT":3,"STRONG FIT":2,"CONDITIONAL FIT":1,"LOWER FIT":0 };
      arr.sort((a,b)=> (rank[b.s.fit_classification]??0) - (rank[a.s.fit_classification]??0));
    }
    return arr;
  }, [hidden, sortBy]);

  return (
    <div className="space-y-4">
      <div className="card p-4 md:p-5 flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[hsl(var(--fit-lower)/0.14)] text-[hsl(var(--fit-lower))]">
            <AlertTriangle size={18}/>
          </div>
          <div>
            <div className="serif text-[18px] font-semibold">Biggest drawback — the honest counter-view</div>
            <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-2xl leading-relaxed">
              For every school, the single thing that would rule it out — plus every documented weakness or evidence gap. If a "walk away if…" line matches how you feel, take the school off your list.
            </div>
          </div>
        </div>
        <div className="text-[12px] shrink-0">
          <span className="text-[hsl(var(--muted-foreground))] mr-2">Sort</span>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)}
            className="text-[12px] py-1 px-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            <option value="severity">Most weaknesses first</option>
            <option value="fit">Fit tier</option>
            <option value="name">School name</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {list.map(({ s, weaknesses }) => {
          const weakCount = weaknesses.filter(w => w.kind === "weak").length;
          const unkCount  = weaknesses.filter(w => w.kind === "unknown").length;
          return (
            <div key={s.slug} className="card p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="serif text-[19px] font-semibold leading-tight">{s.short}</div>
                  <div className="text-[11.5px] text-[hsl(var(--muted-foreground))]">{s.city_state}</div>
                </div>
                <div className="flex items-center gap-1">
                  <NoteButton slug={s.slug} />
                  <HideButton slug={s.slug} compact />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <FitBadge fit={s.fit_classification} />
                <AccessBadge status={s.major_access_status} />
                <MyRatingChip slug={s.slug} />
                <span className="chip" title="Documented weak scores">🔻 {weakCount} weak</span>
                <span className="chip" title="Evidence-gap scores (UNK)">❓ {unkCount} unknown</span>
              </div>

              {/* Headline concern */}
              <div className="border-l-4 border-[hsl(var(--fit-lower))] rounded-r-md bg-[hsl(var(--fit-lower)/0.06)] px-3 py-2.5">
                <div className="text-[10.5px] uppercase tracking-wider font-medium text-[hsl(var(--fit-lower))] mb-0.5">Headline drawback</div>
                <div className="text-[13.5px] leading-relaxed">{stripSourceTags(s.biggest_concern)}</div>
              </div>

              {/* Structural risk */}
              {s.primary_structural_risk && (
                <div className="border-l-2 border-[hsl(var(--fit-conditional))] pl-3">
                  <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--fit-conditional))] font-medium mb-0.5">Structural risk</div>
                  <div className="text-[12.5px] leading-relaxed">{stripSourceTags(s.primary_structural_risk)}</div>
                </div>
              )}

              {/* Walk away if... */}
              <div className="bg-[hsl(var(--muted)/0.5)] rounded-md px-3 py-2 border border-[hsl(var(--border))]">
                <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-0.5">Walk away if…</div>
                <div className="text-[12.5px] leading-snug">{walkAwayIf(s)}.</div>
              </div>

              {/* All weak areas */}
              {weaknesses.length > 0 && (
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1.5">Every weak or unverified area</div>
                  <div className="space-y-1.5">
                    {weaknesses.slice(0, 6).map(w => (
                      <div key={w.key} className={`text-[11.5px] leading-snug px-2.5 py-1.5 rounded-r border-l-2 ${kindStyles[w.kind]}`}>
                        <div className="flex items-center gap-2">
                          {w.kind === "weak"
                            ? <span className={`score-cell s${w.score}`}>{w.score}</span>
                            : <span className="score-cell unk">?</span>}
                          <span className="font-medium text-[hsl(var(--foreground))]">{w.label}</span>
                          <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
                            {w.kind === "weak" ? "documented weakness" : "not enough evidence"}
                          </span>
                        </div>
                        <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">{stripSourceTags(w.note)}</div>
                      </div>
                    ))}
                  </div>
                  {weaknesses.length > 6 && (
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1.5">
                      + {weaknesses.length - 6} more — see the school's full profile in the Curriculum tab.
                    </div>
                  )}
                </div>
              )}

              {weaknesses.length === 0 && (
                <div className="text-[12px] text-[hsl(var(--muted-foreground))] flex items-center gap-2">
                  <Info size={13}/> No sub-3 scores. The headline concern above is the load-bearing one.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

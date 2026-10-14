import { useState, useMemo } from "react";
import { schools, School, stripSourceTags } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { FitBadge, ArchetypeChips, AccessBadge, HideButton, CostChip, AxisBar, NoteButton, MyRatingChip } from "@/components/SchoolBits";
import { Sparkles, ChevronRight } from "lucide-react";
import roboticsRoutes from "@/data/robotics_routes.json";
import { roboticsAiFit } from "@/lib/focusPreset";

/**
 * "Why to choose" — a story per school built entirely from the concrete
 * documented facts already in the CSV (score notes + best_fit_reason +
 * notable_ai_institute + notable_undergraduate_research_program +
 * fourplusone_name + recommended_major_route).
 *
 * The point of this page is that a senior can scan it and see, for every
 * school, the two or three sharpest reasons to actually pick it, with the
 * concrete evidence right underneath.
 */

// The scores that most often indicate a "signature strength" (a 5 here is worth mentioning)
const strengthKeys: { key: string; label: string; icon: string; axis?: boolean }[] = [
  { key: "robotics_curriculum", label: "Balanced robotics coursework", icon: "🦾", axis: true },
  { key: "robotics_access", label: "Undergraduate robotics participation", icon: "🛠️", axis: true },
  { key: "ai_curriculum_depth", label: "AI elective depth (supporting)", icon: "🧠" },
  { key: "ai_curriculum_breadth", label: "AI elective breadth (supporting)", icon: "📚" },
  { key: "emerging_ai_topics", label: "LLMs / agents / RL taught", icon: "🤖" },
  { key: "undergraduate_research_access", label: "Undergrads get into labs", icon: "🔬" },
  { key: "faculty_mentorship", label: "Real faculty mentorship", icon: "👥" },
  { key: "project_based_learning", label: "Learn by building", icon: "🛠️" },
  { key: "robotics_autonomy_options", label: "Robotics/autonomy path", icon: "🦾" },
  { key: "computing_resources", label: "GPU/compute access", icon: "⚡" },
  { key: "curricular_flexibility", label: "Flexible curriculum", icon: "🎛️" },
  { key: "course_availability", label: "Advanced courses actually run", icon: "📖" },
  { key: "fourplusone_quality", label: "Strong accelerated MS", icon: "🎓" },
  { key: "graduate_school_preparation", label: "Grad-school preparation", icon: "🧪" },
  { key: "industry_preparation", label: "Industry preparation", icon: "💼" },
  { key: "healthy_ambition", label: "Healthy (not cutthroat) ambition", icon: "🕊️" },
  { key: "intellectual_energy", label: "Buzzing intellectual energy", icon: "⚡" },
  { key: "student_agency", label: "Student agency to shape studies", icon: "🧭" },
  { key: "community_within_scale", label: "Finds community even at scale", icon: "🏛️" },
  { key: "technical_club_ecosystem", label: "Strong technical clubs", icon: "🧑‍💻" },
  { key: "non_greek_social_life", label: "Great non-Greek social life", icon: "🎭" },
  { key: "recreation_facilities", label: "Top rec facilities", icon: "🏋️" },
];

// Extract top strengths from a school (score >= 4)
function pickStrengths(s: School, threshold = 4) {
  return strengthKeys
    .map(k => ({ ...k, score: k.axis ? (s.axes as any)[k.key] : s.scores[k.key], note: k.axis ? ((k.key === "robotics_curriculum" ? s.robotics_curriculum_detail : s.robotics_access_detail)?.score_basis || "") : s.score_notes[k.key] || "" }))
    .filter(x => typeof x.score === "number" && (x.score as number) >= threshold)
    .sort((a, b) => Number(Boolean(b.axis)) - Number(Boolean(a.axis)) || (b.score as number) - (a.score as number));
}

export default function WhyChoosePage() {
  const { hidden } = useHidden();
  const [sortBy, setSortBy] = useState<"fit"|"depth"|"name">("fit");

  const list = useMemo(() => {
    const arr = schools.filter(s => !hidden.has(s.slug));
    if (sortBy === "name") arr.sort((a,b) => a.short.localeCompare(b.short));
    else if (sortBy === "depth") arr.sort((a,b) => (b.axes.robotics_curriculum ?? 0) - (a.axes.robotics_curriculum ?? 0));
    else {
      arr.sort((a,b) => roboticsAiFit(b) - roboticsAiFit(a) || a.short.localeCompare(b.short));
    }
    return arr;
  }, [hidden, sortBy]);

  return (
    <div className="space-y-4">
      {/* Intro card */}
      <div className="card p-4 md:p-5 flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent))]">
            <Sparkles size={18}/>
          </div>
          <div>
            <div className="serif text-[18px] font-semibold">Why to choose — the case for each school</div>
            <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-2xl leading-relaxed">
              Every school on this list has at least one thing it does uniquely well. This page distills the sharpest reasons to pick each one — with the concrete fact behind each claim.
            </div>
          </div>
        </div>
        <div className="text-[12px] shrink-0">
          <span className="text-[hsl(var(--muted-foreground))] mr-2">Sort</span>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)}
            className="text-[12px] py-1 px-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            <option value="fit">Robotics evidence fit</option>
            <option value="depth">Robotics curriculum</option>
            <option value="name">School name</option>
          </select>
        </div>
      </div>

      {/* One card per school */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {list.map(s => {
          const strengths = pickStrengths(s, 4);
          const top = strengths.slice(0, 5);
          return (
            <div key={s.slug} className="card p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="serif text-[19px] font-semibold leading-tight">{s.short}</div>
                  <div className="text-[11.5px] text-[hsl(var(--muted-foreground))]">{s.city_state} · {s.institution_type.split(",")[0]}</div>
                </div>
                <div className="flex items-center gap-1">
                  <NoteButton slug={s.slug} />
                  <HideButton slug={s.slug} compact />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <FitBadge fit={s.fit_classification} />
                <AccessBadge status={s.major_access_status} />
                <CostChip s={s} />
                <MyRatingChip slug={s.slug} />
              </div>

              {/* The headline sentence */}
              <div className="border-l-2 border-[hsl(var(--accent))] pl-3 py-1">
                <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--accent))] font-medium mb-0.5">Headline reason</div>
                <div className="text-[13.5px] leading-relaxed">{stripSourceTags(s.best_fit_reason)}</div>
              </div>

              {/* Top strengths list */}
              {top.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1.5">What sets it apart</div>
                  <div className="space-y-2">
                    {top.map(str => (
                      <div key={str.key} className="flex gap-2.5">
                        <div className="text-[16px] leading-[1.4]">{str.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[12.5px] font-medium">{str.label}</span>
                            <span className={`score-cell ${str.score === 5 ? "s5" : "s4"}`}>{str.score}</span>
                          </div>
                          <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] leading-snug">{stripSourceTags(str.note)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Institute + program facts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11.5px] pt-1">
                <FactBox label="Degree route" value={stripSourceTags(s.degree_name)} />
                {s.robotics_access_detail?.institute_or_center &&
                  <FactBox label="Robotics research setting" value={stripSourceTags(s.robotics_access_detail.institute_or_center)} />}
                {s.notable_undergraduate_research_program && s.notable_undergraduate_research_program !== "—" &&
                  <FactBox label="UG research program" value={stripSourceTags(s.notable_undergraduate_research_program)} />}
                {s.fourplusone_available && s.fourplusone_available.toLowerCase().startsWith("y") &&
                  <FactBox label="Accelerated master's (4+1)" value={stripSourceTags(s.fourplusone_name) || "Available"} />}
              </div>

              {/* Sparkline of the 7 axes */}
              <div className="pt-1">
                <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1.5">Program profile</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <AxisBar value={s.axes.robotics_curriculum ?? null} label="Robotics curriculum" />
                  <AxisBar value={s.axes.robotics_access ?? null} label="Robotics access" />
                  <AxisBar value={s.axes.hands_on} label="Hands-on projects" />
                  <AxisBar value={s.axes.program_depth} label="AI electives (supporting)" />
                  <AxisBar value={s.axes.hands_on} label="Hands-on" />
                  <AxisBar value={s.axes.ambition_healthy} label="Healthy ambition" />
                </div>
                <RoboticsDomainChips domains={s.robotics_domains} />
              </div>

              <EcePanel slug={s.slug} />

              <ChevronRight size={12} className="opacity-0"/> {/* spacer */}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact chips for the robotics subdomains a school actually covers.
const DOMAIN_LABELS: Record<string, string> = {
  humanoid_legged: "Humanoid / legged",
  swarm_multirobot: "Swarm / multi-robot",
  autonomous_vehicles: "Autonomous vehicles",
  manipulation_grasping: "Manipulation",
  aerial_uav: "Aerial / UAV",
  medical_surgical: "Medical / surgical",
  soft_robotics: "Soft robotics",
  hri: "Human-robot interaction",
  industrial_automation: "Industrial automation",
  space_field: "Space / field",
};

export function RoboticsDomainChips({ domains }: { domains?: Record<string, { coverage: string; lab_or_course?: string | null; url?: string | null }> }) {
  if (!domains) return null;
  const strong = Object.entries(domains).filter(([, v]) => v.coverage === "strong");
  const present = Object.entries(domains).filter(([, v]) => v.coverage === "present");
  if (strong.length === 0 && present.length === 0) return null;
  return (
    <div className="pt-2">
      <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Robotics research / course areas</div>
      <p className="text-[10px] text-[hsl(var(--muted-foreground))] mb-1">Research presence provides context; it does not guarantee an undergraduate lab place or course seat.</p>
      <div className="flex flex-wrap gap-1">
        {strong.map(([k, v]) => (
          <span key={k} className="chip text-[10.5px] py-0"
            style={{ color: "hsl(145 55% 30%)", borderColor: "hsl(145 45% 55%)", background: "hsl(145 55% 30% / 0.08)" }}
            title={v.lab_or_course ? `${DOMAIN_LABELS[k] || k}: ${v.lab_or_course}` : DOMAIN_LABELS[k] || k}>
            {DOMAIN_LABELS[k] || k}
          </span>
        ))}
        {present.map(([k, v]) => (
          <span key={k} className="chip chip-outline text-[10.5px] py-0 opacity-70"
            title={v.lab_or_course ? `${DOMAIN_LABELS[k] || k} (present): ${v.lab_or_course}` : `${DOMAIN_LABELS[k] || k} (present)`}>
            {DOMAIN_LABELS[k] || k}
          </span>
        ))}
      </div>
    </div>
  );
}

function FactBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[hsl(var(--muted)/0.5)] px-2.5 py-1.5 border border-[hsl(var(--border))]">
      <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className="leading-snug">{value}</div>
    </div>
  );
}


function EcePanel({ slug }: { slug: string }) {
  const r = (roboticsRoutes.schools as any)[slug];
  if (!r) return null;
  return <div className="mt-2 rounded-md border border-[hsl(var(--border))] p-3 text-[11.5px] space-y-2">
    <div className="font-medium">Recommended route · hardware, controls and autonomy</div>
    <p className="leading-relaxed">{r.recommended_summary}</p>
    <p className="text-[hsl(var(--muted-foreground))] leading-relaxed">{r.tradeoff}</p>
    <a href={r.recommended_route === "bs_robotics" ? r.bs_robotics.url : r[r.recommended_route].url} target="_blank" rel="noreferrer" className="text-[hsl(var(--accent))] hover:underline">Official program page</a>
  </div>;
}

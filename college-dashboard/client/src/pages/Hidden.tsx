import { useMemo } from "react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { HideButton, FitBadge, AbetBadge } from "@/components/SchoolBits";
import { RotateCcw, EyeOff, Bot, AlertTriangle, Info, Target, Cpu, Wrench } from "lucide-react";
import { useApplicantProfile, useOddsThresholds } from "@/lib/applicantProfile";
import { buildRoboticsFocus, DEFAULT_FOCUS_SPEC, MIN_ROBOTICS_CURRICULUM, TIER_LABEL, type FocusResult } from "@/lib/focusPreset";
import { Link } from "wouter";

export default function HiddenPage() {
  const { hidden, hiddenList, visible, clear, hideAllExcept } = useHidden();
  const [profile] = useApplicantProfile();
  const [thresholds] = useOddsThresholds();

  // Two balanced shortlists, one per application door.
  //
  // Which door you enter through is not a labelling detail: the same application
  // is ~19% to CMU's other seven colleges and 5.2% to SCS, ~21% to Grainger
  // Engineering and 7.4% to UIUC CS, 37% to UW's Direct-to-College Engineering
  // and 2% to Direct-to-Major CS for a non-resident. One list averaged those two
  // realities into a single answer that described neither route.
  const eceFocus = useMemo(
    () => buildRoboticsFocus(profile, { ...thresholds, pathway: "engineering" }, DEFAULT_FOCUS_SPEC),
    [profile, thresholds],
  );
  const csFocus = useMemo(
    () => buildRoboticsFocus(profile, { ...thresholds, pathway: "computing" }, DEFAULT_FOCUS_SPEC),
    [profile, thresholds],
  );
  const hasScore = profile.sat != null || profile.act != null;

  // Where the two routes agree and where they part company. The overlap is the
  // set worth applying to whichever door you choose; the route-only schools are
  // the actual decision.
  const routeSplit = useMemo(() => {
    const eceSlugs = eceFocus.picks.map(p => p.school.slug);
    const csSlugs = csFocus.picks.map(p => p.school.slug);
    const inCs = (x: string) => csSlugs.indexOf(x) !== -1;
    const inEce = (x: string) => eceSlugs.indexOf(x) !== -1;
    const name = (slug: string) => schools.find(x => x.slug === slug)?.short ?? slug;
    const union: string[] = [];
    for (const slug of eceSlugs.concat(csSlugs)) {
      if (union.indexOf(slug) === -1) union.push(slug);
    }
    return {
      both: eceSlugs.filter(inCs).map(name).sort(),
      eceOnly: eceSlugs.filter(x => !inCs(x)).map(name).sort(),
      csOnly: csSlugs.filter(x => !inEce(x)).map(name).sort(),
      union,
    };
  }, [eceFocus, csFocus]);

  // Quick presets — grouped by shortlist tier
  const groups: { key: string; label: string; slugs: string[]; hint: string }[] = [
    { key: "strongest", label: "Focus on strongest fits only", slugs: schools.filter(s => s.shortlist_group === "strongest").map(s=>s.slug), hint: "8 schools" },
    { key: "topplus",   label: "Strongest + strong alternatives", slugs: schools.filter(s => ["strongest","alternative"].includes(s.shortlist_group)).map(s=>s.slug), hint: "16 schools" },
    { key: "nc",        label: "North Carolina publics only", slugs: schools.filter(s => s.state === "NC").map(s=>s.slug), hint: "NC State + UNC" },
    { key: "dedicated", label: "Only schools with a dedicated AI degree", slugs: schools.filter(s => s.archetypes.includes("A")).map(s=>s.slug), hint: "Archetype A" },
    { key: "direct",    label: "Direct-admit CS/AI only", slugs: schools.filter(s => s.major_access_status === "DIRECT").map(s=>s.slug), hint: "No internal gate" },
  ];

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="serif text-[17px] font-semibold mb-1">Manage which schools are in view</div>
        <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-3xl">
          Hiding a school removes it from every view — overview cards, curriculum tables, culture matrix, side-by-side compare, and the application timeline. Nothing is deleted; you can restore anything anytime.
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button onClick={clear} className="chip chip-primary inline-flex items-center gap-1"
            disabled={hidden.size === 0}>
            <RotateCcw size={12}/> Restore all {hidden.size > 0 ? `(${hidden.size} hidden)` : ""}
          </button>
        </div>
      </div>

      {/* Two balanced shortlists, one per application door */}
      <div className="card p-4">
        <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
          <Bot size={15}/>
          <div className="text-[11px] tracking-wider uppercase">Robotics + AI focus</div>
        </div>
        <div className="serif text-[17px] font-semibold mt-1">
          Two balanced shortlists — one per application door
        </div>
        <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] mt-1.5 max-w-3xl leading-relaxed">
          Which door you apply through changes the odds by an order of magnitude at some schools,
          so a single list averaged two realities into an answer that described neither. Each list
          below is {DEFAULT_FOCUS_SPEC.high_reach} high reach · {DEFAULT_FOCUS_SPEC.reach} reach ·{" "}
          {DEFAULT_FOCUS_SPEC.target} target · {DEFAULT_FOCUS_SPEC.likely} likely, tiered by the same
          heuristic the <Link href="/odds" className="underline">Applicant odds</Link> page uses —
          per-college admit rates where a school publishes them, residency applied, and a CS-gate
          downgrade that only bites on the computing door. Within a tier, schools are ranked by
          researched robotics strength rather than prestige.
        </div>

        {!hasScore && (
          <div className="mt-3 text-[12px] rounded border border-[hsl(var(--fit-top)/0.4)] bg-[hsl(var(--fit-top)/0.08)] px-3 py-2">
            No test score saved yet, so tiers are based on admit rates alone. Add it on the{" "}
            <Link href="/odds" className="underline">Applicant odds</Link> page to sharpen the split —
            it stays on this device.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mt-3 text-[11.5px]">
          <div className="rounded border border-[hsl(var(--fit-top)/0.35)] bg-[hsl(var(--fit-top)/0.06)] px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--fit-top))] mb-0.5">
              On both routes · {routeSplit.both.length}
            </div>
            <div>{routeSplit.both.join(", ") || "—"}</div>
            <div className="text-[hsl(var(--muted-foreground))] mt-1">Safe to apply to either way.</div>
          </div>
          <div className="rounded border border-[hsl(var(--border))] px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-0.5">
              ECE route only · {routeSplit.eceOnly.length}
            </div>
            <div>{routeSplit.eceOnly.join(", ") || "—"}</div>
          </div>
          <div className="rounded border border-[hsl(var(--border))] px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-0.5">
              CS route only · {routeSplit.csOnly.length}
            </div>
            <div>{routeSplit.csOnly.join(", ") || "—"}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button onClick={()=>hideAllExcept(routeSplit.union)}
            className="chip chip-primary inline-flex items-center gap-1">
            <Target size={12}/> Focus on all {routeSplit.union.length} across both routes
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <RouteShortlist
          title="ECE / engineering route"
          blurb="Applying through the college of engineering — ME, ECE, first-year engineering. A CS-specific gate does not raise this admission bar, but it remains a risk to reaching the major later."
          icon={<Wrench size={14}/>}
          focus={eceFocus}
          onFocus={hideAllExcept}
        />
        <RouteShortlist
          title="CS / computing route"
          blurb="Applying directly to computer science or a computing college. Where a school publishes a per-college rate this uses it, and the CS gate applies here."
          icon={<Cpu size={14}/>}
          focus={csFocus}
          onFocus={hideAllExcept}
        />
      </div>

      <div className="card p-4">
        <div className="text-[13px] font-medium mb-2">Quick focus presets</div>
        <div className="text-[12px] text-[hsl(var(--muted-foreground))] mb-3">Hides everything except the schools that fit the preset. You can adjust manually afterwards.</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {groups.map(g => (
            <button key={g.key} onClick={()=>hideAllExcept(g.slugs)}
              className="text-left p-3 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--elevate-1))]">
              <div className="text-[13px] font-medium">{g.label}</div>
              <div className="text-[11.5px] text-[hsl(var(--muted-foreground))]">{g.hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-[13px] font-medium mb-3 flex items-center gap-1.5">
            <EyeOff size={13}/> Currently hidden ({hiddenList.length})
          </div>
          {hiddenList.length === 0 ? (
            <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] italic">Nothing hidden.</div>
          ) : (
            <div className="grid gap-1.5">
              {hiddenList.map(s => (
                <div key={s.slug} className="flex items-center justify-between border-b border-[hsl(var(--border))]/60 pb-1.5 last:border-0">
                  <div>
                    <div className="text-[13px] serif font-medium">{s.short}</div>
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{s.city_state}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <FitBadge fit={s.fit_classification} />
                    <HideButton slug={s.slug} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card p-4">
          <div className="text-[13px] font-medium mb-3">Currently visible ({visible.length})</div>
          <div className="grid gap-1.5">
            {visible.map(s => (
              <div key={s.slug} className="flex items-center justify-between border-b border-[hsl(var(--border))]/60 pb-1.5 last:border-0">
                <div>
                  <div className="text-[13px] serif font-medium">{s.short}</div>
                  <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{s.city_state}</div>
                </div>
                <div className="flex items-center gap-2">
                  <FitBadge fit={s.fit_classification} />
                  <HideButton slug={s.slug} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One balanced shortlist for one application door.
 * ------------------------------------------------------------------ */
function RouteShortlist({ title, blurb, icon, focus, onFocus }: {
  title: string;
  blurb: string;
  icon: React.ReactNode;
  focus: FocusResult;
  onFocus: (slugs: string[]) => void;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
        {icon}
        <div className="text-[11px] tracking-wider uppercase">{title}</div>
      </div>
      <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] mt-1.5 leading-snug">{blurb}</div>

      <div className="mt-3 space-y-2.5">
        {(["HIGH_REACH","REACH","TARGET","LIKELY"] as const).map(tier => {
          const inTier = focus.picks.filter(p => p.tier === tier);
          if (!inTier.length) return null;
          return (
            <div key={tier}>
              <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">
                {TIER_LABEL[tier]} · {inTier.length}
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {inTier.map(p => (
                  <div key={p.school.slug}
                    className="rounded border border-[hsl(var(--border))] px-2.5 py-2 text-[12px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="serif text-[13.5px] font-medium">
                        {p.school.short}{" "}
                        <AbetBadge credential={p.school.robotics_credential} compact />
                      </span>
                      <span className="num text-[11px] text-[hsl(var(--muted-foreground))]">
                        robotics {(p.school.axes.robotics_curriculum ?? 0).toFixed(0)}/{(p.school.axes.robotics_access ?? 0).toFixed(0)}
                        {p.rate != null && <> · {(p.rate*100).toFixed(1)}%</>}
                      </span>
                    </div>
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                      {p.context !== "overall" ? p.context : "overall admit rate"}
                    </div>
                    {/* A real obstacle to getting in keeps the alert treatment. */}
                    {p.caveat && (
                      <div className="text-[11px] mt-1 flex gap-1 text-[hsl(var(--fit-conditional))]">
                        <AlertTriangle size={11} className="shrink-0 mt-0.5"/>
                        <span>{p.caveat}</span>
                      </div>
                    )}
                    {/* Accreditation is background, not a warning. */}
                    {p.accreditation && (
                      <div className="text-[11px] mt-1 flex gap-1 text-[hsl(var(--muted-foreground))]">
                        <Info size={11} className="shrink-0 mt-0.5 opacity-70"/>
                        <span>{p.accreditation}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          onClick={()=>onFocus(focus.picks.map(p => p.school.slug))}
          className="chip chip-outline inline-flex items-center gap-1">
          <Target size={12}/> Focus on these {focus.picks.length}
        </button>
      </div>

      {focus.shortfalls.length > 0 && (
        <div className="text-[11.5px] text-[hsl(var(--fit-conditional))] mt-2.5 leading-relaxed">
          Not enough schools clear the bar to fill every tier:{" "}
          {focus.shortfalls.map(s => `${TIER_LABEL[s.tier]} (${s.got} of ${s.wanted})`).join(", ")}.
          That is a real gap in the list on this route, not a reason to promote a weaker school.
        </div>
      )}

      {focus.runnersUp.length > 0 && (
        <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed">
          <strong className="text-[hsl(var(--foreground))]">Just missed:</strong>{" "}
          {focus.runnersUp.map(r =>
            `${r.pick.school.short} (${TIER_LABEL[r.tier].toLowerCase()}, ${r.gapFromLastPick <= 0.05 ? "effectively tied" : `−${r.gapFromLastPick.toFixed(2)}`})`
          ).join(", ")}.
          Gaps under about 0.05 are noise — treat those as interchangeable.
        </div>
      )}

      {focus.excluded.length > 0 && (
        <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed">
          <strong className="text-[hsl(var(--foreground))]">Excluded from auto-pick:</strong>{" "}
          {focus.excluded.map(e => `${e.school.short} — ${e.why}`).join("; ")}.
        </div>
      )}

      {focus.belowBar.length > 0 && (
        <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed">
          <strong className="text-[hsl(var(--foreground))]">
            Below the robotics bar ({MIN_ROBOTICS_CURRICULUM}/5), never auto-picked:
          </strong>{" "}
          {focus.belowBar
            .sort((a, b) => (b.robotics_curriculum ?? 0) - (a.robotics_curriculum ?? 0))
            .map(b => b.school.short)
            .join(", ")}.
          Several are excellent for AI and stay selectable by hand.
        </div>
      )}
    </div>
  );
}

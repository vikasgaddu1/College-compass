import { useMemo } from "react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { HideButton, FitBadge, AbetBadge } from "@/components/SchoolBits";
import { RotateCcw, EyeOff, Bot, AlertTriangle, Target } from "lucide-react";
import { useApplicantProfile, useOddsThresholds } from "@/lib/applicantProfile";
import { buildRoboticsFocus, DEFAULT_FOCUS_SPEC, TIER_LABEL } from "@/lib/focusPreset";
import { Link } from "wouter";

export default function HiddenPage() {
  const { hidden, hiddenList, visible, clear, hideAllExcept } = useHidden();
  const [profile] = useApplicantProfile();
  const [thresholds] = useOddsThresholds();

  // Balanced robotics + AI shortlist, tiered with the same client-side heuristic
  // the Odds page uses, reading the applicant's own numbers from their profile.
  const focus = useMemo(
    () => buildRoboticsFocus(profile, thresholds, DEFAULT_FOCUS_SPEC),
    [profile, thresholds],
  );
  const hasScore = profile.sat != null || profile.act != null;

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

      {/* Robotics + AI balanced shortlist */}
      <div className="card p-4">
        <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
          <Bot size={15}/>
          <div className="text-[11px] tracking-wider uppercase">Robotics + AI focus</div>
        </div>
        <div className="serif text-[17px] font-semibold mt-1">
          Balanced shortlist — {DEFAULT_FOCUS_SPEC.high_reach} high reach · {DEFAULT_FOCUS_SPEC.reach} reach · {DEFAULT_FOCUS_SPEC.target} target · {DEFAULT_FOCUS_SPEC.likely} likely
        </div>
        <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] mt-1.5 max-w-3xl leading-relaxed">
          Tiers come from the same client-side heuristic the{" "}
          <Link href="/odds" className="underline">Applicant odds</Link>{" "}
          page uses — published admit rates with the in-state or out-of-state context applied, your
          test score compared to each school's mid-50%, and a one-tier downgrade where CS/AI sits
          behind a strong internal gate. Within each tier, schools are ranked by researched robotics
          strength (curriculum, access, and breadth across the ten subdomains) rather than prestige.
        </div>

        {!hasScore && (
          <div className="mt-3 text-[12px] rounded border border-[hsl(var(--fit-top)/0.4)] bg-[hsl(var(--fit-top)/0.08)] px-3 py-2">
            No test score saved yet, so tiers are based on admit rates alone. Add it on the{" "}
            <Link href="/odds" className="underline">Applicant odds</Link> page to sharpen the split —
            it stays on this device.
          </div>
        )}

        <div className="mt-3 space-y-2.5">
          {(["HIGH_REACH","REACH","TARGET","LIKELY"] as const).map(tier => {
            const inTier = focus.picks.filter(p => p.tier === tier);
            if (!inTier.length) return null;
            return (
              <div key={tier}>
                <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">
                  {TIER_LABEL[tier]} · {inTier.length}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
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
                      {p.caveat && (
                        <div className="text-[11px] mt-1 flex gap-1 text-[hsl(var(--fit-lower))]">
                          <AlertTriangle size={11} className="shrink-0 mt-0.5"/>
                          <span>{p.caveat}</span>
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
            onClick={()=>hideAllExcept(focus.picks.map(p => p.school.slug))}
            className="chip chip-primary inline-flex items-center gap-1">
            <Target size={12}/> Focus on these {focus.picks.length}
          </button>
        </div>

        {focus.runnersUp.length > 0 && (
          <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] mt-2.5 leading-relaxed">
            <strong className="text-[hsl(var(--foreground))]">Just missed the cut:</strong>{" "}
            {focus.runnersUp.map(r =>
              `${r.pick.school.short} (${TIER_LABEL[r.tier].toLowerCase()}, ${r.gapFromLastPick <= 0.05 ? "effectively tied" : `−${r.gapFromLastPick.toFixed(2)}`})`
            ).join(", ")}.
            Gaps under about 0.05 are noise rather than a real difference — treat those as
            interchangeable with the last pick in the same tier and choose on other grounds.
          </div>
        )}

        {focus.shortfalls.length > 0 && (
          <div className="text-[11.5px] text-[hsl(var(--fit-lower))] mt-2.5">
            Not enough schools to fill every tier:{" "}
            {focus.shortfalls.map(s => `${TIER_LABEL[s.tier]} (${s.got} of ${s.wanted})`).join(", ")}.
            Widen the list or adjust thresholds on the Applicant odds page rather than treating a
            thinner tier as a stronger one.
          </div>
        )}

        {focus.excluded.length > 0 && (
          <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-2.5 leading-relaxed">
            <strong className="text-[hsl(var(--foreground))]">Excluded from auto-pick:</strong>{" "}
            {focus.excluded.map(e => `${e.school.short} — ${e.why}`).join("; ")}.
            These stay available to select manually.
          </div>
        )}
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

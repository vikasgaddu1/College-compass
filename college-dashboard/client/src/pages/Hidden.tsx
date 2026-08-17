import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { HideButton, FitBadge } from "@/components/SchoolBits";
import { RotateCcw, EyeOff } from "lucide-react";

export default function HiddenPage() {
  const { hidden, hiddenList, visible, clear, hideAllExcept } = useHidden();

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

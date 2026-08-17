import { useState } from "react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { useWeights, axisMeta, AxisKey } from "@/lib/weights";
import { Sliders, RotateCcw, ChevronRight, ChevronDown, Trophy } from "lucide-react";
import { Link } from "wouter";

/** Collapsible panel that lets the user weight the seven aggregate axes 0-5,
 *  and shows the top 8 schools by personal score.  */
export function PersonalPriorities() {
  const { weights, setWeight, reset, personalScore, isCustomized } = useWeights();
  const { visible } = useHidden();
  const [open, setOpen] = useState(false);

  const ranked = visible
    .map(s => ({ s, score: personalScore(s) }))
    .filter(x => x.score != null)
    .sort((a, b) => (b.score! - a.score!))
    .slice(0, 8);

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full p-4 flex items-center justify-between hover:bg-[hsl(var(--elevate-1))] transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent))] shrink-0">
            <Sliders size={16}/>
          </div>
          <div className="text-left min-w-0">
            <div className="text-[13.5px] font-medium">Your priorities · personalized ranking</div>
            <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] truncate">
              {isCustomized ? `Weighted score computed from your ${axisMeta.filter(a => weights[a.key] > 0).length} priorities` : "Tap to weight what you care about most"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isCustomized && !open && (
            <span className="chip chip-accent hidden md:inline-flex">Personalized</span>
          )}
          {open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
        </div>
      </button>

      {open && (
        <div className="border-t border-[hsl(var(--border))] p-4 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6">
          {/* Sliders */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[12.5px] font-medium">How much do you care about each factor?</div>
              {isCustomized && (
                <button onClick={reset}
                  className="text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] inline-flex items-center gap-1">
                  <RotateCcw size={11}/> Reset
                </button>
              )}
            </div>
            <div className="space-y-2.5">
              {axisMeta.map(({ key, label, blurb }) => (
                <WeightSlider key={key} axisKey={key} label={label} blurb={blurb}
                  value={weights[key]} onChange={v => setWeight(key, v)}/>
              ))}
            </div>
            <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-3 leading-relaxed">
              Sliders save automatically to your browser. Schools with insufficient evidence on a weighted axis are skipped for that axis only.
            </div>
          </div>

          {/* Top 8 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Trophy size={13} className="text-[hsl(var(--accent))]"/>
              <div className="text-[12.5px] font-medium">Top matches for your priorities</div>
            </div>
            <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mb-3">Among visible schools, ranked by your weighted score. Fit tiers still apply — this is not a substitute for reading each profile.</div>
            <div className="space-y-1">
              {ranked.map((r, i) => (
                <Link key={r.s.slug} href="/why"
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[hsl(var(--elevate-1))]">
                  <span className="w-5 text-center text-[11px] font-semibold text-[hsl(var(--muted-foreground))] num">{i+1}</span>
                  <span className="text-[13px] font-medium flex-1 truncate">{r.s.short}</span>
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))] hidden md:inline">{r.s.city_state.split(",")[1]?.trim() || ""}</span>
                  <span className={`chip ${classifyScore(r.score!)}`}>
                    {r.score!.toFixed(1)}
                  </span>
                </Link>
              ))}
              {ranked.length === 0 && (
                <div className="text-[12px] text-[hsl(var(--muted-foreground))] p-3">
                  No schools have enough evidence on your weighted axes. Try lowering some weights or restoring hidden schools.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WeightSlider({ axisKey, label, blurb, value, onChange }:
  { axisKey: AxisKey; label: string; blurb: string; value: number; onChange: (v: number) => void }) {
  const dots = [0, 1, 2, 3, 4, 5];
  const importanceLabel = ["Skip", "Barely", "A little", "Somewhat", "A lot", "Must-have"][value];
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-[12px] font-medium">{label}</div>
        <div className="text-[10.5px] text-[hsl(var(--muted-foreground))]">{importanceLabel}</div>
      </div>
      <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] leading-tight mb-1">{blurb}</div>
      <div className="flex items-center gap-1">
        {dots.map(d => (
          <button key={d} onClick={() => onChange(d)} title={`${d}: ${["Skip","Barely","A little","Somewhat","A lot","Must-have"][d]}`}
            className={`flex-1 h-2 rounded ${d <= value ? "bg-[hsl(var(--accent))]" : "bg-[hsl(var(--muted))]"} hover:opacity-90`}
            style={{ minWidth: 22 }}/>
        ))}
      </div>
    </div>
  );
}

function classifyScore(v: number) {
  if (v >= 4.3) return "fit-top";
  if (v >= 3.6) return "fit-strong";
  if (v >= 2.9) return "fit-conditional";
  return "chip-outline";
}

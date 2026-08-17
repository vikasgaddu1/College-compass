import { useState, useMemo } from "react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { NoteButton } from "@/components/SchoolBits";
import redditData from "@/data/reddit.json";
import { MessageCircle, ThumbsUp, ThumbsDown, AlertTriangle, Search } from "lucide-react";

export default function CultureSignalsPage() {
  const { hidden } = useHidden();
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const list = schools
      .filter(s => !hidden.has(s.slug))
      .map(s => ({ s, d: (redditData.schools as any)[s.slug] }))
      .filter(({ d }) => !!d);
    return list.filter(({ s, d }) => {
      if (!q.trim()) return true;
      const needle = q.toLowerCase();
      return (`${s.short} ${d.vibe} ${d.praises?.join(" ")} ${d.complaints?.join(" ")}`).toLowerCase().includes(needle);
    });
  }, [q, hidden]);

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
          <MessageCircle size={16}/>
          <div className="text-[11px] tracking-wider uppercase">Reddit sentiment · ANECDOTAL</div>
        </div>
        <h2 className="serif text-[22px] font-semibold mt-1">What students say about each school</h2>
        <div className="rounded-md bg-[hsl(var(--elevate-1))] p-3 mt-3 flex gap-2 text-[12px] items-start max-w-[820px]">
          <AlertTriangle size={14} className="text-[hsl(var(--fit-conditional))] shrink-0 mt-0.5"/>
          <div className="leading-relaxed">
            <strong>Read as anecdotes, not evidence.</strong> Every bullet here is drawn from recent posts in each school's subreddit. It captures the community's vibe — not verified truth. Verify anything decision-relevant against the school's own pages, official surveys, or a campus visit.
          </div>
        </div>
      </div>

      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"/>
          <input value={q} onChange={e=>setQ(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 text-[13px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
            placeholder="Search a theme (grade deflation, Greek, weather, mental health)…"/>
        </div>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{rows.length} schools</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {rows.map(({ s, d }) => (
          <div key={s.slug} className="card p-4">
            <div className="flex items-baseline justify-between mb-2 flex-wrap gap-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h3 className="serif text-[15.5px] font-semibold">{s.short}</h3>
                <NoteButton slug={s.slug}/>
              </div>
              <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{d.sub} · {d.members}</span>
            </div>

            <div className="rounded-md bg-[hsl(var(--elevate-1))] p-2.5 text-[12.5px] italic leading-relaxed mb-3">
              "{d.vibe}"
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--fit-strong))] flex items-center gap-1 mb-1">
                  <ThumbsUp size={10}/> Praised
                </div>
                <ul className="space-y-1">
                  {d.praises?.map((p: string, i: number) => (
                    <li key={i} className="text-[12px] leading-snug flex gap-1.5">
                      <span className="text-[hsl(var(--fit-strong))] shrink-0">•</span><span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--fit-lower))] flex items-center gap-1 mb-1">
                  <ThumbsDown size={10}/> Complained about
                </div>
                <ul className="space-y-1">
                  {d.complaints?.map((c: string, i: number) => (
                    <li key={i} className="text-[12px] leading-snug flex gap-1.5">
                      <span className="text-[hsl(var(--fit-lower))] shrink-0">•</span><span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

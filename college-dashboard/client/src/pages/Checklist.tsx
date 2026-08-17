import { useState, useMemo } from "react";
import { schools } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { NoteButton } from "@/components/SchoolBits";
import checklistData from "@/data/checklists.json";
import { ClipboardCheck, ExternalLink, Search } from "lucide-react";

export default function ChecklistPage() {
  const { hidden } = useHidden();
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "essays" | "fee">("name");

  const rows = useMemo(() => {
    const list = schools
      .filter(s => !hidden.has(s.slug))
      .map(s => ({ s, d: (checklistData.schools as any)[s.slug] }))
      .filter(({ d }) => !!d);
    return list
      .filter(({ s, d }) => {
        if (!q.trim()) return true;
        const needle = q.toLowerCase();
        return `${s.short} ${s.name} ${d.platform} ${d.prompts || ""}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        if (sortBy === "essays") {
          const ea = typeof a.d.supp_essay_count === "number" ? a.d.supp_essay_count : 99;
          const eb = typeof b.d.supp_essay_count === "number" ? b.d.supp_essay_count : 99;
          return eb - ea;
        }
        if (sortBy === "fee") {
          const fa = parseFee(a.d.fee); const fb = parseFee(b.d.fee);
          return fb - fa;
        }
        return a.s.short.localeCompare(b.s.short);
      });
  }, [q, hidden, sortBy]);

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
          <ClipboardCheck size={16}/>
          <div className="text-[11px] tracking-wider uppercase">Application checklist · 2026-27 cycle</div>
        </div>
        <h2 className="serif text-[22px] font-semibold mt-1">What each application actually requires</h2>
        <p className="text-[13.5px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed max-w-[820px]">
          Every school's required application components: platform, essay count, recommendation letters, interview policy, fee, and any unusual requirement. Note that some schools publish supplemental prompts only in the Common App member section — those show as unpublished here.
        </p>
      </div>

      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"/>
          <input value={q} onChange={e=>setQ(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 text-[13px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
            placeholder="Search platform, prompts, or school…"/>
        </div>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)}
          className="text-[12px] py-1.5 px-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <option value="name">Sort: Name</option>
          <option value="essays">Sort: Essay count (high→low)</option>
          <option value="fee">Sort: Fee (high→low)</option>
        </select>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{rows.length} schools</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map(({ s, d }) => (
          <div key={s.slug} className="card p-4">
            <div className="flex items-baseline justify-between mb-2 flex-wrap gap-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h3 className="serif text-[15.5px] font-semibold">{s.short}</h3>
                <NoteButton slug={s.slug}/>
              </div>
              <span className="chip chip-outline text-[10px]">{d.cycle}</span>
            </div>
            <div className="text-[12px] text-[hsl(var(--muted-foreground))] mb-3">{d.platform}</div>

            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <KV label="Supp. essays" value={String(d.supp_essay_count)}/>
              <KV label="App fee" value={d.fee}/>
              <KV label="Teacher recs" value={String(d.teacher_recs)}/>
              <KV label="Counselor rec" value={d.counselor_rec}/>
              <KV label="Interview" value={d.interview} full/>
            </div>

            {d.prompts && d.prompts !== "n.a." && (
              <div className="mt-3 border-t border-[hsl(var(--border))] pt-2">
                <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-1">Prompts</div>
                <div className="text-[12.5px] leading-relaxed">{d.prompts}</div>
              </div>
            )}

            {d.special && d.special !== "None" && (
              <div className="mt-2">
                <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--accent))] mb-0.5">Watch out for</div>
                <div className="text-[12.5px] leading-relaxed">{d.special}</div>
              </div>
            )}

            {d.sources && d.sources.length > 0 && (
              <div className="mt-3 pt-2 border-t border-[hsl(var(--border))] flex flex-wrap gap-2 text-[10.5px]">
                {d.sources.map((src: any, i: number) => (
                  <a key={i} href={src.url} target="_blank" rel="noopener" className="text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">
                    {src.label} <ExternalLink size={9}/>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function KV({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className="text-[12.5px]">{value || "—"}</div>
    </div>
  );
}

function parseFee(fee: string): number {
  if (!fee) return 0;
  if (/free/i.test(fee)) return 0;
  const m = /\$(\d+)/.exec(fee);
  return m ? +m[1] : 0;
}

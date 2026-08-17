import { useState, useMemo } from "react";
import { schools, School } from "@/lib/data";
import { useHidden } from "@/lib/hidden";
import { NoteButton } from "@/components/SchoolBits";
import scholarshipData from "@/data/scholarships.json";
import { Coins, Award, ExternalLink, Search, Filter } from "lucide-react";

type Sch = typeof scholarshipData.schools[keyof typeof scholarshipData.schools];

const generosityOrder: Record<string, number> = {
  "Very generous": 6, "Generous": 5, "Modest": 4, "Very limited": 3,
  "Minimal": 2, "Minimal breadth, extraordinary for selectees": 3,
  "Modest broadly, generous for Honors/Stamps selectees": 4,
  "Modest (few awards, each at full-tuition level)": 3.5,
  "Generous (breadth confirmed, amounts unpublished)": 4.5,
  "Generous (esp. OOS)": 5,
  "None (need-only)": 0,
};

const generosityColor: Record<string, string> = {
  "Very generous": "chip-primary",
  "Generous": "chip-primary",
  "Modest": "chip-accent",
  "Very limited": "chip-outline",
  "Minimal": "chip-outline",
  "None (need-only)": "chip-outline",
};

export default function ScholarshipsPage() {
  const { hidden } = useHidden();
  const [q, setQ] = useState("");
  const [onlyEDBonus, setOnlyEDBonus] = useState(false);
  const [onlyMerit, setOnlyMerit] = useState(false);

  const rows = useMemo(() => {
    const list = schools
      .filter(s => !hidden.has(s.slug))
      .map(s => ({ s, d: (scholarshipData.schools as any)[s.slug] as Sch | undefined }))
      .filter((x): x is { s: School; d: Sch } => !!x.d);
    return list
      .filter(({ s, d }) => {
        if (onlyEDBonus && !d.ed_specific) return false;
        if (onlyMerit && d.offers_merit === "None") return false;
        if (q.trim()) {
          const needle = q.toLowerCase();
          const hay = `${s.short} ${s.name} ${d.flagship || ""} ${d.note || ""} ${(d.named_awards || []).join(" ")}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => (generosityOrder[b.d.generosity] || 0) - (generosityOrder[a.d.generosity] || 0));
  }, [q, hidden, onlyEDBonus, onlyMerit]);

  const totalWithED = Object.values(scholarshipData.schools).filter((x: any) => x.ed_specific).length;
  const totalWithMerit = Object.values(scholarshipData.schools).filter((x: any) => x.offers_merit !== "None").length;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="card p-5">
        <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
          <Coins size={16} />
          <div className="text-[11px] tracking-wider uppercase">Merit + named scholarships · Fall 2027 cycle</div>
        </div>
        <h2 className="serif text-[22px] font-semibold mt-1">Where merit money is actually on the table</h2>
        <p className="text-[13.5px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed max-w-[820px]">
          Not every school offers merit aid. This page shows the flagship merit award at each school, plus named / competitive awards, ED-specific bonuses, and out-of-state-only awards for the public universities. All figures come from each school's official aid or scholarships pages, and every entry links back to the source.
        </p>
        <div className="mt-4 flex flex-wrap gap-4 text-[12.5px]">
          <div><span className="num text-[18px] font-semibold">{totalWithMerit}</span><span className="text-[hsl(var(--muted-foreground))]"> of {Object.keys(scholarshipData.schools).length} offer merit</span></div>
          <div><span className="num text-[18px] font-semibold text-[hsl(var(--accent))]">{totalWithED}</span><span className="text-[hsl(var(--muted-foreground))]"> have ED-specific bonuses</span></div>
          <div><span className="num text-[18px] font-semibold">{Object.values(scholarshipData.schools).filter((x: any) => x.oos_specific).length}</span><span className="text-[hsl(var(--muted-foreground))]"> have OOS-specific awards</span></div>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"/>
          <input value={q} onChange={e=>setQ(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 text-[13px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
            placeholder="Search flagship, named awards, or a school…"/>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] cursor-pointer">
          <input type="checkbox" checked={onlyEDBonus} onChange={e=>setOnlyEDBonus(e.target.checked)}/>
          Only schools with ED bonus
        </label>
        <label className="flex items-center gap-1.5 text-[12px] cursor-pointer">
          <input type="checkbox" checked={onlyMerit} onChange={e=>setOnlyMerit(e.target.checked)}/>
          Exclude need-only schools
        </label>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1"><Filter size={11}/>{rows.length} shown</div>
      </div>

      {/* Rows */}
      <div className="space-y-3">
        {rows.map(({ s, d }) => <ScholarshipCard key={s.slug} school={s} data={d} />)}
      </div>

      {/* Footer / source */}
      <div className="card p-3 text-[11px] text-[hsl(var(--muted-foreground))]">
        Compiled {scholarshipData.compiled_date} from each school's official pages. Amounts change every cycle — always confirm on the school's own page before applying.
      </div>
    </div>
  );
}

function ScholarshipCard({ school, data }: { school: School; data: Sch }) {
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="serif text-[16.5px] font-semibold">{school.short}</h3>
          <div className="text-[11.5px] text-[hsl(var(--muted-foreground))]">{school.city_state}</div>
          <NoteButton slug={school.slug}/>
        </div>
        <span className={`chip ${generosityColor[data.generosity] || "chip-outline"}`} title="My qualitative assessment based on published amounts + reach">
          <Award size={11}/> {data.generosity}
        </span>
      </div>

      {data.flagship ? (
        <div className="mt-2 rounded-md bg-[hsl(var(--elevate-1))] p-3">
          <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Flagship merit award</div>
          <div className="serif text-[15.5px] font-medium mt-0.5">{data.flagship}</div>
          <div className="num text-[13.5px] text-[hsl(var(--accent))] font-semibold mt-1">{data.flagship_amount}</div>
        </div>
      ) : (
        <div className="mt-2 rounded-md bg-[hsl(var(--elevate-1))] p-3 text-[13px] text-[hsl(var(--muted-foreground))]">
          {data.note}
        </div>
      )}

      {data.ed_specific && (
        <div className="mt-3 border-l-2 border-[hsl(var(--accent))] pl-3">
          <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--accent))]">Bonus for ED applicants</div>
          <div className="text-[13px] mt-0.5">{data.ed_specific}</div>
        </div>
      )}

      {data.auto_criteria && (
        <div className="mt-3">
          <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Automatic-consideration awards</div>
          <div className="text-[12.5px] leading-relaxed mt-0.5">{data.auto_criteria}</div>
        </div>
      )}

      {data.oos_specific && (
        <div className="mt-3">
          <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Out-of-state-specific</div>
          <div className="text-[12.5px] leading-relaxed mt-0.5">{data.oos_specific}</div>
        </div>
      )}

      {data.named_awards && data.named_awards.length > 0 && (
        <div className="mt-3">
          <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Named / competitive awards</div>
          <ul className="mt-1 space-y-0.5">
            {data.named_awards.map((n, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed flex gap-2">
                <span className="text-[hsl(var(--accent))]">•</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.flagship && data.note && (
        <div className="mt-3 text-[11.5px] text-[hsl(var(--muted-foreground))] leading-relaxed italic">
          {data.note}
        </div>
      )}

      {data.sources && data.sources.length > 0 && (
        <div className="mt-3 pt-2 border-t border-[hsl(var(--border))] flex flex-wrap gap-2 text-[10.5px]">
          <span className="text-[hsl(var(--muted-foreground))]">Sources:</span>
          {data.sources.map((src: any, i: number) => (
            <a key={i} href={src.url} target="_blank" rel="noopener"
              className="text-[hsl(var(--accent))] hover:underline inline-flex items-center gap-0.5">
              {src.label} <ExternalLink size={9}/>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

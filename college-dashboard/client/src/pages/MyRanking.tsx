import { useMemo, useState, useRef } from "react";
import { schools, stripSourceTags } from "@/lib/data";
import { useRanks } from "@/lib/ranks";
import { useHidden } from "@/lib/hidden";
import { useNotes } from "@/lib/notes";
import { NoteButton } from "@/components/SchoolBits";
import { GripVertical, ChevronUp, ChevronDown, X, RotateCcw, Search, Plus, ListOrdered, Sparkles, Download, Upload } from "lucide-react";

/**
 * My Ranking — dedicated page for building a personal ranked list of schools.
 *
 * Layout: two columns.
 *   Left: ranked schools (drag-to-reorder + up/down + remove + rank input)
 *   Right: unranked schools (searchable, click to add to bottom of list)
 */
export default function MyRankingPage() {
  const { ranks, setRank, moveUp, moveDown, reorder, clearAll, rankedCount } = useRanks();
  const { hidden } = useHidden();
  const { getNote } = useNotes();
  const [q, setQ] = useState("");
  const [dragSlug, setDragSlug] = useState<string | null>(null);
  const [overSlug, setOverSlug] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const visibleSchools = useMemo(
    () => schools.filter(s => !hidden.has(s.slug)),
    [hidden]
  );

  const rankedList = useMemo(() => {
    return visibleSchools
      .filter(s => ranks[s.slug] != null)
      .sort((a, b) => (ranks[a.slug] ?? 999) - (ranks[b.slug] ?? 999));
  }, [visibleSchools, ranks]);

  const unrankedList = useMemo(() => {
    const list = visibleSchools.filter(s => ranks[s.slug] == null);
    if (!q.trim()) return list;
    const needle = q.toLowerCase();
    return list.filter(s => (`${s.short} ${s.name} ${s.city_state}`).toLowerCase().includes(needle));
  }, [visibleSchools, ranks, q]);

  // Simple HTML5 drag-and-drop for the ranked list
  const onDragStart = (slug: string) => setDragSlug(slug);
  const onDragEnd = () => { setDragSlug(null); setOverSlug(null); };
  const onDragOver = (e: React.DragEvent, slug: string) => {
    e.preventDefault();
    if (slug !== overSlug) setOverSlug(slug);
  };
  const onDrop = (targetSlug: string) => {
    if (!dragSlug || dragSlug === targetSlug) { onDragEnd(); return; }
    const order = rankedList.map(s => s.slug);
    const fromIdx = order.indexOf(dragSlug);
    const toIdx = order.indexOf(targetSlug);
    if (fromIdx < 0 || toIdx < 0) { onDragEnd(); return; }
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, dragSlug);
    reorder(order);
    onDragEnd();
  };

  const addToRanking = (slug: string) => {
    // Append to bottom = rank == rankedCount + 1
    setRank(slug, rankedCount + 1);
  };

  // Export as JSON — portable across devices
  const exportJSON = () => {
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      source: "College Compass — My Ranking",
      count: rankedCount,
      ranks,
      // Also include a human-readable list for reference
      ordered_slugs: schools
        .filter(s => ranks[s.slug] != null)
        .sort((a, b) => (ranks[a.slug] ?? 999) - (ranks[b.slug] ?? 999))
        .map(s => ({ rank: ranks[s.slug], slug: s.slug, name: s.short })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `college-compass-ranking-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export as Markdown — human-shareable
  const exportMarkdown = () => {
    const rankedForExport = schools
      .filter(s => ranks[s.slug] != null)
      .sort((a, b) => (ranks[a.slug] ?? 999) - (ranks[b.slug] ?? 999));
    const lines: string[] = [
      `# My College Ranking`,
      `_Exported ${new Date().toLocaleString()} · ${rankedCount} schools ranked_`,
      "",
    ];
    rankedForExport.forEach(s => {
      const note = getNote(s.slug);
      lines.push(`## ${ranks[s.slug]}. ${s.short}`);
      lines.push(`_${s.city_state} · ${s.fit_classification}_`);
      lines.push("");
      lines.push(`**Why here:** ${stripSourceTags(s.best_fit_reason)}`);
      lines.push("");
      lines.push(`**Biggest concern:** ${stripSourceTags(s.biggest_concern)}`);
      if (note?.notes?.trim() || note?.pros?.trim() || note?.cons?.trim()) {
        lines.push("");
        lines.push(`**My notes:**`);
        if (note.pros?.trim()) lines.push(`- ✅ ${note.pros.trim()}`);
        if (note.cons?.trim()) lines.push(`- ⚠️ ${note.cons.trim()}`);
        if (note.notes?.trim()) lines.push(`- ${note.notes.trim()}`);
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `college-ranking-${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import JSON exported from another device
  const importJSON = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      let incoming: Record<string, number> = {};

      if (parsed && typeof parsed === "object" && parsed.ranks && typeof parsed.ranks === "object") {
        // Native format from this app
        for (const [k, v] of Object.entries(parsed.ranks)) {
          if (typeof v === "number" && v > 0) incoming[k] = Math.floor(v);
        }
      } else if (Array.isArray(parsed)) {
        // Fallback: array of slugs treated as ordered list
        parsed.forEach((slug, i) => {
          if (typeof slug === "string") incoming[slug] = i + 1;
        });
      } else {
        throw new Error("Unrecognized file format");
      }

      const count = Object.keys(incoming).length;
      if (count === 0) {
        alert("No valid ranks found in this file.");
        return;
      }
      if (!confirm(`Import ${count} ranked schools from this file? Your current ranking will be replaced.`)) return;

      // Only import slugs that exist in our school list
      const validSlugs = new Set(schools.map(s => s.slug));
      const filtered: Record<string, number> = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (validSlugs.has(k)) filtered[k] = v;
      }
      // Renormalize so ranks run 1..N consecutively
      const ordered = Object.entries(filtered).sort((a, b) => a[1] - b[1]).map(([s]) => s);
      reorder(ordered);
    } catch (err) {
      alert(`Import failed: ${(err as Error).message || "unknown error"}`);
    }
  };

  const suggestFromEvidence = () => {
    // Pre-fill ranking with schools ordered by best_fit_reason strength as a starting draft
    const order = [...visibleSchools].sort((a, b) => {
      const fitOrder: Record<string, number> = { "TOP FIT": 0, "STRONG FIT": 1, "CONDITIONAL FIT": 2, "LOWER FIT": 3 };
      const af = fitOrder[a.fit_classification] ?? 4;
      const bf = fitOrder[b.fit_classification] ?? 4;
      if (af !== bf) return af - bf;
      // Tiebreak by axes.program_depth
      const ap = (a.axes?.program_depth ?? 0);
      const bp = (b.axes?.program_depth ?? 0);
      return bp - ap;
    }).map(s => s.slug);
    reorder(order);
  };

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="card p-5">
        <div className="flex items-baseline gap-2 text-[hsl(var(--accent))]">
          <ListOrdered size={16}/>
          <div className="text-[11px] tracking-wider uppercase">My ranking</div>
        </div>
        <h2 className="serif text-[22px] font-semibold mt-1">Rank the schools by your own priorities</h2>
        <p className="text-[13.5px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed max-w-[820px]">
          Drag rows to reorder, use the up/down arrows, or type a number to set an exact rank. Your ranking saves to this browser. Once you've ranked schools, every list on the dashboard can be sorted by "My rank."
        </p>
        <div className="mt-4 flex flex-wrap gap-3 items-center">
          <div className="chip chip-primary"><ListOrdered size={11}/> {rankedCount} of {visibleSchools.length} ranked</div>
          {rankedCount === 0 && (
            <button onClick={suggestFromEvidence}
              className="chip chip-outline inline-flex items-center gap-1 hover:bg-[hsl(var(--elevate-1))]">
              <Sparkles size={11}/> Start with the evidence-based ranking
            </button>
          )}
          {rankedCount > 0 && (
            <>
              <button onClick={exportJSON} title="Save your ranking as JSON to move between devices"
                className="chip chip-outline inline-flex items-center gap-1 hover:bg-[hsl(var(--elevate-1))]">
                <Download size={11}/> Export JSON
              </button>
              <button onClick={exportMarkdown} title="Save your ranking as Markdown to share with family/counselor"
                className="chip chip-outline inline-flex items-center gap-1 hover:bg-[hsl(var(--elevate-1))]">
                <Download size={11}/> Export Markdown
              </button>
            </>
          )}
          <button onClick={() => fileInputRef.current?.click()}
            title="Import a ranking JSON file from another device"
            className="chip chip-outline inline-flex items-center gap-1 hover:bg-[hsl(var(--elevate-1))]">
            <Upload size={11}/> Import JSON
          </button>
          <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJSON(f);
              e.target.value = ""; // allow reimporting same file
            }}/>
          {rankedCount > 0 && (
            <button onClick={() => { if (confirm("Clear your ranking?")) clearAll(); }}
              className="chip chip-outline inline-flex items-center gap-1 hover:bg-[hsl(var(--elevate-1))]">
              <RotateCcw size={11}/> Clear all ranks
            </button>
          )}
        </div>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-3 leading-relaxed">
          Your ranking saves to <strong>your browser on this device</strong>. Use <em>Export JSON</em> here and <em>Import JSON</em> on your other device (phone, school laptop) to sync. <em>Export Markdown</em> is for sharing with family or your counselor.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-4">
        {/* Ranked column */}
        <div className="card overflow-hidden">
          <div className="p-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
            <div className="text-[13px] font-medium">Your ranked list</div>
            <div className="text-[11px] text-[hsl(var(--muted-foreground))]">Drag to reorder</div>
          </div>
          {rankedList.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-[hsl(var(--muted-foreground))]">
              You haven't ranked any schools yet. Click any school on the right to add it, or use "Start with the evidence-based ranking" above.
            </div>
          ) : (
            <div>
              {rankedList.map((s, i) => {
                const rank = ranks[s.slug];
                const note = getNote(s.slug);
                const isDragging = dragSlug === s.slug;
                const isOver = overSlug === s.slug && dragSlug !== s.slug;
                return (
                  <div key={s.slug}
                    draggable
                    onDragStart={() => onDragStart(s.slug)}
                    onDragEnd={onDragEnd}
                    onDragOver={(e) => onDragOver(e, s.slug)}
                    onDrop={() => onDrop(s.slug)}
                    className={`flex items-center gap-2 p-2.5 border-b border-[hsl(var(--border))] last:border-b-0 ${isDragging ? "opacity-40" : ""} ${isOver ? "bg-[hsl(var(--accent)/0.08)]" : "hover:bg-[hsl(var(--elevate-1))]"}`}>
                    <GripVertical size={14} className="text-[hsl(var(--muted-foreground))] cursor-grab shrink-0"/>
                    <RankBadge rank={rank} onChange={(v) => setRank(s.slug, v)} max={visibleSchools.length}/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <div className="serif font-medium text-[13.5px]">{s.short}</div>
                        <div className="text-[10.5px] text-[hsl(var(--muted-foreground))]">{s.city_state}</div>
                        <span className="chip chip-outline text-[10px] py-0">{s.fit_classification}</span>
                        {note?.rating ? <span className="chip chip-outline text-[10px] py-0" title={`My rating ${note.rating}/5`}>{"★".repeat(note.rating)}</span> : null}
                        <NoteButton slug={s.slug}/>
                      </div>
                      <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] mt-0.5 leading-snug truncate">
                        {stripSourceTags(s.best_fit_reason).slice(0, 120)}
                      </div>
                    </div>
                    <div className="flex flex-col shrink-0">
                      <button onClick={() => moveUp(s.slug)} disabled={i === 0}
                        className="p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-30" title="Move up">
                        <ChevronUp size={14}/>
                      </button>
                      <button onClick={() => moveDown(s.slug)} disabled={i === rankedList.length - 1}
                        className="p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-30" title="Move down">
                        <ChevronDown size={14}/>
                      </button>
                    </div>
                    <button onClick={() => setRank(s.slug, null)}
                      className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--fit-lower))] shrink-0" title="Remove from ranking">
                      <X size={14}/>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Unranked column */}
        <div className="card overflow-hidden">
          <div className="p-3 border-b border-[hsl(var(--border))]">
            <div className="text-[13px] font-medium mb-2">Add schools to your ranking</div>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"/>
              <input value={q} onChange={e=>setQ(e.target.value)}
                className="w-full pl-8 pr-2 py-1.5 text-[13px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
                placeholder="Search unranked schools…"/>
            </div>
          </div>
          {unrankedList.length === 0 ? (
            <div className="p-6 text-center text-[13px] text-[hsl(var(--muted-foreground))]">
              {rankedCount === visibleSchools.length ? "All visible schools are ranked." : "No matching schools."}
            </div>
          ) : (
            <div>
              {unrankedList.map(s => (
                <button key={s.slug} onClick={() => addToRanking(s.slug)}
                  className="w-full flex items-center gap-2 p-2.5 border-b border-[hsl(var(--border))] last:border-b-0 hover:bg-[hsl(var(--elevate-1))] text-left">
                  <Plus size={14} className="text-[hsl(var(--accent))] shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <div className="serif font-medium text-[13px]">{s.short}</div>
                      <div className="text-[10.5px] text-[hsl(var(--muted-foreground))]">{s.city_state}</div>
                      <span className="chip chip-outline text-[10px] py-0">{s.fit_classification}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RankBadge({ rank, onChange, max }: { rank: number; onChange: (v: number) => void; max: number }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(rank));

  if (editing) {
    return (
      <input
        type="number" min={1} max={max} value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={() => {
          const n = parseInt(val, 10);
          if (!isNaN(n) && n > 0) onChange(n);
          setEditing(false);
          setVal(String(rank));
        }}
        onKeyDown={e => {
          if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { setEditing(false); setVal(String(rank)); }
        }}
        autoFocus
        className="w-11 text-center num text-[13px] py-0.5 rounded border border-[hsl(var(--accent))] shrink-0"
      />
    );
  }

  return (
    <button onClick={() => { setVal(String(rank)); setEditing(true); }}
      className="w-11 text-center num text-[13.5px] font-semibold py-0.5 rounded bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent)/0.25)] shrink-0"
      title="Click to set exact rank">
      #{rank}
    </button>
  );
}

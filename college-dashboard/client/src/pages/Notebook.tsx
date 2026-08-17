import { useMemo, useState } from "react";
import { schools, School } from "@/lib/data";
import { useNotes, statusLabel, statusTone, hasContent, NoteStatus, SchoolNote } from "@/lib/notes";
import { FitBadge, NoteButton, MyRatingChip } from "@/components/SchoolBits";
import { NotebookPen, Download, Upload, Trash2, Star, MapPin, Info } from "lucide-react";
import { useRef } from "react";

/**
 * Consolidated view of everything the applicant has written.
 * Grouped by status, with all pros/cons/notes/tags/visit questions visible at once.
 * Also supports Markdown export and a global "clear notebook" action.
 */
const groupOrder: (NoteStatus | "unrated")[] = ["shortlist", "considering", "backup", "ruled_out", "unrated"];
const groupLabel: Record<string, string> = { ...statusLabel, unrated: "No status yet" };
const groupTone: Record<string, string> = { ...statusTone, unrated: "chip-outline" };

export default function NotebookPage() {
  const { notes, clearAll, openDrawer, importNotes, storageAvailable } = useNotes();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sortBy, setSortBy] = useState<"rating"|"name"|"updated">("rating");
  const [filterVisited, setFilterVisited] = useState(false);

  const withNotes = useMemo(() => {
    const arr = Object.values(notes)
      .filter(hasContent)
      .filter(n => !filterVisited || n.visited)
      .map(n => ({ n, s: schools.find(x => x.slug === n.slug)! }))
      .filter(x => x.s);
    return arr;
  }, [notes, filterVisited]);

  const grouped = useMemo(() => {
    const g: Record<string, { n: SchoolNote; s: School }[]> = {};
    for (const item of withNotes) {
      const key = item.n.status || "unrated";
      (g[key] = g[key] || []).push(item);
    }
    for (const k of Object.keys(g)) {
      g[k].sort((a,b) => {
        if (sortBy === "name") return a.s.short.localeCompare(b.s.short);
        if (sortBy === "updated") return b.n.updated_at - a.n.updated_at;
        return (b.n.rating || 0) - (a.n.rating || 0) || a.s.short.localeCompare(b.s.short);
      });
    }
    return g;
  }, [withNotes, sortBy]);

  const total = withNotes.length;
  const visited = withNotes.filter(x => x.n.visited).length;
  const avgRating = (() => {
    const rated = withNotes.map(x => x.n.rating).filter(r => r > 0);
    return rated.length ? (rated.reduce((s,r)=>s+r,0) / rated.length).toFixed(1) : "—";
  })();

  // Export the entire notebook as portable JSON so it can be moved between devices.
  const exportJSON = () => {
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      notes: Object.values(notes),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `college-compass-notes-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import JSON exported from another device; merges (never destroys).
  const importFromFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rows: SchoolNote[] = Array.isArray(parsed?.notes) ? parsed.notes
        : Array.isArray(parsed) ? parsed : [];
      if (!rows.length) { alert("That file didn't contain any notes."); return; }
      if (!confirm(`Import ${rows.length} note${rows.length>1?"s":""} from this file? Existing notes with the same school will be overwritten.`)) return;
      await importNotes(rows);
    } catch (err: any) {
      alert("Could not read that file: " + (err?.message || "unknown error"));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const exportMarkdown = () => {
    const lines: string[] = [`# My College Notes`, `_Exported ${new Date().toLocaleString()}_`, ""];
    for (const g of groupOrder) {
      const items = grouped[g] || [];
      if (!items.length) continue;
      lines.push(`## ${groupLabel[g]}`, "");
      for (const { n, s } of items) {
        lines.push(`### ${s.short} — ${s.city_state}`);
        if (n.rating) lines.push(`Rating: ${"★".repeat(n.rating)}${"☆".repeat(5-n.rating)}`);
        if (n.visited) lines.push(`Visited: yes`);
        if (n.tags?.trim()) lines.push(`Tags: ${n.tags}`);
        if (n.notes?.trim()) lines.push("", n.notes.trim());
        if (n.pros?.trim()) {
          lines.push("", "**What I like:**");
          n.pros.split("\n").filter(Boolean).forEach(p => lines.push(`- ${p}`));
        }
        if (n.cons?.trim()) {
          lines.push("", "**What worries me:**");
          n.cons.split("\n").filter(Boolean).forEach(p => lines.push(`- ${p}`));
        }
        if (n.questions_for_visit?.trim()) {
          lines.push("", "**Questions for the visit:**");
          n.questions_for_visit.split("\n").filter(Boolean).forEach(p => lines.push(`- ${p}`));
        }
        lines.push("", "");
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `college-notes-${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-4 md:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent))]">
            <NotebookPen size={18}/>
          </div>
          <div>
            <div className="serif text-[18px] font-semibold">Your notebook</div>
            <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-2xl leading-relaxed">
              Everything you've written across the dashboard, grouped by the status you gave each school. Notes save automatically as you type — click any school card to add or edit its note.
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={importFromFile} className="hidden"/>
          <button onClick={()=>fileRef.current?.click()}
            className="chip inline-flex items-center gap-1 hover:bg-[hsl(var(--elevate-1))]">
            <Upload size={12}/> Import JSON
          </button>
          <button onClick={exportJSON}
            disabled={total === 0}
            className="chip chip-primary inline-flex items-center gap-1 disabled:opacity-40">
            <Download size={12}/> Export JSON (portable)
          </button>
          <button onClick={exportMarkdown}
            disabled={total === 0}
            className="chip inline-flex items-center gap-1 hover:bg-[hsl(var(--elevate-1))] disabled:opacity-40">
            <Download size={12}/> Export Markdown
          </button>
          <button onClick={async ()=>{ if (confirm("Delete every note in the notebook?")) await clearAll(); }}
            disabled={total === 0}
            className="chip inline-flex items-center gap-1 border-[hsl(var(--destructive)/0.5)] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.06)] disabled:opacity-40">
            <Trash2 size={12}/> Clear all
          </button>
        </div>
      </div>

      {!storageAvailable && (
        <div className="card p-3 border-l-4 border-l-[hsl(var(--fit-conditional))]">
          <div className="flex items-start gap-2 text-[12.5px]">
            <Info size={14} className="mt-0.5 shrink-0 text-[hsl(var(--fit-conditional))]"/>
            <div>Your browser blocked local storage in this preview, so notes will not persist. On the public GitHub Pages site or in any normal browser tab, notes save automatically.</div>
          </div>
        </div>
      )}

      <div className="card p-3 text-[12px] text-[hsl(var(--muted-foreground))] leading-relaxed">
        Notes save automatically to <strong>your browser on this device</strong>. To move them to another device (phone, school laptop), use <em>Export JSON</em> here and <em>Import JSON</em> on the other device.
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Schools with notes" value={String(total)} sub={`of ${schools.length}`}/>
        <Stat label="Visited" value={String(visited)} sub="marked as toured"/>
        <Stat label="Avg. rating" value={avgRating} sub="across rated schools"/>
        <Stat label="On my shortlist" value={String((grouped.shortlist || []).length)} sub="status = shortlist"/>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-[hsl(var(--muted-foreground))]">Sort in each group by</span>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)}
          className="text-[12px] py-1 px-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <option value="rating">My rating</option>
          <option value="name">Name</option>
          <option value="updated">Recently edited</option>
        </select>
        <label className="ml-3 inline-flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={filterVisited} onChange={e=>setFilterVisited(e.target.checked)}
            className="accent-[hsl(var(--accent))]"/>
          Only show visited campuses
        </label>
      </div>

      {/* Empty state */}
      {total === 0 && (
        <div className="card p-8 text-center">
          <div className="serif text-[16px] font-semibold mb-1">No notes yet</div>
          <div className="text-[12.5px] text-[hsl(var(--muted-foreground))] max-w-md mx-auto">
            Head to any tab, click the <span className="chip chip-outline"><NotebookPen size={10}/> Note</span> button on a school card, and jot down whatever you want to remember.
          </div>
        </div>
      )}

      {/* Grouped output */}
      {groupOrder.map(g => {
        const items = grouped[g] || [];
        if (!items.length) return null;
        return (
          <section key={g} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className={`chip ${groupTone[g]}`}>{groupLabel[g]}</span>
              <span className="text-[11.5px] text-[hsl(var(--muted-foreground))]">{items.length} school{items.length>1?"s":""}</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {items.map(({ n, s }) => (
                <div key={s.slug} className="card p-4 space-y-2 cursor-pointer card-hover" onClick={()=>openDrawer(s.slug)}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="serif text-[16px] font-semibold leading-tight">{s.short}</div>
                      <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{s.city_state}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {n.visited ? <span className="chip fit-strong inline-flex items-center gap-0.5"><MapPin size={10}/>Visited</span> : null}
                      <FitBadge fit={s.fit_classification} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Stars n={n.rating}/>
                    <MyRatingChip slug={s.slug}/>
                  </div>
                  {n.notes?.trim() && (
                    <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{n.notes}</div>
                  )}
                  {(n.pros?.trim() || n.cons?.trim()) && (
                    <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                      {n.pros?.trim() && (
                        <div>
                          <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--fit-top))] mb-0.5">Likes</div>
                          {n.pros.split("\n").filter(Boolean).map((p,i)=>(
                            <div key={i} className="leading-snug">• {p}</div>
                          ))}
                        </div>
                      )}
                      {n.cons?.trim() && (
                        <div>
                          <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--fit-lower))] mb-0.5">Worries</div>
                          {n.cons.split("\n").filter(Boolean).map((p,i)=>(
                            <div key={i} className="leading-snug">• {p}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {n.questions_for_visit?.trim() && (
                    <div className="text-[11.5px]">
                      <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-0.5">Visit questions</div>
                      {n.questions_for_visit.split("\n").filter(Boolean).map((p,i)=>(
                        <div key={i} className="leading-snug">? {p}</div>
                      ))}
                    </div>
                  )}
                  {n.tags?.trim() && (
                    <div className="flex flex-wrap gap-1">
                      {n.tags.split(",").map(t=>t.trim()).filter(Boolean).map(t => (
                        <span key={t} className="chip chip-outline text-[10.5px]">#{t}</span>
                      ))}
                    </div>
                  )}
                  <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] pt-1 flex items-center justify-between">
                    <span>Last edited {new Date(n.updated_at).toLocaleDateString()}</span>
                    <NoteButton slug={s.slug} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className="serif text-[26px] font-semibold num mt-1">{value}</div>
      {sub && <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{sub}</div>}
    </div>
  );
}
function Stars({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="inline-flex items-center gap-0.5" title={`${n}/5`}>
      {[1,2,3,4,5].map(i => (
        <Star key={i} size={12} fill={i<=n?"hsl(var(--accent))":"transparent"} stroke={i<=n?"hsl(var(--accent))":"hsl(var(--muted-foreground))"}/>
      ))}
    </span>
  );
}

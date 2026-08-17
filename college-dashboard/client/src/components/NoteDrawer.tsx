import { useEffect, useState } from "react";
import { schools } from "@/lib/data";
import { useNotes, statusLabel, statusTone, NoteStatus, hasContent } from "@/lib/notes";
import { FitBadge, AccessBadge } from "@/components/SchoolBits";
import { X, Star, MapPin, Trash2, Check } from "lucide-react";

/**
 * Slide-out notes drawer. Opens when notes.drawerSlug is set.
 * Auto-saves on blur (and every 800ms while typing).
 */
export function NoteDrawer() {
  const { drawerSlug, closeDrawer, getNote, upsert, remove } = useNotes();
  const s = drawerSlug ? schools.find(x => x.slug === drawerSlug) : null;
  const note = drawerSlug ? getNote(drawerSlug) : undefined;

  // Local draft state so typing feels snappy; sync when the drawer's school changes
  const [draft, setDraft] = useState({
    rating: 0, status: null as string | null,
    pros: "", cons: "", notes: "", tags: "", questions_for_visit: "", visited: 0,
  });
  const [saved, setSaved] = useState<null | "saving" | "saved">(null);

  useEffect(() => {
    if (!s) return;
    setDraft({
      rating: note?.rating ?? 0,
      status: note?.status ?? null,
      pros: note?.pros ?? "",
      cons: note?.cons ?? "",
      notes: note?.notes ?? "",
      tags: note?.tags ?? "",
      questions_for_visit: note?.questions_for_visit ?? "",
      visited: note?.visited ?? 0,
    });
    setSaved(null);
  }, [drawerSlug]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced autosave
  useEffect(() => {
    if (!s || !drawerSlug) return;
    setSaved("saving");
    const t = setTimeout(async () => {
      await upsert({ slug: drawerSlug, ...draft });
      setSaved("saved");
      const t2 = setTimeout(() => setSaved(null), 1400);
      return () => clearTimeout(t2);
    }, 500);
    return () => clearTimeout(t);
  }, [draft]);        // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    if (!drawerSlug) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") closeDrawer(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [drawerSlug, closeDrawer]);

  if (!s) return null;

  const setStatus = (v: NoteStatus | null) => setDraft(d => ({ ...d, status: v }));
  const rated = draft.rating || 0;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={closeDrawer} aria-hidden />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[440px] bg-[hsl(var(--card))] border-l border-[hsl(var(--border))] shadow-lg flex flex-col"
        role="dialog" aria-label={`Notes for ${s.short}`}>
        {/* Header */}
        <div className="p-4 border-b border-[hsl(var(--border))] flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Notes for</div>
            <div className="serif text-[19px] font-semibold leading-tight truncate">{s.short}</div>
            <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] truncate">{s.city_state}</div>
            <div className="flex flex-wrap gap-1 mt-2">
              <FitBadge fit={s.fit_classification} />
              <AccessBadge status={s.major_access_status} />
              {saved === "saving" && <span className="chip chip-outline text-[10.5px]">Saving…</span>}
              {saved === "saved" && <span className="chip fit-top text-[10.5px] inline-flex items-center gap-0.5"><Check size={10}/>Saved</span>}
            </div>
          </div>
          <button onClick={closeDrawer} className="p-1 rounded hover:bg-[hsl(var(--elevate-1))]" title="Close (Esc)"><X size={16}/></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Star rating */}
          <div>
            <Label>Your rating</Label>
            <div className="flex items-center gap-1 mt-1">
              {[1,2,3,4,5].map(n => (
                <button key={n}
                  onClick={() => setDraft(d => ({ ...d, rating: d.rating === n ? 0 : n }))}
                  className="p-0.5"
                  title={`${n} star${n>1?"s":""}${rated===n?" (click to clear)":""}`}>
                  <Star size={22}
                    fill={n <= rated ? "hsl(var(--accent))" : "transparent"}
                    stroke={n <= rated ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))"} />
                </button>
              ))}
              {rated > 0 && <button className="text-[11px] text-[hsl(var(--muted-foreground))] ml-2 hover:underline"
                onClick={()=>setDraft(d=>({...d, rating: 0}))}>clear</button>}
            </div>
          </div>

          {/* Status */}
          <div>
            <Label>Status</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {(Object.keys(statusLabel) as NoteStatus[]).map(k => {
                const on = draft.status === k;
                return (
                  <button key={k} onClick={() => setStatus(on ? null : k)}
                    className={`chip ${on ? statusTone[k] : "chip-outline"} hover:bg-[hsl(var(--elevate-1))]`}>
                    {statusLabel[k]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Visited toggle */}
          <div>
            <Label>Campus visit</Label>
            <label className="mt-1 flex items-center gap-2 text-[13px] cursor-pointer">
              <input type="checkbox" checked={!!draft.visited}
                onChange={e => setDraft(d => ({ ...d, visited: e.target.checked ? 1 : 0 }))}
                className="accent-[hsl(var(--accent))]"/>
              <MapPin size={13} className="text-[hsl(var(--muted-foreground))]"/>
              I have visited this campus
            </label>
          </div>

          {/* Free notes */}
          <div>
            <Label>My notes</Label>
            <textarea
              value={draft.notes}
              onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
              rows={5}
              placeholder="What I like, what I want to check, who I talked to, links to threads I found…"
              className="mt-1 w-full text-[13px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--accent))] leading-relaxed"/>
          </div>

          {/* Pros / cons side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[hsl(var(--fit-top))]">What I like</Label>
              <textarea value={draft.pros}
                onChange={e=>setDraft(d=>({...d, pros: e.target.value}))}
                rows={5} placeholder="One per line…"
                className="mt-1 w-full text-[12.5px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--fit-top)/0.05)] px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--fit-top))] leading-relaxed"/>
            </div>
            <div>
              <Label className="text-[hsl(var(--fit-lower))]">What worries me</Label>
              <textarea value={draft.cons}
                onChange={e=>setDraft(d=>({...d, cons: e.target.value}))}
                rows={5} placeholder="One per line…"
                className="mt-1 w-full text-[12.5px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--fit-lower)/0.05)] px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--fit-lower))] leading-relaxed"/>
            </div>
          </div>

          {/* Questions for the visit */}
          <div>
            <Label>Questions for the visit</Label>
            <textarea
              value={draft.questions_for_visit}
              onChange={e=>setDraft(d=>({...d, questions_for_visit: e.target.value}))}
              rows={4} placeholder="Things to ask a professor, a current student, or an admissions officer…"
              className="mt-1 w-full text-[12.5px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--accent))] leading-relaxed"/>
          </div>

          {/* Tags */}
          <div>
            <Label>Tags</Label>
            <input value={draft.tags}
              onChange={e=>setDraft(d=>({...d, tags: e.target.value}))}
              placeholder="e.g. cost concern, dad's alma mater, needs re-check"
              className="mt-1 w-full text-[12.5px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--accent))]"/>
            <div className="text-[10.5px] text-[hsl(var(--muted-foreground))] mt-1">Comma-separated. Used to group schools in the Notebook tab.</div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[hsl(var(--border))] p-3 flex items-center justify-between text-[11.5px]">
          <div className="text-[hsl(var(--muted-foreground))]">
            {note?.updated_at ? `Last saved: ${new Date(note.updated_at).toLocaleString()}` : "Not saved yet"}
          </div>
          {hasContent(note) && drawerSlug && (
            <button
              onClick={async () => { if (confirm(`Delete all notes for ${s.short}?`)) { await remove(drawerSlug); closeDrawer(); }}}
              className="inline-flex items-center gap-1 text-[hsl(var(--destructive))] hover:underline">
              <Trash2 size={12}/> Delete note
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

function Label({ children, className = "" }: { children: any; className?: string }) {
  return <div className={`text-[10.5px] uppercase tracking-wider font-medium text-[hsl(var(--muted-foreground))] ${className}`}>{children}</div>;
}

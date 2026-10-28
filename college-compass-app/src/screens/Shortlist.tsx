import { useState, type ReactNode } from "react";
import { navigate } from "@/lib/router";
import { fmt, useStore } from "@/state/store";
import { tierInfo } from "@/state/catalog";
import { Screen } from "@/components/Screen";
import { Button, Empty, OddsChip, TierPill } from "@/components/ui";
import { IconNote, NoteSheet, notePreview } from "@/components/NoteSheet";
import { IconArrowDown, IconArrowUp, IconChevronRight, IconShare, IconStar } from "@/components/icons";
import { AI_NOTICE_SHORT } from "@/legal/notice";

export function Shortlist({ tabBar }: { tabBar?: ReactNode }) {
  const { shortlist, byId, moveSaved, toggleSaved, notes, profile } = useStore();
  const items = shortlist.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
  const [copied, setCopied] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);

  const exportText = () => {
    const lines = [
      `My college shortlist${profile.name ? ` — ${profile.name}` : ""}`,
      "",
      ...items.map((r, i) => {
        const t = tierInfo(r.odds.tier);
        const note = notes[r.college.id];
        return `${i + 1}. ${r.college.name} (${r.college.city}, ${r.college.state}) — ${t.label}, odds ${fmt.band(r.odds.low, r.odds.high)}, fit ${Math.round(r.fit.total)}/100, est. ${r.est_net_price != null ? `${fmt.usd(r.est_net_price)}/yr` : "price unknown"}${note ? `\n   Notes: ${note}` : ""}`;
      }),
      "",
      `From Tierwise. ${AI_NOTICE_SHORT}`,
    ];
    return lines.join("\n");
  };

  const share = async () => {
    const text = exportText();
    try {
      if (navigator.share) {
        await navigator.share({ title: "My college shortlist", text });
        return;
      }
    } catch {
      /* user cancelled */
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy your shortlist", text);
    }
  };

  return (
    <Screen
      title="Shortlist"
      subtitle={items.length ? `${items.length} saved · tap the arrows to reorder` : undefined}
      right={
        items.length > 0 ? (
          <button type="button" className="grid h-11 w-11 place-items-center text-accent" aria-label="Share shortlist" onClick={share}>
            <IconShare size={22} />
          </button>
        ) : null
      }
      footer={tabBar}
    >
      {copied && (
        <p role="status" className="mb-3 rounded-control bg-accent-soft px-4 py-2 text-center text-subhead text-accent">
          Copied to clipboard
        </p>
      )}
      {items.length === 0 ? (
        <Empty icon="⭐" title="No colleges saved yet" message="Tap the star on any college to keep it here, add notes and share the list with family." action={<Button variant="secondary" onClick={() => navigate("/list", { replace: true })}>Go to your list</Button>} />
      ) : (
        <ol className="space-y-3">
          {items.map((r, i) => {
            const c = r.college;
            const t = tierInfo(r.odds.tier);
            return (
              <li key={c.id} className="cc-card" style={{ ["--rail" as string]: t.cssVar }}>
                <span className="cc-card-rail" aria-hidden />
                <div className="flex items-stretch">
                  <button type="button" className="cc-press min-w-0 flex-1 py-3 pl-4 pr-2 text-left" onClick={() => navigate(`/college/${encodeURIComponent(c.id)}`)}>
                    <div className="flex items-center gap-2">
                      <span className="tnum w-5 text-footnote text-text-muted">{i + 1}</span>
                      <h3 className="min-w-0 flex-1 text-headline line-clamp-2">{c.name}</h3>
                      <IconChevronRight size={16} className="text-text-muted" />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7">
                      <TierPill tier={r.odds.tier} />
                      <OddsChip low={r.odds.low} high={r.odds.high} tier={r.odds.tier} />
                      <span className="tnum text-subhead text-text-muted">{r.est_net_price != null ? `${fmt.usd(r.est_net_price, { k: true })}/yr` : ""}</span>
                    </div>
                  </button>
                  <div className="flex flex-col items-center justify-center border-l border-border px-1">
                    <button type="button" className="grid h-10 w-10 place-items-center text-accent disabled:opacity-30" aria-label={`Move ${c.short} up`} disabled={i === 0} onClick={() => moveSaved(c.id, -1)}>
                      <IconArrowUp size={18} />
                    </button>
                    <button type="button" className="grid h-10 w-10 place-items-center text-accent disabled:opacity-30" aria-label={`Move ${c.short} down`} disabled={i === items.length - 1} onClick={() => moveSaved(c.id, 1)}>
                      <IconArrowDown size={18} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 border-t border-border py-0.5 pl-4 pr-2">
                  <button type="button" className="flex min-h-tap min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setNoteFor(c.id)} aria-label={notes[c.id] ? `Notes for ${c.short}: ${notePreview(notes[c.id])}` : `Add a note for ${c.short}`}>
                    <IconNote size={16} className="shrink-0 text-text-muted" />
                    <span className={`block min-w-0 flex-1 truncate text-footnote ${notes[c.id] ? "text-text" : "text-text-muted"}`}>{notes[c.id] ? notePreview(notes[c.id]) : "Add a note"}</span>
                  </button>
                  <button type="button" className="flex min-h-tap shrink-0 items-center gap-1.5 px-2 text-footnote text-text-muted" onClick={() => toggleSaved(c.id)}>
                    <IconStar size={16} filled className="text-warn" /> Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {items.length > 0 && (
        <div className="mt-6">
          <Button variant="secondary" onClick={share}>
            <IconShare size={20} /> Share as text
          </Button>
        </div>
      )}
      <NoteSheet collegeId={noteFor} open={!!noteFor} onClose={() => setNoteFor(null)} />
    </Screen>
  );
}

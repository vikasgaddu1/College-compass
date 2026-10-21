/** "Your lists": switch, create, rename and delete college lists. Shared by the List tab and Settings. */
import { useEffect, useMemo, useState } from "react";
import { navigate } from "@/lib/router";
import { useStore, type ListMeta } from "@/state/store";
import { listCollegeCount, listHasProfile, nextListName } from "@/state/lists";
import { ConfirmSheet, Sheet } from "./Sheet";
import { Button, OptionRow } from "./ui";
import { IconCheck, IconMore, IconPlus } from "./icons";

function researchedOn(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

/** "12 colleges · researched Oct 20" / "Not researched yet" / "Questions not finished" / "Not started yet". */
export function describeList(list: ListMeta, collegeCount: number, hasAnswers: boolean): string {
  if (!list.onboardingDone && !list.demo) return hasAnswers ? "Questions not finished" : "Not started yet";
  if (!list.researchedAt && collegeCount === 0) return "Not researched yet";
  const n = `${collegeCount} ${collegeCount === 1 ? "college" : "colleges"}`;
  return list.researchedAt ? `${n} · researched ${researchedOn(list.researchedAt)}` : n;
}

export function ListsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lists, activeListId, colleges, hasProfile, switchList, deleteList } = useStore();
  const [menuFor, setMenuFor] = useState<ListMeta | null>(null);
  const [renameFor, setRenameFor] = useState<ListMeta | null>(null);
  const [deleteFor, setDeleteFor] = useState<ListMeta | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const summary = (l: ListMeta) => (l.id === activeListId ? describeList(l, colleges.length, hasProfile) : describeList(l, listCollegeCount(l.id), listHasProfile(l.id)));

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Your lists"
        footer={
          <Button
            onClick={() => {
              onClose();
              setNewOpen(true);
            }}
          >
            <IconPlus size={20} />
            New list
          </Button>
        }
      >
        <p className="mb-3 text-subhead text-text-muted">Each list has its own answers, colleges and notes — try a different major or region in a new one.</p>
        <div className="cc-group" role="radiogroup" aria-label="Lists">
          {lists.map((l) => {
            const active = l.id === activeListId;
            return (
              <div key={l.id} className="cc-row-static !py-0 !pr-1">
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className="-ml-4 flex min-h-[56px] min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left cc-row-press"
                  onClick={() => {
                    if (!active) switchList(l.id);
                    onClose();
                  }}
                >
                  <span className="grid w-6 shrink-0 place-items-center text-accent" aria-hidden>
                    {active && <IconCheck size={20} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-body ${active ? "font-semibold" : ""}`}>{l.name}</span>
                    <span className="block text-footnote text-text-muted">{summary(l)}</span>
                  </span>
                </button>
                <button type="button" className="grid h-11 w-11 shrink-0 place-items-center text-text-muted" aria-label={`Options for ${l.name}`} aria-haspopup="dialog" onClick={() => setMenuFor(l)}>
                  <IconMore size={22} />
                </button>
              </div>
            );
          })}
        </div>
      </Sheet>

      {/* Per-list actions */}
      <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.name ?? ""}>
        <div className="cc-group">
          <button
            type="button"
            className="cc-row cc-row-press"
            onClick={() => {
              setRenameFor(menuFor);
              setMenuFor(null);
            }}
          >
            <span className="flex-1 text-body">Rename</span>
          </button>
          <button
            type="button"
            className="cc-row cc-row-press"
            onClick={() => {
              setDeleteFor(menuFor);
              setMenuFor(null);
            }}
          >
            <span className="flex-1 text-body text-bad">Delete</span>
          </button>
        </div>
      </Sheet>

      <RenameListSheet list={renameFor} onClose={() => setRenameFor(null)} />
      <DeleteListSheet
        list={deleteFor}
        onClose={() => setDeleteFor(null)}
        onDeleted={() => {
          deleteList(deleteFor!.id);
          if (deleteFor!.id === activeListId) onClose();
        }}
      />
      <NewListSheet open={newOpen} onClose={() => setNewOpen(false)} />
    </>
  );
}

export function RenameListSheet({ list, onClose }: { list: ListMeta | null; onClose: () => void }) {
  const { renameList } = useStore();
  const [name, setName] = useState("");
  useEffect(() => {
    if (list) setName(list.name);
  }, [list]);
  const save = () => {
    if (list && name.trim()) renameList(list.id, name);
    onClose();
  };
  return (
    <Sheet
      open={!!list}
      onClose={onClose}
      title="Rename list"
      right={
        <button type="button" className="cc-link min-h-tap px-1 text-body" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <input className="cc-input" value={name} autoFocus autoCapitalize="words" enterKeyHint="done" maxLength={40} aria-label="List name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      <div className="pt-4">
        <Button onClick={save} disabled={!name.trim()}>
          Save
        </Button>
      </div>
    </Sheet>
  );
}

export function DeleteListSheet({ list, onClose, onDeleted }: { list: ListMeta | null; onClose: () => void; onDeleted: () => void }) {
  const { lists } = useStore();
  const last = lists.length <= 1;
  return (
    <ConfirmSheet
      open={!!list}
      onClose={onClose}
      title={`Delete ${list?.name ?? "this list"}?`}
      message={last ? "Its answers, colleges and notes are removed from this phone. You'll start over with an empty list." : "Its answers, colleges and notes are removed from this phone. This can't be undone."}
      confirmLabel="Delete list"
      destructive
      onConfirm={onDeleted}
    />
  );
}

/** Name + "start fresh" or "start with the current answers", then straight into the questions. */
export function NewListSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lists, activeList, activeListId, hasProfile, createList } = useStore();
  const suggested = useMemo(() => nextListName(lists), [lists]);
  const [name, setName] = useState(suggested);
  const [mode, setMode] = useState<"copy" | "fresh">("fresh");
  useEffect(() => {
    if (!open) return;
    setName(suggested);
    setMode(hasProfile ? "copy" : "fresh");
    // Reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const create = () => {
    const typed = name.trim();
    createList({ name: typed && typed !== suggested ? typed : undefined, copyAnswersFrom: mode === "copy" && hasProfile ? activeListId : undefined });
    onClose();
    navigate("/onboarding/1");
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New list"
      right={
        <button type="button" className="cc-link min-h-tap px-1 text-body" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <label className="block">
        <span className="mb-1.5 block text-subhead font-medium">Name</span>
        <input className="cc-input" value={name} autoCapitalize="words" enterKeyHint="done" maxLength={40} placeholder={suggested} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        <span className="mt-1.5 block text-footnote text-text-muted">Optional — leave it and the list is named from your answers, like “Robotics · New England”.</span>
      </label>
      <div className="mt-5 space-y-2" role="radiogroup" aria-label="How to start">
        {hasProfile && (
          <OptionRow checked={mode === "copy"} label={`Start with answers from ${activeList.name}`} hint="Same student, different major or region — your answers are filled in so you only change what's different." onClick={() => setMode("copy")} />
        )}
        <OptionRow checked={mode === "fresh"} label="Start fresh" hint="Answer the questions from the beginning." onClick={() => setMode("fresh")} />
      </div>
      <div className="pt-5">
        <Button onClick={create}>Create list</Button>
      </div>
    </Sheet>
  );
}

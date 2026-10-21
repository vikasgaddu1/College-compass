/**
 * "Share this list": bottom sheet that builds a PDF of the list (src/share/report.ts) and hands it
 * to the iOS share sheet (Mail, Messages, WhatsApp, AirDrop, Save to Files…) through the platform
 * seam. Self-contained on purpose: everything it needs comes in as props, nothing from the store.
 *
 * Wire-in: `<ShareListSheet open={…} onClose={…} listName={…} profile={profile} balanced={balanced}
 * others={others} shortlist={shortlist} notes={notes} />` next to a "Share" button on the list screen.
 */
import { useCallback, useEffect, useState } from "react";
import type { BalancedList, RankedCollege, StudentProfile } from "@/types";
import { load, save } from "@/lib/storage";
import { sharePdf } from "@/platform";
import { DEFAULT_REPORT_OPTIONS, buildReportHtml, reportFileName, type ReportOptions } from "@/share/report";
import { Sheet } from "./Sheet";
import { Banner, Button, Group, Switch } from "./ui";

export const SHARE_OPTIONS_KEY = "share_options";

export interface ShareListSheetProps {
  open: boolean;
  onClose: () => void;
  /** Name of the list being shared, e.g. "Robotics Northeast". */
  listName: string;
  profile: StudentProfile;
  balanced: BalancedList;
  /** Researched colleges that didn't make the balanced picks. */
  others: RankedCollege[];
  shortlist: string[];
  notes: Record<string, string>;
}

const TOGGLES: { id: keyof ReportOptions; label: string; hint?: string }[] = [
  { id: "grades", label: "Grades and test scores" },
  { id: "budget", label: "Family budget and income", hint: "Off keeps your family's finances private" },
  { id: "notes", label: "My notes" },
  { id: "others", label: "Other colleges researched" },
];

/** Last-used toggles from localStorage, with anything odd replaced by the defaults. */
export function loadShareOptions(): ReportOptions {
  const raw = load<Partial<ReportOptions> | null>(SHARE_OPTIONS_KEY, null);
  const out: ReportOptions = { ...DEFAULT_REPORT_OPTIONS };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(DEFAULT_REPORT_OPTIONS) as (keyof ReportOptions)[]) {
      if (typeof raw[k] === "boolean") out[k] = raw[k] as boolean;
    }
  }
  return out;
}

export function ShareListSheet({ open, onClose, listName, profile, balanced, others, shortlist, notes }: ShareListSheetProps) {
  const [options, setOptions] = useState<ReportOptions>(loadShareOptions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-read the remembered toggles each time the sheet opens (another screen may have changed them).
  useEffect(() => {
    if (open) {
      setOptions(loadShareOptions());
      setError(null);
    }
  }, [open]);

  const toggle = useCallback((id: keyof ReportOptions, value: boolean) => {
    setOptions((prev) => {
      const next = { ...prev, [id]: value };
      save(SHARE_OPTIONS_KEY, next);
      return next;
    });
  }, []);

  const count = (["high_reach", "reach", "target", "likely", "safety"] as const).reduce((n, t) => n + (balanced[t]?.length ?? 0), 0);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const html = buildReportHtml({ listName, profile, balanced, others, shortlist, notes, generatedAt: now }, options);
      const res = await sharePdf(html, reportFileName(listName, now));
      if (res.completed) onClose();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't create the PDF. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => !busy && onClose()}
      title="Share this list"
      right={
        <button type="button" className="cc-link min-h-tap px-1 text-body" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      }
    >
      <p className="text-subhead text-text-muted">Creates a PDF you can send by email, Messages, WhatsApp or AirDrop.</p>
      <Group label="Include" foot="Nothing is uploaded — the PDF goes only where you send it. Chances are estimates, never promises.">
        {TOGGLES.map((t) => (
          <div key={t.id} className="cc-row-static">
            <div className="min-w-0 flex-1">
              <div className="text-body">{t.label}</div>
              {t.hint && <div className="mt-0.5 text-footnote text-text-muted">{t.hint}</div>}
            </div>
            <Switch checked={options[t.id]} onChange={(v) => toggle(t.id, v)} label={t.label} />
          </div>
        ))}
      </Group>
      {error && (
        <div className="mt-4">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <div className="pt-5">
        <Button onClick={create} disabled={busy || count === 0} aria-busy={busy}>
          {busy ? "Creating PDF…" : "Create PDF"}
        </Button>
        {count === 0 && <p className="mt-2 text-center text-footnote text-text-muted">Add colleges to the list first.</p>}
      </div>
    </Sheet>
  );
}

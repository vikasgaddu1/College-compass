/** "You vs them": the college's 25th–75th percentile range with the student's marker. */
export function RangeBar({ label, lo, hi, you, min, max, unit }: { label: string; lo: number | null; hi: number | null; you: number | null; min: number; max: number; unit?: string }) {
  if (lo == null || hi == null) {
    return (
      <div className="py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-subhead font-medium">{label}</span>
          <span className="text-footnote text-text-muted">Not reported</span>
        </div>
      </div>
    );
  }
  const pct = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))}%`;
  let verdict = "";
  if (you != null) verdict = you > hi ? "above their middle 50%" : you < lo ? "below their middle 50%" : "inside their middle 50%";
  return (
    <div className="py-2" aria-label={`${label}: their middle 50% is ${lo} to ${hi}${you != null ? `; you have ${you}, ${verdict}` : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-subhead font-medium">{label}</span>
        <span className="tnum text-footnote text-text-muted">
          {you != null ? (
            <>
              You <span className="font-semibold text-text">{you}</span> · {verdict}
            </>
          ) : (
            <>Middle 50%: {lo}–{hi}{unit ?? ""}</>
          )}
        </span>
      </div>
      <div className="cc-range" aria-hidden>
        <div className="cc-range-track" />
        <div className="cc-range-mid" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
        <span className="cc-range-label" style={{ left: pct(lo) }}>{lo}</span>
        <span className="cc-range-label" style={{ left: pct(hi) }}>{hi}</span>
        {you != null && (
          <span className="cc-range-you" style={{ left: pct(you) }}>
            you
          </span>
        )}
      </div>
    </div>
  );
}

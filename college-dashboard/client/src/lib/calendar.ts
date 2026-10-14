// Dates are civil days in the applicant's timezone, not server-local instants.
export function todayIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function dateUTC(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function daysUntil(iso: string, today = todayIso()): number {
  return Math.round((dateUTC(iso).getTime() - dateUTC(today).getTime()) / 86400000);
}

// Historical month/day labels belong to the fixed Fall 2027 application cycle.
// Preserve every date in labels such as WPI's two EA rounds; never roll to next year.
export function parseCycleDates(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const dates = Array.from(raw.matchAll(/\b(202[67]-\d{2}-\d{2})\b/g)).map(m => m[1]);
  for (const m of Array.from(raw.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(202[67]))?\b/g))) {
    const month = months.indexOf(m[1].toLowerCase().slice(0, 3));
    if (month < 0) continue;
    const year = m[3] || (month >= 7 ? "2026" : "2027");
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    const d = dateUTC(iso);
    if (Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso) dates.push(iso);
  }
  return Array.from(new Set(dates)).sort();
}

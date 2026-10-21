import { useMemo, useState, type ReactNode } from "react";
import type { MajorArea, Region, StudentProfile } from "@/types";
import { navigate, useRoute } from "@/lib/router";
import { useStore } from "@/state/store";
import { ACTIVITIES, INCOME_BANDS, MAJORS, OWNERSHIPS, PLANS, PRIORITIES, REGIONS, RIGOR, SETTINGS, SIZES, STATES, SUGGESTED_INTERESTS, majorIcon, majorLabel, stateName } from "@/state/catalog";
import { Screen, StickyActions } from "@/components/Screen";
import { Button, Chip, OptionRow, ProgressBar } from "@/components/ui";
import { IconChevronLeft, IconClose, IconSearch } from "@/components/icons";
import { ConfirmSheet, Sheet } from "@/components/Sheet";

type Update = (patch: Partial<StudentProfile>) => void;

interface Step {
  id: string;
  title: string;
  subtitle?: string;
  optional?: boolean;
  valid: (p: StudentProfile) => boolean;
  render: (p: StudentProfile, u: Update) => ReactNode;
}

const num = (s: string): number | null => {
  const v = s.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function NumberField({ label, value, onChange, placeholder, hint, mode = "decimal", max, min, step }: { label: string; value: number | null; onChange: (n: number | null) => void; placeholder?: string; hint?: string; mode?: "decimal" | "numeric"; max?: number; min?: number; step?: number }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  return (
    <label className="block">
      <span className="mb-1.5 block text-subhead font-medium">{label}</span>
      <input
        className="cc-input cc-input-lg"
        inputMode={mode}
        type="text"
        pattern={mode === "numeric" ? "[0-9]*" : undefined}
        placeholder={placeholder}
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9.]/g, "");
          setText(t);
          const n = num(t);
          onChange(n == null ? null : max != null && n > max ? max : n);
        }}
        aria-describedby={hint ? `${label}-hint` : undefined}
      />
      {hint && (
        <span id={`${label}-hint`} className="mt-1.5 block text-footnote text-text-muted">
          {hint}
        </span>
      )}
    </label>
  );
}

export function StatePicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return STATES;
    // Names starting with the text first ("n" → Nebraska, Nevada, New …), then names containing it
    // ("no" → North Carolina, North Dakota, then Illinois); a 2-letter code ("nc") also matches.
    const rank = (st: { code: string; name: string }) => {
      const n = st.name.toLowerCase();
      if (st.code.toLowerCase() === s) return 0;
      if (n.startsWith(s)) return 1;
      if (n.split(/\s+/).some((w) => w.startsWith(s))) return 2;
      if (n.includes(s)) return 3;
      return 9;
    };
    return STATES.map((st) => ({ st, r: rank(st) }))
      .filter((x) => x.r < 9)
      .sort((a, b) => a.r - b.r || a.st.name.localeCompare(b.st.name))
      .map((x) => x.st);
  }, [q]);
  return (
    <>
      <button type="button" className="cc-input cc-press flex items-center justify-between text-left" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className={value ? "" : "text-text-muted"}>{value ? stateName(value) : "Choose a state"}</span>
        <IconSearch size={20} className="text-text-muted" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Home state">
        <div className="cc-search mb-3">
          <IconSearch size={18} className="text-text-muted" />
          <input autoFocus placeholder="Search states" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search states" />
        </div>
        <div className="cc-group">
          {list.map((st) => (
            <button
              key={st.code}
              type="button"
              className="cc-row cc-row-press"
              aria-pressed={st.code === value}
              onClick={() => {
                onChange(st.code);
                setOpen(false);
              }}
            >
              <span className="flex-1 text-body">{st.name}</span>
              <span className="text-subhead text-text-muted">{st.code}</span>
            </button>
          ))}
          {list.length === 0 && <p className="px-4 py-6 text-center text-subhead text-text-muted">No state matches "{q}".</p>}
        </div>
      </Sheet>
    </>
  );
}

function MajorPicker({ value, onChange }: { value: MajorArea[]; onChange: (m: MajorArea[]) => void }) {
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();
  const filtered = MAJORS.filter((m) => !s || m.label.toLowerCase().includes(s) || m.keywords.includes(s));
  const groups = Array.from(new Set(filtered.map((m) => m.group)));
  const toggle = (id: MajorArea) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else if (id === "undecided") onChange(["undecided"]);
    else if (value.length < 3) onChange([...value.filter((x) => x !== "undecided"), id]);
  };
  return (
    <div>
      {value.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2" aria-label="Selected">
          {value.map((id, i) => (
            <Chip key={id} selected onClick={() => toggle(id)} aria-label={`Remove ${majorLabel(id)}`}>
              <span aria-hidden>{majorIcon(id)}</span>
              {majorLabel(id)}
              {i === 0 && value.length > 1 && <span className="opacity-70">· primary</span>}
              <IconClose size={14} />
            </Chip>
          ))}
        </div>
      )}
      <div className="cc-search mb-3">
        <IconSearch size={18} className="text-text-muted" />
        <input placeholder="Search fields, e.g. nursing, game design" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search fields of study" />
      </div>
      {groups.map((g) => (
        <div key={g} className="mb-4">
          <h3 className="mb-2 text-footnote text-text-muted">{g}</h3>
          <div className="flex flex-wrap gap-2">
            {filtered
              .filter((m) => m.group === g)
              .map((m) => (
                <Chip key={m.id} selected={value.includes(m.id)} onClick={() => toggle(m.id)} disabled={!value.includes(m.id) && value.length >= 3 && m.id !== "undecided"}>
                  <span aria-hidden>{m.icon}</span>
                  {m.label}
                </Chip>
              ))}
          </div>
        </div>
      ))}
      {filtered.length === 0 && <p className="py-6 text-center text-subhead text-text-muted">Nothing matches "{q}". Add it as a free-text interest below.</p>}
    </div>
  );
}

function TextChips({ value, onChange, placeholder, suggestions, label }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; suggestions?: string[]; label: string }) {
  const [text, setText] = useState("");
  const add = (s: string) => {
    const t = s.trim().replace(/,+$/, "");
    if (!t || value.some((v) => v.toLowerCase() === t.toLowerCase())) return;
    onChange([...value, t]);
    setText("");
  };
  return (
    <div>
      <div className="flex gap-2">
        <input
          className="cc-input"
          placeholder={placeholder}
          value={text}
          aria-label={label}
          autoCapitalize="words"
          enterKeyHint="done"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(text);
            }
          }}
          onBlur={() => text.trim() && add(text)}
        />
        <Button variant="secondary" className="!w-auto shrink-0 px-4" onClick={() => add(text)} disabled={!text.trim()} aria-label="Add">
          Add
        </Button>
      </div>
      {value.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {value.map((v) => (
            <Chip key={v} selected onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
              {v}
              <IconClose size={14} />
            </Chip>
          ))}
        </div>
      )}
      {suggestions && suggestions.filter((s) => !value.includes(s)).length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-footnote text-text-muted">Ideas</h3>
          <div className="flex flex-wrap gap-2">
            {suggestions
              .filter((s) => !value.includes(s))
              .map((s) => (
                <Chip key={s} onClick={() => add(s)}>
                  {s}
                </Chip>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const words = ["Not important", "A little", "Somewhat", "Important", "Very important", "Essential"];
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between">
        <span className="text-body font-medium">{label}</span>
        <span className="text-footnote text-text-muted">{words[value]}</span>
      </div>
      <input type="range" min={0} max={5} step={1} value={value} className="cc-slider" style={{ ["--pct" as string]: `${(value / 5) * 100}%` }} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} aria-valuetext={words[value]} />
    </div>
  );
}

const yearNow = new Date().getFullYear();

const STEPS: Step[] = [
  {
    id: "home",
    title: "Where's home?",
    subtitle: "In-state tuition and admit rates depend on it.",
    valid: (p) => !!p.home_state,
    render: (p, u) => (
      <div className="space-y-5">
        <StatePicker value={p.home_state} onChange={(home_state) => u({ home_state })} />
        <label className="block">
          <span className="mb-1.5 block text-subhead font-medium">Your first name (optional)</span>
          <input className="cc-input" value={p.name ?? ""} autoComplete="given-name" autoCapitalize="words" placeholder="Only shown on this phone" onChange={(e) => u({ name: e.target.value || undefined })} />
        </label>
      </div>
    ),
  },
  {
    id: "year",
    title: "When do you graduate high school?",
    valid: (p) => p.grad_year >= yearNow && p.grad_year <= yearNow + 6,
    render: (p, u) => (
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((d) => {
          const y = yearNow + d;
          return <OptionRow key={y} checked={p.grad_year === y} label={`Class of ${y}`} hint={d === 0 ? "Senior now" : d === 1 ? "Junior now" : d === 2 ? "Sophomore now" : d === 3 ? "Freshman now" : "Middle school"} onClick={() => u({ grad_year: y })} />;
        })}
      </div>
    ),
  },
  {
    id: "gpa",
    title: "What's your GPA?",
    subtitle: "Unweighted on a 4.0 scale. Weighted is optional.",
    valid: (p) => p.gpa_unweighted != null && p.gpa_unweighted > 0 && p.gpa_unweighted <= 4.0,
    render: (p, u) => (
      <div className="space-y-5">
        <NumberField key={"uw"} label="Unweighted GPA" value={p.gpa_unweighted} max={4} placeholder="3.75" hint="Out of 4.0" onChange={(gpa_unweighted) => u({ gpa_unweighted })} />
        <NumberField key={"w"} label="Weighted GPA (optional)" value={p.gpa_weighted} max={6} placeholder="4.2" hint="As your school reports it" onChange={(gpa_weighted) => u({ gpa_weighted })} />
        <NumberField key={"rank"} label="Class rank, top % (optional)" value={p.class_rank_pct} mode="numeric" max={100} placeholder="10" hint="Enter 10 for top 10%" onChange={(class_rank_pct) => u({ class_rank_pct })} />
      </div>
    ),
  },
  {
    id: "tests",
    title: "Test scores?",
    subtitle: "Enter what you have. Many colleges are test optional.",
    optional: true,
    valid: () => true,
    render: (p, u) => (
      <div className="space-y-5">
        <NumberField key={"sat"} label="SAT total" value={p.sat} mode="numeric" min={400} max={1600} placeholder="1350" hint="400–1600" onChange={(sat) => u({ sat })} />
        <NumberField key={"act"} label="ACT composite" value={p.act} mode="numeric" min={1} max={36} placeholder="29" hint="1–36" onChange={(act) => u({ act })} />
        <NumberField key={"ap"} label="AP or IB classes taken (optional)" value={p.ap_ib_count} mode="numeric" max={30} placeholder="6" onChange={(ap_ib_count) => u({ ap_ib_count })} />
      </div>
    ),
  },
  {
    id: "rigor",
    title: "How demanding is your course load?",
    subtitle: "Compared with what your school offers.",
    valid: () => true,
    render: (p, u) => (
      <div className="space-y-2">
        {RIGOR.map((r) => (
          <OptionRow key={r.id} checked={p.rigor === r.id} label={r.label} hint={r.hint} onClick={() => u({ rigor: r.id })} />
        ))}
      </div>
    ),
  },
  {
    id: "activities",
    title: "Outside of class, what best describes you?",
    valid: () => true,
    render: (p, u) => (
      <div className="space-y-2">
        {ACTIVITIES.map((a) => (
          <OptionRow key={a.id} checked={p.activities_strength === a.id} label={a.label} hint={a.hint} onClick={() => u({ activities_strength: a.id })} />
        ))}
      </div>
    ),
  },
  {
    id: "majors",
    title: "What do you want to study?",
    subtitle: "Pick up to three. The first is your main one.",
    valid: (p) => p.majors.length >= 1,
    render: (p, u) => <MajorPicker value={p.majors} onChange={(majors) => u({ majors })} />,
  },
  {
    id: "interests",
    title: "Anything more specific?",
    subtitle: "In your own words. This helps find named programs.",
    optional: true,
    valid: () => true,
    render: (p, u) => (
      <TextChips
        label="Interests"
        placeholder="e.g. marine biology, game design"
        suggestions={SUGGESTED_INTERESTS}
        value={p.interests_text ? p.interests_text.split(",").map((s) => s.trim()).filter(Boolean) : []}
        onChange={(v) => u({ interests_text: v.join(", ") })}
      />
    ),
  },
  {
    id: "budget",
    title: "What can your family pay per year?",
    subtitle: "After scholarships and grants. A rough number is fine.",
    valid: () => true,
    render: (p, u) => (
      <div className="space-y-6">
        <NumberField key={"budget"} label="Budget per year" value={p.budget_per_year} mode="numeric" max={120000} placeholder="25000" hint="In dollars. Leave blank if you're not sure." onChange={(budget_per_year) => u({ budget_per_year })} />
        <div>
          <span className="mb-2 block text-subhead font-medium">Household income</span>
          <p className="mb-2 text-footnote text-text-muted">Used only to estimate your net price. Stays on this phone.</p>
          <div className="space-y-2">
            {INCOME_BANDS.map((b) => (
              <OptionRow key={b.id} checked={p.income_band === b.id} label={b.label} onClick={() => u({ income_band: b.id })} />
            ))}
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "regions",
    title: "Where would you like to be?",
    subtitle: "Pick any regions, or none for anywhere.",
    optional: true,
    valid: () => true,
    render: (p, u) => {
      const toggle = (r: Region) => u({ regions: p.regions.includes(r) ? p.regions.filter((x) => x !== r) : [...p.regions, r] });
      return (
        <div className="space-y-2">
          {REGIONS.map((r) => (
            <OptionRow key={r.id} multi checked={p.regions.includes(r.id)} label={r.label} hint={r.hint} onClick={() => toggle(r.id)} />
          ))}
        </div>
      );
    },
  },
  {
    id: "size",
    title: "How big a school?",
    valid: () => true,
    render: (p, u) => (
      <div className="space-y-2">
        {SIZES.map((s) => (
          <OptionRow key={s.id} checked={p.size === s.id} label={s.label} hint={s.hint || undefined} onClick={() => u({ size: s.id })} />
        ))}
      </div>
    ),
  },
  {
    id: "setting",
    title: "What kind of place?",
    valid: () => true,
    render: (p, u) => (
      <div className="space-y-2">
        {SETTINGS.map((s) => (
          <OptionRow key={s.id} checked={p.setting === s.id} label={s.label} hint={s.hint || undefined} onClick={() => u({ setting: s.id })} />
        ))}
      </div>
    ),
  },
  {
    id: "ownership",
    title: "Public or private?",
    valid: () => true,
    render: (p, u) => (
      <div className="space-y-2">
        {OWNERSHIPS.map((s) => (
          <OptionRow key={s.id} checked={p.ownership === s.id} label={s.label} hint={s.hint || undefined} onClick={() => u({ ownership: s.id })} />
        ))}
      </div>
    ),
  },
  {
    id: "plan",
    title: "How early would you apply?",
    subtitle: "Early Decision can raise odds at some colleges, but it's binding.",
    valid: () => true,
    render: (p, u) => (
      <div className="space-y-2">
        {PLANS.map((s) => (
          <OptionRow key={s.id} checked={p.plan === s.id} label={s.label} hint={s.hint} onClick={() => u({ plan: s.id })} />
        ))}
      </div>
    ),
  },
  {
    id: "firstgen",
    title: "Would you be the first in your family to finish college?",
    subtitle: "Neither parent has a bachelor's degree.",
    valid: () => true,
    render: (p, u) => (
      <div className="space-y-2">
        <OptionRow checked={p.first_gen} label="Yes, first generation" onClick={() => u({ first_gen: true })} />
        <OptionRow checked={!p.first_gen} label="No" onClick={() => u({ first_gen: false })} />
      </div>
    ),
  },
  {
    id: "priorities",
    title: "What matters most?",
    subtitle: "This weights your fit score.",
    valid: () => true,
    render: (p, u) => (
      <div className="space-y-1">
        {PRIORITIES.map((pr) => (
          <Slider key={pr.id} label={pr.label} value={p.priorities[pr.id]} onChange={(v) => u({ priorities: { ...p.priorities, [pr.id]: v } })} />
        ))}
      </div>
    ),
  },
  {
    id: "wanted",
    title: "Colleges you already like?",
    subtitle: "We'll research these first and fill in the rest.",
    optional: true,
    valid: () => true,
    render: (p, u) => <TextChips label="College name" placeholder="e.g. Purdue University" value={p.wanted_colleges} onChange={(wanted_colleges) => u({ wanted_colleges })} />,
  },
];

export const ONBOARDING_STEPS = STEPS.length;

export function Onboarding() {
  const route = useRoute();
  const { profile, updateProfile, finishOnboarding, hasProfile, onboardingDone, lists, activeList, deleteList } = useStore();
  const idx = Math.min(STEPS.length, Math.max(1, Number(route.params.step) || 1)) - 1;
  const step = STEPS[idx];
  const last = idx === STEPS.length - 1;
  const ok = step.valid(profile);
  const [showSkipHint, setShowSkipHint] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // A new list that hasn't finished the questions, with another list to go back to: it can be abandoned.
  const abandonable = !onboardingDone && lists.length > 1;
  const previous = abandonable ? lists.find((l) => l.id === activeList.from) ?? lists.find((l) => l.id !== activeList.id) : undefined;
  const abandon = () => {
    deleteList(activeList.id);
    navigate("/list", { replace: true });
  };

  const go = (i: number) => {
    setShowSkipHint(false);
    navigate(`/onboarding/${i + 1}`);
  };
  const next = () => {
    if (!hasProfile) updateProfile({});
    if (last) {
      finishOnboarding();
      navigate("/research", { replace: true });
    } else go(idx + 1);
  };

  return (
    <Screen
      title={`${idx + 1} of ${STEPS.length}`}
      largeTitle={false}
      left={
        idx === 0 && abandonable ? (
          <button type="button" className="cc-link min-h-tap px-1 text-body" onClick={() => setConfirmCancel(true)}>
            Cancel
          </button>
        ) : (
          <button type="button" className="-ml-2 flex min-h-tap items-center pr-2 text-accent" aria-label={idx === 0 ? "Back to start" : "Previous question"} onClick={() => (idx === 0 ? navigate("/", { replace: true }) : go(idx - 1))}>
            <IconChevronLeft size={26} />
          </button>
        )
      }
      right={
        step.optional ? (
          <button type="button" className="cc-link min-h-tap px-1 text-body" onClick={next}>
            Skip
          </button>
        ) : null
      }
      bar={<ProgressBar value={(idx + 1) / STEPS.length} label={`Question ${idx + 1} of ${STEPS.length}`} />}
      footer={
        <StickyActions>
          <Button
            onClick={() => {
              if (!ok) {
                setShowSkipHint(true);
                return;
              }
              next();
            }}
            aria-disabled={!ok}
            className={ok ? "" : "opacity-50"}
          >
            {last ? "Find my colleges" : "Continue"}
          </Button>
          {abandonable && idx > 0 && (
            <button type="button" className="cc-link min-h-tap text-center text-subhead" onClick={() => setConfirmCancel(true)}>
              Cancel new list
            </button>
          )}
        </StickyActions>
      }
    >
      <div key={step.id} className="cc-pop pt-2">
        <h2 className="text-title1 leading-tight">{step.title}</h2>
        {step.subtitle && <p className="mt-1.5 text-subhead text-text-muted">{step.subtitle}</p>}
        {showSkipHint && !ok && (
          <p role="alert" className="mt-2 text-footnote text-bad">
            {step.id === "home" ? "Choose your home state to continue." : step.id === "gpa" ? "Enter an unweighted GPA between 0 and 4.0." : step.id === "majors" ? "Pick at least one field, or Undecided." : "This one's needed to continue."}
          </p>
        )}
        <div className="mt-5">{step.render(profile, updateProfile)}</div>
      </div>
      <ConfirmSheet
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={`Cancel ${activeList.name}?`}
        message={`Its answers so far are removed from this phone${previous ? `, and you go back to ${previous.name}` : ""}.`}
        confirmLabel="Cancel new list"
        cancelLabel="Keep going"
        destructive
        onConfirm={abandon}
      />
    </Screen>
  );
}

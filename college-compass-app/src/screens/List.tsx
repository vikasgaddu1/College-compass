import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Ownership, RankedCollege, Tier } from "@/types";
import { navigate } from "@/lib/router";
import { useStore, type SortKey } from "@/state/store";
import { TIERS, TIER_ORDER, tierInfo } from "@/state/catalog";
import { auth, describeError, researchApi } from "@/state/services";
import { Screen } from "@/components/Screen";
import { Sheet } from "@/components/Sheet";
import { CollegeCard } from "@/components/CollegeCard";
import { SignInAgain, needsSignIn, reasonFor } from "@/components/SignInAgain";
import { Banner, Button, CardSkeleton, Chip, Empty, Segmented } from "@/components/ui";
import { IconFilter, IconPlus, IconSearch, IconClose } from "@/components/icons";

interface Filters {
  tiers: Tier[];
  maxPrice: number | null;
  ownership: Ownership | "any";
  savedOnly: boolean;
}
const NO_FILTERS: Filters = { tiers: [], maxPrice: null, ownership: "any", savedOnly: false };

export function List({ selectedId, tabBar }: { selectedId?: string; tabBar?: ReactNode }) {
  const { ranked, balanced, others, colleges, profile, prefs, setPrefs, isSaved, toggleSaved, upsertCollege, demo, connected, hasProfile, enterDemo } = useStore();
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<{ detail: string; code?: string } | null>(null);

  const sort = prefs.sort;
  const filterCount = (filters.tiers.length ? 1 : 0) + (filters.maxPrice != null ? 1 : 0) + (filters.ownership !== "any" ? 1 : 0) + (filters.savedOnly ? 1 : 0);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const keep = (r: RankedCollege) => {
      if (s && !`${r.college.name} ${r.college.short} ${r.college.city} ${r.college.state}`.toLowerCase().includes(s)) return false;
      if (filters.tiers.length && !filters.tiers.includes(r.odds.tier)) return false;
      if (filters.maxPrice != null && (r.est_net_price == null || r.est_net_price > filters.maxPrice)) return false;
      if (filters.ownership !== "any" && r.college.ownership !== filters.ownership) return false;
      if (filters.savedOnly && !isSaved(r.college.id)) return false;
      return true;
    };
    const cmp = (a: RankedCollege, b: RankedCollege) => {
      if (sort === "odds") return b.odds.p - a.odds.p;
      if (sort === "price") return (a.est_net_price ?? Infinity) - (b.est_net_price ?? Infinity);
      return b.fit.total - a.fit.total;
    };
    const groups: { tier: Tier | "others"; items: RankedCollege[] }[] = TIER_ORDER.map((t) => ({ tier: t, items: balanced[t].filter(keep).sort(cmp) }));
    groups.push({ tier: "others", items: others.filter(keep).sort(cmp) });
    return groups.filter((g) => g.items.length > 0);
  }, [balanced, others, q, filters, sort, isSaved]);
  const borrowedIds = useMemo(() => new Map(balanced.borrowed.map((b) => [b.id, b])), [balanced.borrowed]);

  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  const addCollege = async () => {
    const name = addName.trim();
    if (!name) return;
    setAdding(true);
    setAddError(null);
    try {
      const college = await researchApi(demo).researchOne(name, profile, prefs.model ?? undefined);
      upsertCollege(college);
      setAddOpen(false);
      setAddName("");
    } catch (e) {
      setAddError(describeError(e));
    } finally {
      setAdding(false);
    }
  };

  // Signed in again from the card inside the sheet: clear it so "Research and add" can be tapped.
  const addNeedsSession = !!addError && needsSignIn(addError.code);
  useEffect(() => {
    if (!addNeedsSession) return;
    return auth.subscribe(() => {
      if (auth.account() && !auth.lastError?.()) setAddError(null);
    });
  }, [addNeedsSession]);

  const counts = TIER_ORDER.map((t) => balanced[t].length);

  return (
    <>
      <Screen
        title="Your list"
        subtitle={
          ranked.length ? (
            <span className="tnum">
              {ranked.length} colleges · {TIER_ORDER.map((t, i) => (counts[i] ? `${counts[i]} ${tierInfo(t).label.toLowerCase()}` : null)).filter(Boolean).join(", ")}
            </span>
          ) : undefined
        }
        right={
          <>
            <button type="button" className="grid h-11 w-11 place-items-center text-accent" aria-label="Search" aria-pressed={searchOpen} onClick={() => setSearchOpen((v) => !v)}>
              <IconSearch size={22} />
            </button>
            <button type="button" className="relative grid h-11 w-11 place-items-center text-accent" aria-label={`Filters${filterCount ? `, ${filterCount} active` : ""}`} onClick={() => setFilterOpen(true)}>
              <IconFilter size={22} />
              {filterCount > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden />}
            </button>
            <button type="button" className="grid h-11 w-11 place-items-center text-accent" aria-label="Add a college" onClick={() => setAddOpen(true)}>
              <IconPlus size={24} />
            </button>
          </>
        }
        bar={
          <div className="space-y-2">
            {searchOpen && (
              <div className="cc-search">
                <IconSearch size={18} className="text-text-muted" />
                <input autoFocus placeholder="Search your list" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search your list" />
                {q && (
                  <button type="button" className="grid h-8 w-8 place-items-center text-text-muted" aria-label="Clear search" onClick={() => setQ("")}>
                    <IconClose size={16} />
                  </button>
                )}
              </div>
            )}
            {ranked.length > 0 && (
              <Segmented<SortKey> label="Sort by" value={sort} onChange={(sort) => setPrefs({ sort })} options={[{ id: "fit", label: "Best fit" }, { id: "odds", label: "Best odds" }, { id: "price", label: "Lowest price" }]} />
            )}
          </div>
        }
        footer={tabBar}
      >
        {!hasProfile ? (
          <Empty icon="🧭" title="Let's build your list" message="Answer a few questions and we'll research colleges that fit you." action={<Button onClick={() => navigate("/onboarding/1")}>Start</Button>} />
        ) : colleges.length === 0 && !connected && !demo ? (
          <div className="pt-4">
            <SignInAgain returnTo="/research" reason="signed_out" line="Sign in to research colleges that fit your answers — everything stays on this phone." />
            <p className="mt-4 text-center text-footnote text-text-muted">
              No ChatGPT account?{" "}
              <button
                type="button"
                className="cc-link min-h-tap"
                onClick={() => {
                  enterDemo();
                  navigate("/list", { replace: true });
                }}
              >
                Try the demo
              </button>
            </p>
          </div>
        ) : colleges.length === 0 ? (
          <Empty icon="🔎" title="No research yet" message="Run research to build a balanced list from your answers." action={<Button onClick={() => navigate("/research")}>Research colleges</Button>} />
        ) : shown === 0 ? (
          <Empty
            icon="🫥"
            title="Nothing matches"
            message={q ? `No college on your list matches "${q}".` : "Try loosening the filters."}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQ("");
                  setFilters(NO_FILTERS);
                }}
              >
                Clear search and filters
              </Button>
            }
          />
        ) : (
          groups.map((g) => {
            const t = g.tier === "others" ? null : tierInfo(g.tier);
            return (
              <section key={g.tier} aria-label={t ? t.label : "Also researched"}>
                <header className="cc-section-head">
                  {t && <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.cssVar }} aria-hidden />}
                  <h2 className="text-headline">{t ? t.label : "Also researched"}</h2>
                  <span className="text-footnote text-text-muted">{t ? `${t.range} · ${g.items.length}` : `not in the balanced picks · ${g.items.length}`}</span>
                </header>
                <div className="space-y-3">
                  {g.items.map((r) => {
                    const b = borrowedIds.get(r.college.id);
                    return (
                      <div key={r.college.id} className={selectedId === r.college.id ? "rounded-card ring-2 ring-accent" : ""}>
                        <CollegeCard item={r} saved={isSaved(r.college.id)} onToggleSave={() => toggleSaved(r.college.id)} note={b && b.to === g.tier ? `Really a ${tierInfo(b.from).label.toLowerCase()}; placed here because the ${tierInfo(b.to).label.toLowerCase()} group was short.` : undefined} />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
        {balanced.gaps.length > 0 && shown > 0 && !q && (
          <section className="mt-6" aria-label="What's missing">
            <h2 className="cc-group-label">What's missing</h2>
            <div className="cc-group">
              {balanced.gaps.map((gap) => (
                <div key={gap} className="cc-row-static">
                  <span className="text-subhead">{gap}</span>
                </div>
              ))}
              <button type="button" className="cc-row cc-row-press text-accent" onClick={() => setAddOpen(true)}>
                <IconPlus size={18} />
                <span className="text-body font-medium">Add a college</span>
              </button>
            </div>
          </section>
        )}
        {demo && colleges.length > 0 && <p className="mt-6 text-center text-footnote text-text-muted">Demo mode: sample research with approximate figures.</p>}
      </Screen>

      {/* Filters sheet */}
      <Sheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        left={
          <button type="button" className="cc-link min-h-tap px-1 text-body" onClick={() => setFilters(NO_FILTERS)} disabled={filterCount === 0}>
            Reset
          </button>
        }
      >
        <h3 className="cc-group-label !px-0">Tier</h3>
        <div className="flex flex-wrap gap-2">
          {TIERS.map((t) => (
            <Chip key={t.id} selected={filters.tiers.includes(t.id)} onClick={() => setFilters((f) => ({ ...f, tiers: f.tiers.includes(t.id) ? f.tiers.filter((x) => x !== t.id) : [...f.tiers, t.id] }))}>
              <span className="h-2 w-2 rounded-full" style={{ background: t.cssVar }} aria-hidden />
              {t.label}
            </Chip>
          ))}
        </div>
        <h3 className="cc-group-label mt-5 !px-0">Estimated net price per year</h3>
        <div className="flex flex-wrap gap-2">
          {[null, 15000, 25000, 35000, 50000].map((v) => (
            <Chip key={String(v)} selected={filters.maxPrice === v} onClick={() => setFilters((f) => ({ ...f, maxPrice: v }))}>
              {v == null ? "Any" : `Under $${v / 1000}k`}
            </Chip>
          ))}
        </div>
        <h3 className="cc-group-label mt-5 !px-0">Type</h3>
        <Segmented<Ownership | "any"> label="Type" value={filters.ownership} onChange={(ownership) => setFilters((f) => ({ ...f, ownership }))} options={[{ id: "any", label: "All" }, { id: "public", label: "Public" }, { id: "private_nonprofit", label: "Private" }]} />
        <div className="mt-5 flex items-center justify-between py-1">
          <span className="text-body">Shortlisted only</span>
          <button type="button" role="switch" aria-checked={filters.savedOnly} aria-label="Shortlisted only" className="cc-switch" onClick={() => setFilters((f) => ({ ...f, savedOnly: !f.savedOnly }))} />
        </div>
        <div className="pt-4">
          <Button onClick={() => setFilterOpen(false)}>Show {shown} colleges</Button>
        </div>
      </Sheet>

      {/* Add college sheet */}
      <Sheet
        open={addOpen}
        onClose={() => !adding && setAddOpen(false)}
        title="Add a college"
        right={
          <button type="button" className="cc-link min-h-tap px-1 text-body" onClick={() => setAddOpen(false)} disabled={adding}>
            Cancel
          </button>
        }
      >
        <p className="text-subhead text-text-muted">We'll research it and place it on your list with odds and a fit score.</p>
        <input className="cc-input mt-3" placeholder="College name" value={addName} autoFocus autoCapitalize="words" enterKeyHint="go" onChange={(e) => setAddName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCollege()} aria-label="College name" disabled={adding} />
        {addError && needsSignIn(addError.code) && (
          <div className="mt-3">
            <SignInAgain returnTo="/list" reason={reasonFor(addError.code)} line="Sign in again to add colleges — your list is saved on this phone." />
          </div>
        )}
        {addError && !needsSignIn(addError.code) && (
          <div className="mt-3">
            <Banner tone="error">{addError.detail}</Banner>
          </div>
        )}
        {adding && (
          <div className="mt-3">
            <CardSkeleton />
          </div>
        )}
        <div className="pt-4">
          <Button onClick={addCollege} disabled={adding || !addName.trim()} aria-busy={adding}>
            {adding ? "Researching…" : "Research and add"}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

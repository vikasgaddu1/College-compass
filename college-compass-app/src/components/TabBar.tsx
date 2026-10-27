import { navigate } from "@/lib/router";
import { IconChat, IconGear, IconLifebuoy, IconList, IconStar } from "./icons";

export type TabId = "list" | "shortlist" | "counselors" | "ask" | "settings";

const TABS: { id: TabId; label: string; path: string; Icon: typeof IconList }[] = [
  { id: "list", label: "List", path: "/list", Icon: IconList },
  { id: "shortlist", label: "Shortlist", path: "/shortlist", Icon: IconStar },
  // The paid directory ("Get expert help") sits where students look for help, not buried in Settings.
  { id: "counselors", label: "Counselors", path: "/counselors", Icon: IconLifebuoy },
  { id: "ask", label: "Ask", path: "/ask", Icon: IconChat },
  { id: "settings", label: "Settings", path: "/settings", Icon: IconGear },
];

export function TabBar({ active, badges }: { active: TabId; badges?: Partial<Record<TabId, number>> }) {
  return (
    <nav className="cc-tabbar cc-chrome" aria-label="Main">
      <div className="cc-tabbar-inner">
        {TABS.map(({ id, label, path, Icon }) => {
          const n = badges?.[id];
          return (
            <button
              key={id}
              type="button"
              className="cc-tab"
              aria-current={active === id ? "page" : undefined}
              aria-label={n ? `${label}, ${n}` : label}
              onClick={() => {
                if (active !== id) navigate(path, { replace: true });
              }}
            >
              <Icon strokeWidth={active === id ? 2.2 : 1.7} />
              <span>{label}</span>
              {n ? <span className="cc-tab-badge" aria-hidden>{n > 99 ? "99+" : n}</span> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

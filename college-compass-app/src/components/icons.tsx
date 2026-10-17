/** Inline SVG glyphs (SF Symbols-flavoured), 24×24 viewBox, stroke-based. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number | undefined, rest: SVGProps<SVGSVGElement>) => ({
  width: size ?? 24,
  height: size ?? 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
  ...rest,
});

export const IconList = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);
export const IconStar = ({ size, filled, ...r }: P & { filled?: boolean }) => (
  <svg {...base(size, r)} fill={filled ? "currentColor" : "none"}>
    <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9L3.5 9.7l5.9-.8L12 3.5z" />
  </svg>
);
export const IconChat = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M12 4c-4.7 0-8.5 3.1-8.5 7 0 1.8.8 3.4 2.1 4.6L5 20l4.3-1.6c.9.2 1.8.4 2.7.4 4.7 0 8.5-3.1 8.5-7S16.7 4 12 4z" />
  </svg>
);
export const IconGear = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const IconChevronLeft = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeWidth={2.2}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const IconChevronRight = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeWidth={2}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);
export const IconChevronDown = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeWidth={2}>
    <path d="M5 9l7 7 7-7" />
  </svg>
);
export const IconClose = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeWidth={2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconCheck = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeWidth={2.5}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const IconSearch = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4-4" />
  </svg>
);
export const IconPlus = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeWidth={2.2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconFilter = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </svg>
);
export const IconSort = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
  </svg>
);
export const IconShare = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M12 3v12M12 3L8 7M12 3l4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
  </svg>
);
export const IconArrowUp = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeWidth={2.2}>
    <path d="M12 19V5M12 5l-6 6M12 5l6 6" />
  </svg>
);
export const IconArrowDown = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeWidth={2.2}>
    <path d="M12 5v14M12 19l-6-6M12 19l6-6" />
  </svg>
);
export const IconSend = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeWidth={2.2}>
    <path d="M12 19V6M12 6l-6 6M12 6l6 6" />
  </svg>
);
export const IconStop = ({ size, ...r }: P) => (
  <svg {...base(size, r)} fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </svg>
);
export const IconExternal = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </svg>
);
export const IconRefresh = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />
  </svg>
);
export const IconTrash = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);
export const IconCompass = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" fill="currentColor" stroke="none" />
  </svg>
);
export const IconWarning = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M12 4l9 16H3l9-16zM12 10v4M12 17.5v.5" />
  </svg>
);
export const IconUp = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeWidth={2.4}>
    <path d="M12 18V6M12 6l-5 5M12 6l5 5" />
  </svg>
);
export const IconDown = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeWidth={2.4}>
    <path d="M12 6v12M12 18l-5-5M12 18l5-5" />
  </svg>
);
export const IconDash = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeWidth={2.4}>
    <path d="M6 12h12" />
  </svg>
);
export const IconPerson = ({ size, ...r }: P) => (
  <svg {...base(size, r)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
  </svg>
);

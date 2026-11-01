/* Small stroke icons used across the trip view. 24px grid, currentColor. */
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const IconLock = () => (
  <svg {...base}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
export const IconUnlock = () => (
  <svg {...base}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 7.5-1.9" />
  </svg>
);
export const IconSwap = () => (
  <svg {...base}>
    <path d="M7 4 3 8l4 4" />
    <path d="M3 8h14a4 4 0 0 1 4 4" />
    <path d="m17 20 4-4-4-4" />
    <path d="M21 16H7a4 4 0 0 1-4-4" />
  </svg>
);
export const IconUp = () => (
  <svg {...base}>
    <path d="M7 10v11H4V10h3Z" />
    <path d="M7 10l4-7a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 21H7" />
  </svg>
);
export const IconDown = () => (
  <svg {...base} style={{ transform: "rotate(180deg)" }}>
    <path d="M7 10v11H4V10h3Z" />
    <path d="M7 10l4-7a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 21H7" />
  </svg>
);
export const IconShare = () => (
  <svg {...base}>
    <path d="M12 3v13" />
    <path d="m7 8 5-5 5 5" />
    <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
  </svg>
);
export const IconCalendar = () => (
  <svg {...base}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
export const IconBookmark = () => (
  <svg {...base}>
    <path d="M6 3h12v18l-6-4-6 4V3Z" />
  </svg>
);
export const IconMap = () => (
  <svg {...base}>
    <path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
    <path d="M9 4v14M15 6v14" />
  </svg>
);
export const IconRefresh = () => (
  <svg {...base}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v6h-6" />
  </svg>
);
export const IconWalk = () => (
  <svg {...base}>
    <circle cx="13" cy="4" r="2" />
    <path d="m9 20 3-6 3 3v4M10 9l3-1 3 3 3 1M12 8l-2 5" />
  </svg>
);
export const IconCar = () => (
  <svg {...base}>
    <path d="M5 16V11l2-5h10l2 5v5" />
    <path d="M3 16h18v3H3z" />
    <circle cx="7.5" cy="16" r="0.5" />
    <circle cx="16.5" cy="16" r="0.5" />
  </svg>
);

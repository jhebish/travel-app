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

/* Navigation (phone tab bar) */
export const IconGlobe = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3.5 9h17M3.5 15h17" />
    <path d="M12 3a14.5 14.5 0 0 1 0 18a14.5 14.5 0 0 1 0-18" />
  </svg>
);
export const IconCompass = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z" />
  </svg>
);
export const IconSuitcase = () => (
  <svg {...base}>
    <rect x="3" y="7" width="18" height="13" rx="2.5" />
    <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
    <path d="M8 7v13M16 7v13" />
  </svg>
);
export const IconPeople = () => (
  <svg {...base}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6" />
    <path d="M18 14.6a6.5 6.5 0 0 1 3.5 5.4" />
  </svg>
);
export const IconUser = () => (
  <svg {...base}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);
export const IconMessage = () => (
  <svg {...base}>
    <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l1.9-5.4A8.5 8.5 0 1 1 21 11.5z" />
  </svg>
);
export const IconPlus = () => (
  <svg {...base}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconLink = () => (
  <svg {...base}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
  </svg>
);
export const IconSun = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const IconPhotos = () => (
  <svg {...base}>
    <rect x="3" y="6" width="14" height="13" rx="2" />
    <path d="M7 3h12a2 2 0 0 1 2 2v11" />
    <path d="m3 16 4-4 3 3 2-2 5 5" />
  </svg>
);
export const IconPhone = () => (
  <svg {...base}>
    <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z" />
  </svg>
);
export const IconClose = () => (
  <svg {...base}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

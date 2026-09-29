import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "chat"
  | "library"
  | "tasks"
  | "reports"
  | "panel"
  | "settings"
  | "plus"
  | "search"
  | "chevronRight"
  | "chevronDown"
  | "chevronLeft"
  | "check"
  | "clock"
  | "trend"
  | "history"
  | "forecast"
  | "checklist"
  | "competitors"
  | "custom"
  | "globe"
  | "upload"
  | "download"
  | "dots"
  | "close"
  | "send"
  | "share"
  | "doc"
  | "trash"
  | "external"
  | "grid"
  | "book"
  | "copy"
  | "refresh"
  | "edit"
  | "thumbsUp"
  | "thumbsDown"
  | "eye"
  | "reload"
  | "pin"
  | "sparkles"
  | "filter"
  | "folder"
  | "database"
  | "play"
  | "stop"
  | "link"
  | "layers"
  | "target"
  | "sort"
  | "command"
  | "star"
  | "list";

const PATHS: Record<IconName, ReactNode> = {
  chat: <path d="M20 12a7.5 7.5 0 01-10.9 6.7L4.5 20l1.4-4.4A7.5 7.5 0 1120 12z" />,
  library: (
    <>
      <path d="M4 5.5c0-1 .8-1.5 1.7-1.5H11v15H5.7c-.9 0-1.7-.6-1.7-1.5v-12z" />
      <path d="M20 5.5c0-1-.8-1.5-1.7-1.5H13v15h5.3c.9 0 1.7-.6 1.7-1.5v-12z" />
    </>
  ),
  tasks: (
    <>
      <rect x="4" y="4.5" width="16" height="15" rx="2.5" />
      <path d="M8 9.5h8M8 13h5.5M8 16.5h3" />
    </>
  ),
  reports: (
    <>
      <path d="M13.5 3.5H7.2A1.7 1.7 0 005.5 5.2v13.6a1.7 1.7 0 001.7 1.7h9.6a1.7 1.7 0 001.7-1.7V8.5l-5-5z" />
      <path d="M13.5 3.5v5h5" />
    </>
  ),
  panel: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M15 4.5v15" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.8" />
      <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M17.9 6.1l-1.6 1.6M7.7 16.3l-1.6 1.6M17.9 17.9l-1.6-1.6M7.7 7.7L6.1 6.1" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  chevronLeft: <path d="M14.5 6l-6 6 6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  trend: <path d="M4 19h16M7 19V9.5M12 19V5.5M17 19v-6" />,
  history: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  forecast: <path d="M4 16l5-5 4 3 7-8" />,
  checklist: (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  competitors: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 19.5c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
    </>
  ),
  custom: <path d="M12 5.5v13M5.5 12h13" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M4.5 12h15M12 4.5c2 2.2 3 4.7 3 7.5s-1 5.3-3 7.5c-2-2.2-3-4.7-3-7.5s1-5.3 3-7.5z" />
    </>
  ),
  upload: <path d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M5 18.5h14" />,
  download: <path d="M12 4.5v11m0 0L7.5 11M12 15.5l4.5-4.5M5 19.5h14" />,
  dots: (
    <>
      <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  send: <path d="M5 12h13M12.5 6l6 6-6 6" />,
  share: (
    <>
      <circle cx="17" cy="6" r="2.6" />
      <circle cx="7" cy="12" r="2.6" />
      <circle cx="17" cy="18" r="2.6" />
      <path d="M9.3 10.7l5.4-3.1M9.3 13.3l5.4 3.1" />
    </>
  ),
  doc: (
    <>
      <path d="M13.5 3.5H7.2A1.7 1.7 0 005.5 5.2v13.6a1.7 1.7 0 001.7 1.7h9.6a1.7 1.7 0 001.7-1.7V8.5l-5-5z" />
      <path d="M13.5 3.5v5h5" />
    </>
  ),
  trash: <path d="M5 7h14M9.5 7V5.5h5V7M7 7l1 12.5h8L17 7" />,
  external: (
    <path d="M14 4.5h5.5V10M19 5l-7.5 7.5M17 14v4.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 015 18.5v-9A1.5 1.5 0 016.5 8H11" />
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5v-13z" />
      <path d="M20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5a1.5 1.5 0 001.5-1.5v-13z" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 6.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2h.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 11-2.4-5.7" />
      <path d="M20 4.5V10h-5.5" />
    </>
  ),
  reload: (
    <>
      <path d="M4.5 12a7.5 7.5 0 111.9 5" />
      <path d="M4.5 19.5V14h5.5" />
    </>
  ),
  edit: (
    <>
      <path d="M15.5 5.2l3.3 3.3L9.6 17.7l-4.1.8.8-4.1L15.5 5.2z" />
      <path d="M14 6.8l3.2 3.2" />
    </>
  ),
  thumbsUp: (
    <>
      <path d="M7 20.5V11l4-7.5c1.4.4 1.9 1.5 1.7 2.9L12.2 9.5h5.1a1.9 1.9 0 011.8 2.5l-1.7 6.3a2.4 2.4 0 01-2.3 2.2H7z" />
      <path d="M4.5 11h2.5v9.5H4.5z" />
    </>
  ),
  thumbsDown: (
    <>
      <path d="M17 3.5V13l-4 7.5c-1.4-.4-1.9-1.5-1.7-2.9l.5-4.1H6.7a1.9 1.9 0 01-1.8-2.5l1.7-6.3A2.4 2.4 0 018.9 3.5H17z" />
      <path d="M19.5 13H17V3.5h2.5z" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  pin: (
    <>
      <path d="M9.5 3.5h5l-.8 5.2 3.3 3.3H7l3.3-3.3-.8-5.2z" />
      <path d="M12 12v8" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7L12 4z" />
      <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
    </>
  ),
  filter: <path d="M4 6h16l-6 7v6l-4 1.5v-7.5L4 6z" />,
  folder: (
    <path d="M4 6.5a1.5 1.5 0 011.5-1.5h4l2 2.5h7a1.5 1.5 0 011.5 1.5v8a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17v-10.5z" />
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.8" />
      <path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6" />
      <path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
    </>
  ),
  play: <path d="M8 5.5l10 6.5-10 6.5v-13z" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />,
  link: (
    <>
      <path d="M10.5 13.5a3.5 3.5 0 010-5l3-3a3.5 3.5 0 015 5l-1.5 1.5" />
      <path d="M13.5 10.5a3.5 3.5 0 010 5l-3 3a3.5 3.5 0 01-5-5l1.5-1.5" />
    </>
  ),
  layers: (
    <>
      <path d="M12 4l8 4.5-8 4.5-8-4.5L12 4z" />
      <path d="M4 14l8 4.5 8-4.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  sort: <path d="M7 5v14M7 19l-2.5-2.5M7 5l2.5 2.5M13 7h7M13 12h5M13 17h3" />,
  command: (
    <path d="M9 6a2.5 2.5 0 10-2.5 2.5H17.5A2.5 2.5 0 1015 6v12a2.5 2.5 0 102.5-2.5h-11A2.5 2.5 0 109 18V6z" />
  ),
  star: (
    <path d="M12 4.5l2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.8 5.4-.7 2.4-5z" />
  ),
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
};

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.75,
  className = "",
  ...rest
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/** 品牌图形，独立于 stroke 图标集 */
export function BrandMark({ size = 16, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3l7.5 13.2H4.5L12 3z" stroke={color} strokeWidth="1.9" strokeLinejoin="round" />
      <circle cx="12" cy="17.6" r="2.4" fill="var(--primary)" />
    </svg>
  );
}

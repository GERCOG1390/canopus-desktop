// Line icons for the app chrome (navigation, top bar). Game items use their own CCP icons.

const PATHS = {
  character: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  fleet: 'M5 21V4M5 4h11l-2 4 2 4H5',
  intel: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 12m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M12 12L18 6',
  fitting: 'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9zM12 8.5l3 1.75v3.5L12 15.5l-3-1.75v-3.5z',
  pvp: 'M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M12 2v5M12 17v5M2 12h5M17 12h5',
  market: 'M4 19V5M4 19h16M8 15l3-4 3 2 5-6',
  industry: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  map: 'M9 4L3 7v13l6-3 6 3 6-3V4l-6 3-6-3zM9 4v13M15 7v13',
  activities: 'M12 3l9 9-9 9-9-9zM12 8l4 4-4 4-4-4z',
  settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  chevron: 'M9 6l6 6-6 6',
  star: 'M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.2-1-1.4-1-2.4 0-.8.6-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5zM7.5 11.5h0M10 7.5h0M14.5 7.5h0',
  update: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5M19 8v6M16 11h6',
  globe: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  rows: 'M4 6h16M4 12h16M4 18h16'
} as const

export type GlyphName = keyof typeof PATHS

export function Glyph({ name, size = 18, className = '' }: { name: GlyphName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

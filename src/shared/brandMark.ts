// The Canopus mark, alive (the app's sidebar and the website use the same one): a star with its orbit; a satellite with a comet tail goes round, in front of the star and
// behind it; the star breathes and now and then glints. `p` prefixes the ids so several marks can share a page.
export function markSvg({ size = 30, p = 'mk', cls = '', dur = 9 }: { size?: number; p?: string; cls?: string; dur?: number } = {}): string {
  const STAR = 'M256 70 C 270 190, 322 242, 442 256 C 322 270, 270 322, 256 442 C 242 322, 190 270, 70 256 C 190 242, 242 190, 256 70 Z'
  const ORBIT = 'M440 256 A184 60 0 1 1 72 256 A184 60 0 1 1 440 256'
  const DUR = `${dur}s`
  const moving = (): string => `
    <path class="mk-trail" d="${ORBIT}" pathLength="1000" fill="none" stroke="#8fe0c8" stroke-opacity="0.35" stroke-width="16" stroke-linecap="round" stroke-dasharray="170 830">
      <animate attributeName="stroke-dashoffset" values="170;-830" dur="${DUR}" repeatCount="indefinite" />
    </path>
    <path class="mk-trail" d="${ORBIT}" pathLength="1000" fill="none" stroke="#d9fff3" stroke-opacity="0.9" stroke-width="10" stroke-linecap="round" stroke-dasharray="60 940">
      <animate attributeName="stroke-dashoffset" values="60;-940" dur="${DUR}" repeatCount="indefinite" />
    </path>
    <g class="mk-dot">
      <circle r="30" fill="#8fe0c8" opacity="0.28" />
      <circle r="14" fill="#f4fffb" />
      <animateMotion dur="${DUR}" repeatCount="indefinite" path="${ORBIT}" />
    </g>`
  return `<svg class="mark ${cls}" viewBox="60 60 392 392" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <linearGradient id="${p}-star" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff6e0" /><stop offset="0.5" stop-color="#ffd98a" /><stop offset="1" stop-color="#e0a94a" />
    </linearGradient>
    <radialGradient id="${p}-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffd98a" stop-opacity="0.55" /><stop offset="1" stop-color="#ffd98a" stop-opacity="0" />
    </radialGradient>
    <clipPath id="${p}-front"><rect x="0" y="256" width="512" height="256" /></clipPath>
    <clipPath id="${p}-back"><rect x="0" y="0" width="512" height="256" /></clipPath>
  </defs>
  <circle class="mk-glow" cx="256" cy="256" r="170" fill="url(#${p}-glow)" />
  <g transform="rotate(-24 256 256)">
    <g clip-path="url(#${p}-back)">
      <path class="mk-ring" d="${ORBIT}" pathLength="1000" fill="none" stroke="#3dbf9c" stroke-opacity="0.75" stroke-width="14" />
      ${moving()}
    </g>
  </g>
  <path class="mk-star" d="${STAR}" fill="url(#${p}-star)" />
  <path class="mk-glint" d="M256 120 L264 248 L392 256 L264 264 L256 392 L248 264 L120 256 L248 248 Z" fill="#fffaf0" />
  <g transform="rotate(-24 256 256)">
    <g clip-path="url(#${p}-front)">
      <path class="mk-ring" d="${ORBIT}" pathLength="1000" fill="none" stroke="#3dbf9c" stroke-opacity="0.75" stroke-width="14" />
      ${moving()}
    </g>
  </g>
</svg>`
}

/** Its motion; without it the mark stands still. Off when the system asks for reduced motion. */
export const MARK_CSS = `
.mark { overflow: visible; }
.mark .mk-star, .mark .mk-glow, .mark .mk-glint { transform-box: fill-box; transform-origin: center; }
.mark .mk-star { animation: mk-breathe 5s ease-in-out infinite; }
.mark .mk-glow { animation: mk-glow 5s ease-in-out infinite; }
.mark .mk-glint { opacity: 0; transform: rotate(45deg) scale(0.4); animation: mk-glint 7s ease-in-out infinite 2s; }
.mark.intro .mk-ring { stroke-dasharray: 1000; animation: mk-draw 1.4s cubic-bezier(.6,0,.2,1) both; }
.mark.intro .mk-star { animation: mk-open 1.1s cubic-bezier(.2,1.4,.4,1) both, mk-breathe 5s ease-in-out 1.1s infinite; }
.mark.intro .mk-trail, .mark.intro .mk-dot { animation: mk-fade 0.8s ease 1.1s both; }
a:hover > .mark .mk-star, .mark:hover .mk-star { animation: mk-flare 0.6s ease-out; }
a:hover > .mark .mk-glint, .mark:hover .mk-glint { animation: mk-glint-now 0.7s ease-out; }
@keyframes mk-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.045); } }
@keyframes mk-glow { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }
@keyframes mk-glint { 0%, 88%, 100% { opacity: 0; transform: rotate(45deg) scale(0.4); } 93% { opacity: 0.9; transform: rotate(90deg) scale(1); } }
@keyframes mk-glint-now { 0% { opacity: 0; transform: rotate(45deg) scale(0.4); } 40% { opacity: 1; transform: rotate(80deg) scale(1.1); } 100% { opacity: 0; transform: rotate(110deg) scale(0.6); } }
@keyframes mk-draw { from { stroke-dashoffset: 1000; } to { stroke-dashoffset: 0; } }
@keyframes mk-open { from { transform: scale(0.2) rotate(-120deg); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes mk-flare { 0% { transform: scale(1); } 35% { transform: scale(1.16) rotate(8deg); filter: brightness(1.25); } 100% { transform: scale(1); } }
@keyframes mk-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .mark .mk-trail, .mark .mk-dot { display: none; }
  .mark * { animation: none !important; }
}`

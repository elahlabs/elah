/**
 * Ten hand-written icon fixtures for PV-P6b-2's fidelity tests, plus two
 * gradient logo fixtures added by PV-P6b-3 once gradients are real `Paint`s.
 */

import type { SvgSkip } from './types'

export interface SvgFixture {
  name: string
  kind: 'icon' | 'logo'
  svg: string
  expectedShapes: number
  expectedSkipped: SvgSkip[]
}

export const SVG_FIDELITY_FIXTURES: SvgFixture[] = [
  {
    name: 'check',
    kind: 'icon',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 10 18 20 6"/></svg>',
    expectedShapes: 1,
    expectedSkipped: [],
  },
  {
    name: 'close',
    kind: 'icon',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    expectedShapes: 2,
    expectedSkipped: [],
  },
  {
    name: 'plus-circle',
    kind: 'icon',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8" stroke-linecap="round"/></svg>',
    expectedShapes: 2,
    expectedSkipped: [],
  },
  {
    name: 'home',
    kind: 'icon',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="2" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H4a1 1 0 0 1-1-1z"/></svg>',
    expectedShapes: 1,
    expectedSkipped: [],
  },
  {
    name: 'heart',
    kind: 'icon',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#e11d48" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.1 2.9 4 6.8 4c2.3 0 3.9 1.3 5.2 3 1.3-1.7 2.9-3 5.2-3 3.9 0 5.9 4.1 4.4 7.8C19.5 16.4 12 21 12 21z"/></svg>',
    expectedShapes: 1,
    expectedSkipped: [],
  },
  {
    name: 'star',
    kind: 'icon',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><polygon fill="#f59e0b" fill-rule="evenodd" points="12,2 14.9,8.6 22,9.2 16.6,13.9 18.2,21 12,17.3 5.8,21 7.4,13.9 2,9.2 9.1,8.6"/></svg>',
    expectedShapes: 1,
    expectedSkipped: [],
  },
  {
    name: 'bell',
    kind: 'icon',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M9 20q1.5 2 3 0t3 0" stroke-linecap="round"/></svg>',
    expectedShapes: 2,
    expectedSkipped: [],
  },
  {
    name: 'pin',
    kind: 'icon',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><g transform="translate(0 1)"><path d="M12 21c-4-4.5-7-8-7-11.5a7 7 0 0 1 14 0C19 13 16 16.5 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></g></svg>',
    expectedShapes: 2,
    expectedSkipped: [],
  },
  {
    name: 'badge',
    kind: 'icon',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="#2563eb"/><g transform="rotate(45 12 12)"><ellipse cx="12" cy="12" rx="6" ry="2.5" fill="#ffffff"/></g></svg>',
    expectedShapes: 2,
    expectedSkipped: [],
  },
  {
    name: 'camera',
    kind: 'icon',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>.body{fill:#1f2937}.lens{fill:none;stroke:#f9fafb;stroke-width:1.5}</style><defs><circle id="dot" r="1"/></defs><rect class="body" x="2" y="6" width="20" height="14" rx="2"/><circle class="lens" cx="12" cy="13" r="4"/><use href="#dot" x="18" y="9" fill="#ef4444"/><text x="2" y="4" font-size="3">CAM</text></svg>',
    expectedShapes: 3,
    expectedSkipped: [{ feature: 'text', count: 1 }],
  },
  {
    name: 'sunrise',
    kind: 'logo',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 100"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="100%" stop-color="#f97316"/></linearGradient><linearGradient id="sunStops"><stop offset=".2" stop-color="#fde047"/><stop offset="1" stop-color="#f59e0b" stop-opacity=".6"/></linearGradient><linearGradient id="sun" xlink:href="#sunStops" gradientTransform="rotate(90 .5 .5)"/></defs><rect width="200" height="100" fill="url(#sky)"/><circle cx="100" cy="100" r="40" fill="url(#sun)"/><path d="M0 80Q50 60 100 80T200 80V100H0z" fill="#0f172a" fill-opacity=".9"/></svg>',
    expectedShapes: 3,
    expectedSkipped: [],
  },
  {
    name: 'orb',
    kind: 'logo',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="60" cy="60" r="50" fx="45" fy="45"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#38bdf8"/><stop offset="1" stop-color="#1e40af"/></radialGradient><clipPath id="half"><rect width="120" height="60"/></clipPath><filter id="soft"><feGaussianBlur stdDeviation="2"/></filter></defs><circle cx="60" cy="60" r="50" fill="url(#glow)"/><g opacity=".5" fill="#ffffff"><ellipse cx="45" cy="40" rx="14" ry="8"/><circle cx="75" cy="80" r="6"/></g><path d="M20 100h80" stroke="#0ea5e9" stroke-width="4" stroke-dasharray="8 4" filter="url(#soft)"/><rect x="10" y="10" width="20" height="20" fill="#f43f5e" clip-path="url(#half)"/><image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/></svg>',
    expectedShapes: 5,
    expectedSkipped: [
      { feature: 'clip-path', count: 1 },
      { feature: 'filter', count: 1 },
      { feature: 'image', count: 1 },
      { feature: 'radial-gradient-focal', count: 1 },
    ],
  },
]

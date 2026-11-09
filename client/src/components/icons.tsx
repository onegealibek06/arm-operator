import type { ThreatLevel } from '../types'

type P = { className?: string }
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const IconJam = ({ className = 'icon' }: P) => (
  <svg {...base} className={className} aria-hidden>
    <path d="M12 20v-6M8.5 10.5a5 5 0 0 1 7 0M5.5 7.5a9 9 0 0 1 13 0" />
    <path d="M3 3l18 18" />
  </svg>
)

export const IconVideo = ({ className = 'icon' }: P) => (
  <svg {...base} className={className} aria-hidden>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="M16 10l5-3v10l-5-3z" />
  </svg>
)

export const IconDrop = ({ className = 'icon' }: P) => (
  <svg {...base} className={className} aria-hidden>
    <circle cx="12" cy="12" r="8" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </svg>
)

export const IconClose = ({ className = 'icon' }: P) => (
  <svg {...base} className={className} aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const IconAlert = ({ className = 'icon' }: P) => (
  <svg {...base} className={className} aria-hidden>
    <path d="M12 3l10 18H2z" />
    <path d="M12 10v5M12 18h.01" />
  </svg>
)

export const IconSort = ({ dir }: { dir: 'asc' | 'desc' | null }) => (
  <svg {...base} className="icon" aria-hidden style={{ opacity: dir ? 1 : 0.35 }}>
    {dir !== 'desc' && <path d="M8 10l4-4 4 4" />}
    {dir !== 'asc' && <path d="M8 14l4 4 4-4" />}
  </svg>
)

export const Logo = () => (
  <svg viewBox="0 0 32 32" aria-hidden>
    <rect width="32" height="32" rx="7" fill="#161a20" stroke="#2f3641" />
    <circle cx="16" cy="16" r="9.5" fill="none" stroke="#3d9cf5" strokeOpacity=".45" />
    <circle cx="16" cy="16" r="4.5" fill="none" stroke="#3d9cf5" strokeOpacity=".45" />
    <path d="M16 16L23 9.5" stroke="#3d9cf5" strokeWidth="2" strokeLinecap="round" />
    <path d="M21 19.5l2 2-2 2-2-2z" fill="#ff4d4f" />
  </svg>
)

export const ThreatShape = ({ level }: { level: ThreatLevel }) => {
  const c = level === 'HIGH' ? '#ff4d4f' : level === 'MEDIUM' ? '#f5a524' : '#3ccf91'
  return (
    <svg viewBox="0 0 12 12" aria-hidden>
      {level === 'HIGH' && <path d="M6 0.8L11.2 6 6 11.2 0.8 6z" fill={c} />}
      {level === 'MEDIUM' && <path d="M6 1.5L10.5 6 6 10.5 1.5 6z" fill="none" stroke={c} strokeWidth="1.8" />}
      {level === 'LOW' && <circle cx="6" cy="6" r="4.2" fill="none" stroke={c} strokeWidth="1.8" />}
    </svg>
  )
}

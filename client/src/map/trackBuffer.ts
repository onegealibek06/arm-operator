import type { Target } from '../types'

export interface Track {
  target: Target
  x: number
  y: number
  vx: number
  vy: number
  measuredAt: number
  dx: number
  dy: number
  trail: { x: number; y: number }[]
  trailAt: number
}

const MAX_TRAIL = 60
const MAX_EXTRAPOLATION_MS = 2000
const SMOOTHING_MS = 120

export const tracks = new Map<string, Track>()

export function ingestTargets(list: Target[], receivedAt: number): void {
  const seen = new Set<string>()
  for (const t of list) {
    seen.add(t.id)
    const rad = (t.course * Math.PI) / 180
    const vx = Math.sin(rad) * t.speed
    const vy = Math.cos(rad) * t.speed
    const tr = tracks.get(t.id)
    if (!tr) {
      tracks.set(t.id, {
        target: t,
        x: t.x,
        y: t.y,
        vx,
        vy,
        measuredAt: receivedAt,
        dx: t.x,
        dy: t.y,
        trail: [{ x: t.x, y: t.y }],
        trailAt: receivedAt,
      })
      continue
    }
    tr.target = t
    tr.x = t.x
    tr.y = t.y
    tr.vx = vx
    tr.vy = vy
    tr.measuredAt = receivedAt
    if (receivedAt - tr.trailAt > 1000) {
      tr.trail.push({ x: t.x, y: t.y })
      if (tr.trail.length > MAX_TRAIL) tr.trail.shift()
      tr.trailAt = receivedAt
    }
  }
  for (const id of tracks.keys()) if (!seen.has(id)) tracks.delete(id)
}

export function advanceTracks(now: number, dtMs: number): void {
  const k = 1 - Math.exp(-dtMs / SMOOTHING_MS)
  for (const tr of tracks.values()) {
    const age = Math.min(now - tr.measuredAt, MAX_EXTRAPOLATION_MS) / 1000
    const px = tr.x + tr.vx * age
    const py = tr.y + tr.vy * age
    if (Math.hypot(px - tr.dx, py - tr.dy) > 1500) {
      tr.dx = px
      tr.dy = py
    } else {
      tr.dx += (px - tr.dx) * k
      tr.dy += (py - tr.dy) * k
    }
  }
}

export function isTrackStale(tr: Track, now: number): boolean {
  return now - tr.measuredAt > MAX_EXTRAPOLATION_MS
}

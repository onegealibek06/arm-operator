import type { ServerMessage, Target } from '../types'

const THREATS = new Set(['HIGH', 'MEDIUM', 'LOW'])
const TYPES = new Set(['UAV', 'FPV', 'HELICOPTER', 'AIRCRAFT', 'UNKNOWN'])
const STATUSES = new Set(['TRACKING', 'EW_ASSIGNED', 'VIDEO_REQUESTED'])
const NUMERIC: (keyof Target)[] = ['x', 'y', 'lat', 'lon', 'altitude', 'speed', 'azimuth', 'course', 'distance']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function isTarget(v: unknown): v is Target {
  if (!isObj(v)) return false
  if (typeof v.id !== 'string' || !v.id) return false
  if (!TYPES.has(v.type as string) || !THREATS.has(v.threat as string) || !STATUSES.has(v.status as string)) return false
  return NUMERIC.every((k) => isNum(v[k]))
}

export function parseServerMessage(raw: string): ServerMessage | null {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObj(v)) return null

  switch (v.type) {
    case 'telemetry':
      if (!isNum(v.seq) || !isNum(v.ts) || !Array.isArray(v.targets)) return null
      return { type: 'telemetry', seq: v.seq, ts: v.ts, targets: v.targets.filter(isTarget) }
    case 'hello':
      if (!isNum(v.rangeM) || !isNum(v.zoneM) || v.rangeM <= 0) return null
      return v as unknown as ServerMessage
    case 'ack':
      if (typeof v.requestId !== 'string' || typeof v.ok !== 'boolean') return null
      return v as unknown as ServerMessage
    default:
      return null
  }
}

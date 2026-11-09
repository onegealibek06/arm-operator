export type ThreatLevel = 'HIGH' | 'MEDIUM' | 'LOW'
export type TargetType = 'UAV' | 'FPV' | 'HELICOPTER' | 'AIRCRAFT' | 'UNKNOWN'
export type TargetStatus = 'TRACKING' | 'EW_ASSIGNED' | 'VIDEO_REQUESTED'

export interface Target {
  id: string
  type: TargetType
  x: number
  y: number
  lat: number
  lon: number
  altitude: number
  speed: number
  azimuth: number
  course: number
  distance: number
  threat: ThreatLevel
  status: TargetStatus
}

export interface HelloMessage {
  type: 'hello'
  ts: number
  hz: number
  base: { lat: number; lon: number }
  rangeM: number
  zoneM: number
}

export interface TelemetryMessage {
  type: 'telemetry'
  seq: number
  ts: number
  targets: Target[]
}

export interface AckMessage {
  type: 'ack'
  requestId: string
  action: CommandAction
  targetId: string
  ok: boolean
  message: string
  ts: number
}

export type ServerMessage = HelloMessage | TelemetryMessage | AckMessage

export type CommandAction = 'EW_HANDOFF' | 'REQUEST_VIDEO' | 'DROP_TARGET'

export interface CommandMessage {
  type: 'command'
  requestId: string
  action: CommandAction
  targetId: string
  ts: number
}

export type LinkStatus = 'ONLINE' | 'RECONNECTING' | 'OFFLINE'

export interface LinkState {
  status: LinkStatus
  attempt: number
  nextRetryAt: number | null
  stale: boolean
  reason: string | null
}

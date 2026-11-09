// Протокол обмена с бэкендом (см. server/simulator.py и README).

export type ThreatLevel = 'HIGH' | 'MEDIUM' | 'LOW'
export type TargetType = 'UAV' | 'FPV' | 'HELICOPTER' | 'AIRCRAFT' | 'UNKNOWN'
export type TargetStatus = 'TRACKING' | 'EW_ASSIGNED' | 'VIDEO_REQUESTED'

export interface Target {
  id: string
  type: TargetType
  x: number // м на восток от КП
  y: number // м на север от КП
  lat: number
  lon: number
  altitude: number // м
  speed: number // м/с
  azimuth: number // пеленг с КП на цель, градусы
  course: number // направление движения цели, градусы
  distance: number // м до КП
  threat: ThreatLevel
  status: TargetStatus
}

// --- Сервер → клиент ---

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

// --- Клиент → сервер ---

export type CommandAction = 'EW_HANDOFF' | 'REQUEST_VIDEO' | 'DROP_TARGET'

export interface CommandMessage {
  type: 'command'
  requestId: string
  action: CommandAction
  targetId: string
  ts: number
}

// --- Состояние соединения ---

export type LinkStatus = 'ONLINE' | 'RECONNECTING' | 'OFFLINE'

export interface LinkState {
  status: LinkStatus
  attempt: number // номер попытки переподключения подряд
  nextRetryAt: number | null // когда следующая попытка (для обратного отсчёта)
  stale: boolean // сокет открыт, но данные перестали идти
  reason: string | null
}

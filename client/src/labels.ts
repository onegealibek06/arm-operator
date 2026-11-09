import type { TargetStatus, TargetType, ThreatLevel } from './types'

export const TYPE_LABEL: Record<TargetType, string> = {
  UAV: 'БПЛА',
  FPV: 'FPV-дрон',
  HELICOPTER: 'Вертолёт',
  AIRCRAFT: 'Самолёт',
  UNKNOWN: 'Неизвестно',
}

export const THREAT_LABEL: Record<ThreatLevel, string> = {
  HIGH: 'Высокая',
  MEDIUM: 'Средняя',
  LOW: 'Низкая',
}

export const STATUS_LABEL: Record<TargetStatus, string> = {
  TRACKING: 'Сопровождение',
  EW_ASSIGNED: 'Передана в РЭБ',
  VIDEO_REQUESTED: 'Видео запрошено',
}

export const km = (m: number) => (m / 1000).toFixed(2)
export const deg = (d: number) => `${Math.round(d).toString().padStart(3, '0')}°`
export const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

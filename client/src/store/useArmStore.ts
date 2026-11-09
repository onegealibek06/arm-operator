import { create } from 'zustand'
import { MAX_LOG_EVENTS } from '../config'
import { TYPE_LABEL } from '../labels'
import type { CommandAction, LinkState, Target, ThreatLevel } from '../types'

export type SortKey = 'threat' | 'id' | 'distance' | 'speed' | 'azimuth'
export type LogLevel = 'info' | 'warn' | 'alert' | 'cmd' | 'error'

export interface LogEvent {
  id: number
  ts: number
  level: LogLevel
  text: string
}

export interface PendingCommand {
  requestId: string
  action: CommandAction
  targetId: string
  sentAt: number
}

export interface CommandResult {
  action: CommandAction
  ok: boolean
  message: string
  ts: number
}

interface ArmState {
  link: LinkState
  /** Цели, нормализованные по id: обновление одной не трогает остальные. */
  targets: Record<string, Target>
  targetIds: string[]
  /** Цели, пропавшие из потока, пока оператор их смотрел. */
  lostTargets: Record<string, { target: Target; lostAt: number }>
  lastPacketAt: number | null
  packetsPerSec: number
  scene: { rangeM: number; zoneM: number }

  selectedId: string | null
  threatFilter: Record<ThreatLevel, boolean>
  sort: { key: SortKey; dir: 'asc' | 'desc' }

  pending: Record<string, PendingCommand>
  lastResult: Record<string, CommandResult> // по targetId
  events: LogEvent[]

  // actions
  setLink: (link: LinkState) => void
  applySnapshot: (targets: Target[], meta: { lastPacketAt: number; packetsPerSec: number }) => void
  setScene: (scene: { rangeM: number; zoneM: number }) => void
  select: (id: string | null) => void
  toggleThreat: (level: ThreatLevel) => void
  setSort: (key: SortKey) => void
  addPending: (cmd: PendingCommand) => void
  resolvePending: (requestId: string, result: CommandResult | null) => void
  log: (text: string, level?: LogLevel) => void
}

const THREAT_LABEL: Record<ThreatLevel, string> = { HIGH: 'высокая', MEDIUM: 'средняя', LOW: 'низкая' }
let eventId = 0

export const useArmStore = create<ArmState>()((set, get) => ({
  link: { status: 'RECONNECTING', attempt: 0, nextRetryAt: null, stale: false, reason: null },
  targets: {},
  targetIds: [],
  lostTargets: {},
  lastPacketAt: null,
  packetsPerSec: 0,
  scene: { rangeM: 10_000, zoneM: 2_000 },

  selectedId: null,
  threatFilter: { HIGH: true, MEDIUM: true, LOW: true },
  sort: { key: 'threat', dir: 'desc' },

  pending: {},
  lastResult: {},
  events: [],

  setLink: (link) => set({ link }),

  setScene: (scene) => set({ scene }),

  applySnapshot: (list, meta) => {
    const { targets: prev, selectedId, lostTargets, lastResult } = get()
    const next: Record<string, Target> = {}
    const logs: [string, LogLevel][] = []

    for (const t of list) {
      // Если данные цели не изменились, оставляем старый объект: строка таблицы
      // (React.memo) тогда не перерисуется.
      const old = prev[t.id]
      next[t.id] = old && sameTarget(old, t) ? old : t
      if (!old) {
        logs.push([
          `Обнаружена цель ${t.id} (${TYPE_LABEL[t.type]}), дальность ${(t.distance / 1000).toFixed(1)} км, угроза ${THREAT_LABEL[t.threat]}`,
          t.threat === 'HIGH' ? 'alert' : 'info',
        ])
      } else if (old.threat !== t.threat && t.threat === 'HIGH') {
        logs.push([`Угроза ${t.id} повышена до высокой (${(t.distance / 1000).toFixed(1)} км)`, 'alert'])
      }
    }

    let lost = lostTargets
    for (const id of Object.keys(prev)) {
      if (next[id]) continue
      logs.push([`Цель ${id} пропала с сопровождения`, 'warn'])
      if (id === selectedId) lost = { ...lost, [id]: { target: prev[id], lostAt: Date.now() } }
    }

    // результаты команд храним только по живым (или выбранной) целям, иначе за смену словарь растёт
    let results = lastResult
    if (Object.keys(lastResult).some((id) => !next[id] && id !== selectedId)) {
      results = Object.fromEntries(Object.entries(lastResult).filter(([id]) => next[id] || id === selectedId))
    }

    // одно обновление стора на пакет, а не по одному на каждое событие журнала
    set((s) => ({
      targets: next,
      targetIds: list.map((t) => t.id),
      lostTargets: lost,
      lastResult: results,
      lastPacketAt: meta.lastPacketAt,
      packetsPerSec: meta.packetsPerSec,
      events: logs.length ? appendEvents(s.events, logs) : s.events,
    }))
  },

  // Выбор другой цели забывает «потерянные», чтобы словарь не рос бесконечно
  select: (id) => set({ selectedId: id, lostTargets: {} }),

  toggleThreat: (level) => set((s) => ({ threatFilter: { ...s.threatFilter, [level]: !s.threatFilter[level] } })),

  setSort: (key) =>
    set((s) => ({
      sort: s.sort.key === key ? { key, dir: s.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'threat' ? 'desc' : 'asc' },
    })),

  addPending: (cmd) => set((s) => ({ pending: { ...s.pending, [cmd.requestId]: cmd } })),

  resolvePending: (requestId, result) =>
    set((s) => {
      const cmd = s.pending[requestId]
      if (!cmd) return s
      const rest = { ...s.pending }
      delete rest[requestId]
      return {
        pending: rest,
        lastResult: result ? { ...s.lastResult, [cmd.targetId]: result } : s.lastResult,
      }
    }),

  log: (text, level = 'info') => set((s) => ({ events: appendEvents(s.events, [[text, level]]) })),
}))

// журнал ограничен MAX_LOG_EVENTS записями, иначе за смену он съест память
function appendEvents(events: LogEvent[], items: [string, LogLevel][]): LogEvent[] {
  const ts = Date.now()
  const fresh = items.map(([text, level]) => ({ id: ++eventId, ts, level, text })).reverse()
  return [...fresh, ...events].slice(0, MAX_LOG_EVENTS)
}

function sameTarget(a: Target, b: Target): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.speed === b.speed &&
    a.course === b.course &&
    a.threat === b.threat &&
    a.status === b.status &&
    a.altitude === b.altitude
  )
}

export const THREAT_ORDER: Record<ThreatLevel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 }

/** Видимые в таблице цели: фильтр по угрозе + сортировка. */
export function selectVisibleTargets(s: Pick<ArmState, 'targets' | 'targetIds' | 'threatFilter' | 'sort'>): Target[] {
  const list = s.targetIds.map((id) => s.targets[id]).filter((t) => t && s.threatFilter[t.threat])
  const { key, dir } = s.sort
  const k = dir === 'asc' ? 1 : -1
  return list.sort((a, b) => {
    let d: number
    if (key === 'threat') d = THREAT_ORDER[a.threat] - THREAT_ORDER[b.threat] || b.distance - a.distance
    else if (key === 'id') d = a.id.localeCompare(b.id)
    else d = a[key] - b[key]
    return d * k
  })
}

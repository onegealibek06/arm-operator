import { COMMAND_ACK_TIMEOUT_MS, UI_FLUSH_MS, WS_URL } from '../config'
import { ingestTargets, tracks } from '../map/trackBuffer'
import { useArmStore } from '../store/useArmStore'
import type { CommandAction, CommandMessage, ServerMessage, Target } from '../types'
import { TelemetrySocket } from './TelemetrySocket'

let socket: TelemetrySocket | null = null
let flushTimer: number | undefined
let latest: Target[] | null = null
let lastPacketAt = 0
let packetsInWindow = 0
let windowStart = 0
let packetsPerSec = 0
let requestCounter = 0
let lastSeq = -1
const ackTimers = new Map<string, number>()

const store = () => useArmStore.getState()

const ACTION_LABEL: Record<CommandAction, string> = {
  EW_HANDOFF: 'Передать в РЭБ',
  REQUEST_VIDEO: 'Запросить видео',
  DROP_TARGET: 'Сбросить цель',
}

function onMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'hello':
      lastSeq = -1
      store().setScene({ rangeM: msg.rangeM, zoneM: msg.zoneM })
      break
    case 'telemetry':
      if (msg.seq <= lastSeq) return
      lastSeq = msg.seq
      ingestTargets(msg.targets, performance.now())
      latest = msg.targets
      lastPacketAt = Date.now()
      packetsInWindow += 1
      break
    case 'ack': {
      window.clearTimeout(ackTimers.get(msg.requestId))
      ackTimers.delete(msg.requestId)
      store().resolvePending(msg.requestId, { action: msg.action, ok: msg.ok, message: msg.message, ts: Date.now() })
      store().log(msg.ok ? msg.message : `Отказ: ${msg.message}`, msg.ok ? 'cmd' : 'error')
      if (msg.ok && msg.action === 'DROP_TARGET' && store().selectedId === msg.targetId) store().select(null)
      break
    }
  }
}

function flush(): void {
  const now = performance.now()
  if (now - windowStart >= 1000) {
    packetsPerSec = Math.round((packetsInWindow * 1000) / (now - windowStart))
    packetsInWindow = 0
    windowStart = now
  }
  if (latest) {
    store().applySnapshot(latest, { lastPacketAt, packetsPerSec })
    latest = null
  } else if (store().packetsPerSec !== packetsPerSec) {
    useArmStore.setState({ packetsPerSec })
  }
}

export function startConnection(): () => void {
  socket = new TelemetrySocket(WS_URL, {
    onMessage,
    onLinkChange: (link) => {
      if (link.status !== 'ONLINE') lastSeq = -1
      store().setLink(link)
    },
    onLog: (text, level) => store().log(text, level),
  })
  socket.start()
  windowStart = performance.now()
  flushTimer = window.setInterval(flush, UI_FLUSH_MS)

  return () => {
    socket?.dispose()
    socket = null
    window.clearInterval(flushTimer)
    ackTimers.forEach((t) => window.clearTimeout(t))
    ackTimers.clear()
    tracks.clear()
    latest = null
    lastSeq = -1
  }
}

export function retryNow(): void {
  socket?.retryNow()
}

export function sendCommand(action: CommandAction, targetId: string): boolean {
  const requestId = `${Date.now().toString(36)}-${++requestCounter}`
  const msg: CommandMessage = { type: 'command', requestId, action, targetId, ts: Date.now() }

  if (!socket?.send(msg)) {
    store().log(`Нет связи, команда "${ACTION_LABEL[action]}" (${targetId}) не отправлена`, 'error')
    return false
  }

  store().addPending({ requestId, action, targetId, sentAt: Date.now() })
  store().log(`Команда: ${ACTION_LABEL[action]} (${targetId})`, 'cmd')

  ackTimers.set(
    requestId,
    window.setTimeout(() => {
      ackTimers.delete(requestId)
      store().resolvePending(requestId, {
        action,
        ok: false,
        message: 'Нет подтверждения от сервера',
        ts: Date.now(),
      })
      store().log(`Нет подтверждения за ${COMMAND_ACK_TIMEOUT_MS / 1000} с: ${ACTION_LABEL[action]} (${targetId})`, 'error')
    }, COMMAND_ACK_TIMEOUT_MS),
  )
  return true
}

export { ACTION_LABEL }

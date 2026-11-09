import { COMMAND_ACK_TIMEOUT_MS, UI_FLUSH_MS, WS_URL } from '../config'
import { ingestTargets, tracks } from '../map/trackBuffer'
import { useArmStore } from '../store/useArmStore'
import type { CommandAction, CommandMessage, ServerMessage, Target } from '../types'
import { TelemetrySocket } from './TelemetrySocket'

/**
 * «Мост» между сокетом и интерфейсом.
 *
 * Поток данных:
 *   сокет → (каждый пакет) → trackBuffer → карта рисует каждый кадр
 *         → (только последний пакет) → раз в 250 мс → Zustand → таблица/карточка
 *
 * Сколько бы пакетов в секунду ни пришло, React обновляется не чаще 4 раз в секунду.
 */

let socket: TelemetrySocket | null = null
let flushTimer: number | undefined
let latest: Target[] | null = null
let lastPacketAt = 0
let packetsInWindow = 0
let windowStart = 0
let packetsPerSec = 0
let requestCounter = 0
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
      store().setScene({ rangeM: msg.rangeM, zoneM: msg.zoneM })
      break
    case 'telemetry':
      ingestTargets(msg.targets, performance.now())
      latest = msg.targets // старые непоказанные пакеты просто выбрасываем
      lastPacketAt = Date.now()
      packetsInWindow += 1
      break
    case 'ack': {
      window.clearTimeout(ackTimers.get(msg.requestId))
      ackTimers.delete(msg.requestId)
      store().resolvePending(msg.requestId, { action: msg.action, ok: msg.ok, message: msg.message, ts: Date.now() })
      store().log(`${msg.ok ? '✔' : '✖'} ${msg.message}`, msg.ok ? 'cmd' : 'error')
      // Оператор сам сбросил цель — закрываем карточку, а не показываем «цель потеряна»
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
    // данные не идут — всё равно обновим счётчик, чтобы оператор видел «0 пак/с»
    useArmStore.setState({ packetsPerSec })
  }
}

/** Запуск соединения. Возвращает функцию полной очистки (для useEffect). */
export function startConnection(): () => void {
  socket = new TelemetrySocket(WS_URL, {
    onMessage,
    onLinkChange: (link) => store().setLink(link),
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
  }
}

export function retryNow(): void {
  socket?.retryNow()
}

/** Отправка команды оператора. Ответ (ack) придёт асинхронно и найдётся по requestId. */
export function sendCommand(action: CommandAction, targetId: string): boolean {
  // crypto.randomUUID недоступен по http в локальной сети (не secure context), поэтому свой id
  const requestId = `${Date.now().toString(36)}-${++requestCounter}`
  const msg: CommandMessage = { type: 'command', requestId, action, targetId, ts: Date.now() }

  if (!socket?.send(msg)) {
    store().log(`Нет связи — команда «${ACTION_LABEL[action]}» по ${targetId} не отправлена`, 'error')
    return false
  }

  store().addPending({ requestId, action, targetId, sentAt: Date.now() })
  store().log(`→ ${ACTION_LABEL[action]}: ${targetId}`, 'cmd')

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
      store().log(`✖ «${ACTION_LABEL[action]}» по ${targetId}: нет подтверждения за ${COMMAND_ACK_TIMEOUT_MS / 1000} с`, 'error')
    }, COMMAND_ACK_TIMEOUT_MS),
  )
  return true
}

export { ACTION_LABEL }

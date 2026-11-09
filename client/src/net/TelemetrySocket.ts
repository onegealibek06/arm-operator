import { LINK } from '../config'
import type { LinkState, ServerMessage } from '../types'
import { parseServerMessage } from './protocol'

/** hello + хотя бы один пакет телеметрии */
const ONLINE_AFTER_MESSAGES = 2

interface Handlers {
  onMessage: (msg: ServerMessage) => void
  onLinkChange: (link: LinkState) => void
  onLog: (text: string, level: 'info' | 'warn') => void
}

/**
 * Обёртка над WebSocket без React: держит одно соединение, сама переподключается
 * и следит за «тишиной». Компоненты её не видят — она пишет в стор через handlers.
 *
 * Почему нужен watchdog: если физически выдернуть Ethernet, браузер ещё долго
 * (минуты) не получит событие close — TCP не знает, что кабеля нет. Поэтому мы
 * сами считаем соединение мёртвым, если данные не приходили deadAfterMs.
 */
export class TelemetrySocket {
  private readonly url: string
  private readonly handlers: Handlers
  private ws: WebSocket | null = null
  private attempt = 0
  private lastMessageAt = 0
  private messagesSinceOpen = 0
  private badPackets = 0
  private disposed = false
  private link: LinkState = { status: 'RECONNECTING', attempt: 0, nextRetryAt: null, stale: false, reason: null }

  private retryTimer: number | undefined
  private connectTimer: number | undefined
  private watchdogTimer: number | undefined

  constructor(url: string, handlers: Handlers) {
    this.url = url
    this.handlers = handlers
    window.addEventListener('offline', this.handleBrowserOffline)
    window.addEventListener('online', this.handleBrowserOnline)
  }

  start(): void {
    this.connect()
  }

  /** Отправка JSON. false — если связи нет и сообщение не ушло. */
  send(data: unknown): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(data))
    return true
  }

  /** Кнопка «Подключиться сейчас» — не ждать окончания паузы. */
  retryNow(): void {
    if (this.disposed || this.link.status === 'ONLINE') return
    this.attempt = 0
    this.connect()
  }

  /** Полная очистка: таймеры, слушатели, сокет. Вызывается при размонтировании. */
  dispose(): void {
    this.disposed = true
    window.removeEventListener('offline', this.handleBrowserOffline)
    window.removeEventListener('online', this.handleBrowserOnline)
    this.clearTimers()
    this.dropSocket()
  }

  // ---------------------------------------------------------------------------

  private connect(): void {
    if (this.disposed) return
    this.clearTimers()
    this.dropSocket()
    this.setLink({ status: 'RECONNECTING', attempt: this.attempt, nextRetryAt: null, stale: false })

    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch {
      this.scheduleRetry('неверный адрес сервера')
      return
    }
    this.ws = ws

    this.connectTimer = window.setTimeout(() => {
      this.handlers.onLog('Сервер не отвечает при подключении (тайм-аут)', 'warn')
      this.scheduleRetry('тайм-аут подключения')
    }, LINK.connectTimeoutMs)

    ws.onopen = () => {
      window.clearTimeout(this.connectTimer)
      // Сокет открыт, но это ещё не «связь есть»: ONLINE — только когда пойдут данные.
      // Иначе при живом TCP и молчащем сервере мы бы показывали ложный ONLINE.
      this.messagesSinceOpen = 0
      this.lastMessageAt = performance.now()
      this.setLink({ reason: 'канал открыт, ждём данные' })
      this.watchdogTimer = window.setInterval(this.checkSilence, 250)
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      this.lastMessageAt = performance.now() // канал жив, даже если пакет битый
      const msg = parseServerMessage(event.data)
      if (!msg) {
        this.badPackets += 1
        if (this.badPackets === 1 || this.badPackets % 100 === 0)
          this.handlers.onLog(`Отброшен некорректный пакет (всего ${this.badPackets})`, 'warn')
        return
      }
      this.messagesSinceOpen += 1
      if (this.link.status !== 'ONLINE' && this.messagesSinceOpen >= ONLINE_AFTER_MESSAGES) {
        this.attempt = 0 // счётчик попыток сбрасываем только при реальном потоке данных
        this.setLink({ status: 'ONLINE', attempt: 0, nextRetryAt: null, stale: false, reason: null })
        this.handlers.onLog('Связь с сервером установлена, данные поступают', 'info')
      } else if (this.link.stale) {
        this.setLink({ stale: false })
      }
      this.handlers.onMessage(msg)
    }

    ws.onclose = (event) => {
      if (this.ws !== ws) return // это закрытие старого сокета, уже не наше
      const wasOnline = this.link.status === 'ONLINE'
      if (wasOnline) this.handlers.onLog(`Соединение закрыто (код ${event.code})`, 'warn')
      this.scheduleRetry(wasOnline ? 'соединение закрыто сервером' : 'сервер недоступен')
    }
    // onerror не обрабатываем отдельно: за ним всегда следует onclose
  }

  private checkSilence = (): void => {
    const silence = performance.now() - this.lastMessageAt
    if (silence > LINK.deadAfterMs) {
      if (this.link.status === 'ONLINE')
        this.handlers.onLog(`Нет данных ${(silence / 1000).toFixed(1)} с, связь потеряна`, 'warn')
      this.scheduleRetry('нет данных от сервера')
    } else if (silence > LINK.staleAfterMs && !this.link.stale) {
      this.setLink({ stale: true })
    }
  }

  private scheduleRetry(reason: string): void {
    if (this.disposed) return
    this.clearTimers()
    this.dropSocket()
    // Экспонента + случайный разброс, чтобы десятки АРМ не ломились в сервер одновременно
    const exp = Math.min(LINK.retryMaxMs, LINK.retryBaseMs * 2 ** this.attempt)
    const delay = Math.round(exp * (0.8 + Math.random() * 0.4))
    this.attempt += 1
    this.setLink({ status: 'OFFLINE', attempt: this.attempt, nextRetryAt: Date.now() + delay, stale: false, reason })
    this.retryTimer = window.setTimeout(() => this.connect(), delay)
  }

  private dropSocket(): void {
    const ws = this.ws
    if (!ws) return
    this.ws = null
    // Отвязываем обработчики, чтобы «мёртвый» сокет не дёрнул нас позже
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close()
  }

  private clearTimers(): void {
    window.clearTimeout(this.retryTimer)
    window.clearTimeout(this.connectTimer)
    window.clearInterval(this.watchdogTimer)
  }

  private setLink(patch: Partial<LinkState>): void {
    this.link = { ...this.link, ...patch }
    this.handlers.onLinkChange(this.link)
  }

  private handleBrowserOffline = (): void => {
    this.handlers.onLog('Сетевой интерфейс отключён (кабель / Wi‑Fi)', 'warn')
    this.scheduleRetry('сетевой интерфейс отключён')
  }

  private handleBrowserOnline = (): void => {
    this.handlers.onLog('Сетевой интерфейс снова доступен', 'info')
    this.retryNow()
  }
}

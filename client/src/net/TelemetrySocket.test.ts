// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LINK } from '../config'
import { FakeWebSocket, hello, target, telemetry } from '../test/fakeWebSocket'
import type { LinkState } from '../types'
import { TelemetrySocket } from './TelemetrySocket'

function setup() {
  const links: LinkState[] = []
  const logs: string[] = []
  const messages: unknown[] = []
  const sock = new TelemetrySocket('ws://test/ws', {
    onMessage: (m) => messages.push(m),
    onLinkChange: (l) => links.push(l),
    onLog: (t) => logs.push(t),
  })
  sock.start()
  return { sock, links, logs, messages, link: () => links[links.length - 1] }
}

function goOnline() {
  const ws = FakeWebSocket.last()
  ws.open()
  ws.receive(hello)
  ws.receive(telemetry([target('a')]))
  return ws
}

describe('TelemetrySocket', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('ONLINE не при открытии сокета, а когда реально пошли данные', () => {
    const { sock, link } = setup()
    FakeWebSocket.last().open()
    expect(link().status).toBe('RECONNECTING')
    FakeWebSocket.last().receive(hello)
    FakeWebSocket.last().receive(telemetry([target('a')]))
    expect(link().status).toBe('ONLINE')
    sock.dispose()
  })

  it('тишина: сначала «данные задерживаются», потом связь считается потерянной и идёт переподключение', () => {
    const { sock, link } = setup()
    goOnline()
    vi.advanceTimersByTime(LINK.staleAfterMs + 300)
    expect(link()).toMatchObject({ status: 'ONLINE', stale: true })
    vi.advanceTimersByTime(LINK.deadAfterMs - LINK.staleAfterMs)
    expect(link().status).toBe('OFFLINE')
    expect(link().reason).toBe('нет данных от сервера')
    const before = FakeWebSocket.instances.length
    vi.advanceTimersByTime(LINK.retryMaxMs)
    expect(FakeWebSocket.instances.length).toBeGreaterThan(before) // новая попытка
    sock.dispose()
  })

  it('пауза между попытками растёт и не превышает максимум', () => {
    const { sock, link } = setup()
    const delays: number[] = []
    for (let i = 0; i < 8; i++) {
      FakeWebSocket.last().serverClose()
      delays.push(link().nextRetryAt! - Date.now())
      vi.advanceTimersByTime(link().nextRetryAt! - Date.now())
    }
    expect(delays[1]).toBeGreaterThan(delays[0])
    expect(delays[3]).toBeGreaterThan(delays[1])
    expect(Math.max(...delays)).toBeLessThanOrEqual(LINK.retryMaxMs * 1.2)
    sock.dispose()
  })

  it('после восстановления пауза снова минимальная', () => {
    const { sock, link } = setup()
    for (let i = 0; i < 4; i++) {
      FakeWebSocket.last().serverClose()
      vi.advanceTimersByTime(link().nextRetryAt! - Date.now())
    }
    goOnline()
    FakeWebSocket.last().serverClose()
    expect(link().nextRetryAt! - Date.now()).toBeLessThanOrEqual(LINK.retryBaseMs * 1.2)
    sock.dispose()
  })

  it('тайм-аут подключения: сервер не отвечает — попытка считается неудачной', () => {
    const { sock, link } = setup()
    vi.advanceTimersByTime(LINK.connectTimeoutMs + 10)
    expect(link().status).toBe('OFFLINE')
    expect(link().reason).toBe('тайм-аут подключения')
    sock.dispose()
  })

  it('битые пакеты не роняют клиент и не считаются данными', () => {
    const { sock, link, logs, messages } = setup()
    const ws = FakeWebSocket.last()
    ws.open()
    ws.receive('{not json')
    ws.receive({ type: 'telemetry', seq: 1 })
    expect(link().status).toBe('RECONNECTING')
    expect(messages).toHaveLength(0)
    expect(logs.some((l) => l.includes('некорректный пакет'))).toBe(true)
    sock.dispose()
  })

  it('событие браузера offline (выдернут кабель) сразу переводит в OFFLINE', () => {
    const { sock, link } = setup()
    goOnline()
    window.dispatchEvent(new Event('offline'))
    expect(link().status).toBe('OFFLINE')
    sock.dispose()
  })

  it('dispose: не остаётся ни таймеров, ни слушателей, ни новых попыток', () => {
    const { sock, links } = setup()
    goOnline()
    sock.dispose()
    expect(vi.getTimerCount()).toBe(0)
    const count = links.length
    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(60_000)
    expect(links.length).toBe(count)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})

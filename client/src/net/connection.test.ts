// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMMAND_ACK_TIMEOUT_MS, UI_FLUSH_MS } from '../config'
import { tracks } from '../map/trackBuffer'
import { useArmStore } from '../store/useArmStore'
import { FakeWebSocket, hello, target, telemetry } from '../test/fakeWebSocket'
import { sendCommand, startConnection } from './connection'

const initial = useArmStore.getState()

describe('connection', () => {
  let stop: () => void

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    useArmStore.setState(initial, true)
    stop = startConnection()
  })
  afterEach(() => {
    stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const online = () => {
    const ws = FakeWebSocket.last()
    ws.open()
    ws.receive(hello)
    ws.receive(telemetry([target('T-1')]))
    vi.advanceTimersByTime(UI_FLUSH_MS)
    return ws
  }

  it('100 пакетов за секунду дают не больше ~4 обновлений интерфейса', () => {
    const ws = online()
    let updates = 0
    const unsub = useArmStore.subscribe(() => updates++)
    for (let i = 0; i < 100; i++) {
      ws.receive(telemetry([target('T-1', { x: i })]))
      vi.advanceTimersByTime(10)
    }
    unsub()
    expect(updates).toBeLessThanOrEqual(5)
    expect(useArmStore.getState().targets['T-1'].x).toBe(99) // показан самый свежий
    expect(tracks.get('T-1')!.x).toBe(99) // карта получила каждый пакет
  })

  it('дубль или устаревший пакет (seq меньше) игнорируется', () => {
    const ws = online()
    ws.receive(telemetry([target('T-1', { x: 500 })], 1000))
    ws.receive(telemetry([target('T-1', { x: 1 })], 999))
    vi.advanceTimersByTime(UI_FLUSH_MS)
    expect(useArmStore.getState().targets['T-1'].x).toBe(500)
  })

  it('команда уходит JSON-сообщением, ответ находится по requestId', () => {
    const ws = online()
    expect(sendCommand('EW_HANDOFF', 'T-1')).toBe(true)
    const cmd = ws.sent[0] as { type: string; action: string; targetId: string; requestId: string }
    expect(cmd).toMatchObject({ type: 'command', action: 'EW_HANDOFF', targetId: 'T-1' })
    expect(Object.keys(useArmStore.getState().pending)).toEqual([cmd.requestId])

    ws.receive({ type: 'ack', requestId: cmd.requestId, action: 'EW_HANDOFF', targetId: 'T-1', ok: true, message: 'принято', ts: 0 })
    expect(useArmStore.getState().pending).toEqual({})
    expect(useArmStore.getState().lastResult['T-1']).toMatchObject({ ok: true })
  })

  it('без подтверждения за тайм-аут команда помечается как недоставленная', () => {
    online()
    sendCommand('REQUEST_VIDEO', 'T-1')
    vi.advanceTimersByTime(COMMAND_ACK_TIMEOUT_MS + 10)
    expect(useArmStore.getState().pending).toEqual({})
    expect(useArmStore.getState().lastResult['T-1']).toMatchObject({ ok: false })
  })

  it('без связи команда не отправляется и оператор видит ошибку', () => {
    expect(sendCommand('DROP_TARGET', 'T-1')).toBe(false)
    expect(useArmStore.getState().events[0]).toMatchObject({ level: 'error' })
  })

  it('остановка соединения убирает все таймеры и данные карты', () => {
    online()
    sendCommand('REQUEST_VIDEO', 'T-1') // висит таймер ожидания ack
    stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(tracks.size).toBe(0)
    stop = () => {}
  })
})

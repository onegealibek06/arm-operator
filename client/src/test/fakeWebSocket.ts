// Подменный WebSocket для тестов: позволяет «открыть», «прислать пакет» и «оборвать» соединение вручную.
export class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  url: string
  readyState = FakeWebSocket.CONNECTING
  sent: unknown[] = []
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  static last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  }

  send(data: string) {
    this.sent.push(JSON.parse(data))
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }

  // --- управление из теста ---
  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({})
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) })
  }
  serverClose(code = 1006) {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code })
  }
}

export const hello = { type: 'hello', ts: 0, hz: 10, base: { lat: 0, lon: 0 }, rangeM: 10000, zoneM: 2000 }

export function target(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    type: 'UAV',
    x: 1000,
    y: 2000,
    lat: 51.2,
    lon: 71.4,
    altitude: 300,
    speed: 40,
    azimuth: 26.6,
    course: 180,
    distance: 2236,
    threat: 'MEDIUM',
    status: 'TRACKING',
    ...patch,
  }
}

let seq = 0
export function telemetry(targets: unknown[], s = ++seq) {
  return { type: 'telemetry', seq: s, ts: Date.now(), targets }
}

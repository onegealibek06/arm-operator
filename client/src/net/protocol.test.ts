import { describe, expect, it } from 'vitest'
import { target } from '../test/fakeWebSocket'
import { parseServerMessage } from './protocol'

describe('parseServerMessage', () => {
  it('принимает корректную телеметрию', () => {
    const msg = parseServerMessage(JSON.stringify({ type: 'telemetry', seq: 1, ts: 1, targets: [target('T-1')] }))
    expect(msg?.type).toBe('telemetry')
    expect(msg && msg.type === 'telemetry' && msg.targets).toHaveLength(1)
  })

  it('битый JSON и чужие сообщения отбрасывает', () => {
    expect(parseServerMessage('{oops')).toBeNull()
    expect(parseServerMessage('42')).toBeNull()
    expect(parseServerMessage(JSON.stringify({ type: 'unknown' }))).toBeNull()
    expect(parseServerMessage(JSON.stringify({ type: 'telemetry', seq: 1, ts: 1 }))).toBeNull()
  })

  it('невалидные цели выкидывает поштучно, остальные оставляет', () => {
    const msg = parseServerMessage(
      JSON.stringify({
        type: 'telemetry',
        seq: 1,
        ts: 1,
        targets: [target('ok'), target('bad-threat', { threat: 'CRITICAL' }), target('bad-speed', { speed: 'fast' }), { id: 5 }],
      }),
    )
    expect(msg?.type === 'telemetry' && msg.targets.map((t) => t.id)).toEqual(['ok'])
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_LOG_EVENTS } from '../config'
import { target } from '../test/fakeWebSocket'
import type { Target } from '../types'
import { selectVisibleTargets, useArmStore } from './useArmStore'

const T = (id: string, p: Partial<Target> = {}) => target(id, p) as unknown as Target
const meta = { lastPacketAt: 0, packetsPerSec: 10 }
const initial = useArmStore.getState()

describe('useArmStore', () => {
  beforeEach(() => useArmStore.setState(initial, true))

  it('сохраняет ссылку на неизменившуюся цель (для React.memo) и меняет на изменившуюся', () => {
    const s = useArmStore.getState()
    s.applySnapshot([T('a'), T('b')], meta)
    const before = useArmStore.getState().targets
    s.applySnapshot([T('a'), T('b', { x: 999 })], meta)
    const after = useArmStore.getState().targets
    expect(after.a).toBe(before.a)
    expect(after.b).not.toBe(before.b)
  })

  it('один пакет = одно обновление стора, даже если событий журнала много', () => {
    let updates = 0
    const unsub = useArmStore.subscribe(() => updates++)
    useArmStore.getState().applySnapshot([T('a'), T('b'), T('c'), T('d'), T('e')], meta)
    unsub()
    expect(updates).toBe(1)
    expect(useArmStore.getState().events).toHaveLength(5)
  })

  it('пропавшая выбранная цель попадает в «потерянные», карточка не пустеет', () => {
    const s = useArmStore.getState()
    s.applySnapshot([T('a')], meta)
    s.select('a')
    s.applySnapshot([], meta)
    expect(useArmStore.getState().lostTargets.a.target.id).toBe('a')
  })

  it('результаты команд по ушедшим целям удаляются (нет роста памяти за смену)', () => {
    const s = useArmStore.getState()
    s.applySnapshot([T('a'), T('b')], meta)
    s.addPending({ requestId: 'r1', action: 'REQUEST_VIDEO', targetId: 'a', sentAt: 0 })
    s.resolvePending('r1', { action: 'REQUEST_VIDEO', ok: true, message: 'ok', ts: 0 })
    expect(useArmStore.getState().lastResult.a).toBeDefined()
    s.applySnapshot([T('b')], meta)
    expect(useArmStore.getState().lastResult.a).toBeUndefined()
  })

  it('журнал ограничен по размеру', () => {
    const s = useArmStore.getState()
    for (let i = 0; i < MAX_LOG_EVENTS + 50; i++) s.log(`e${i}`)
    const events = useArmStore.getState().events
    expect(events).toHaveLength(MAX_LOG_EVENTS)
    expect(events[0].text).toBe(`e${MAX_LOG_EVENTS + 49}`)
  })

  it('сортировка по угрозе: высокая сверху, при равной — ближняя выше; фильтр скрывает уровень', () => {
    const s = useArmStore.getState()
    s.applySnapshot(
      [T('far-low', { threat: 'LOW', distance: 9000 }), T('mid', { threat: 'MEDIUM', distance: 5000 }), T('high-far', { threat: 'HIGH', distance: 4000 }), T('high-near', { threat: 'HIGH', distance: 1000 })],
      meta,
    )
    expect(selectVisibleTargets(useArmStore.getState()).map((t) => t.id)).toEqual(['high-near', 'high-far', 'mid', 'far-low'])
    s.toggleThreat('HIGH')
    expect(selectVisibleTargets(useArmStore.getState()).map((t) => t.id)).toEqual(['mid', 'far-low'])
  })

  it('повторный клик по колонке меняет направление сортировки', () => {
    const s = useArmStore.getState()
    s.setSort('speed')
    expect(useArmStore.getState().sort).toEqual({ key: 'speed', dir: 'asc' })
    s.setSort('speed')
    expect(useArmStore.getState().sort).toEqual({ key: 'speed', dir: 'desc' })
  })
})

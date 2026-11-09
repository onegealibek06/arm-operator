import { beforeEach, describe, expect, it } from 'vitest'
import { target } from '../test/fakeWebSocket'
import type { Target } from '../types'
import { advanceTracks, ingestTargets, isTrackStale, tracks } from './trackBuffer'

const T = (id: string, p: Partial<Target> = {}) => target(id, p) as unknown as Target

describe('trackBuffer', () => {
  beforeEach(() => tracks.clear())

  it('удаляет треки целей, которых нет в новом пакете (нет утечки)', () => {
    ingestTargets([T('a'), T('b')], 0)
    ingestTargets([T('b')], 100)
    expect([...tracks.keys()]).toEqual(['b'])
  })

  it('между пакетами двигает цель по вектору скорости, без скачка', () => {
    ingestTargets([T('a', { x: 0, y: 0, course: 90, speed: 100 })], 0)
    let prevX = 0
    for (let t = 16; t <= 1000; t += 16) {
      advanceTracks(t, 16)
      const x = tracks.get('a')!.dx
      expect(x).toBeGreaterThanOrEqual(prevX)
      expect(x - prevX).toBeLessThan(10)
      prevX = x
    }
    expect(prevX).toBeGreaterThan(80)
  })

  it('новый пакет с поправкой не даёт рывка', () => {
    ingestTargets([T('a', { x: 0, y: 0, course: 90, speed: 0 })], 0)
    advanceTracks(16, 16)
    ingestTargets([T('a', { x: 300, y: 0, course: 90, speed: 0 })], 100)
    advanceTracks(116, 16)
    const step = tracks.get('a')!.dx
    expect(step).toBeGreaterThan(0)
    expect(step).toBeLessThan(300 * 0.2)
  })

  it('не «додумывает» движение дольше 2 секунд без данных', () => {
    ingestTargets([T('a', { x: 0, y: 0, course: 90, speed: 100 })], 0)
    for (let t = 16; t <= 10_000; t += 16) advanceTracks(t, 16)
    expect(tracks.get('a')!.dx).toBeLessThanOrEqual(200 + 1)
    expect(isTrackStale(tracks.get('a')!, 10_000)).toBe(true)
  })

  it('след ограничен по длине', () => {
    for (let i = 0; i < 500; i++) ingestTargets([T('a', { x: i })], i * 1001)
    expect(tracks.get('a')!.trail.length).toBeLessThanOrEqual(60)
  })
})

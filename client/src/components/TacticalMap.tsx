import { useEffect, useRef } from 'react'
import { useNow } from '../hooks/useNow'
import { advanceTracks, isTrackStale, tracks, type Track } from '../map/trackBuffer'
import { retryNow } from '../net/connection'
import { useArmStore } from '../store/useArmStore'
import type { ThreatLevel } from '../types'
import { IconAlert, ThreatShape } from './icons'

const COLORS: Record<ThreatLevel, string> = { HIGH: '#ff4d4f', MEDIUM: '#f5a524', LOW: '#3ccf91' }
const ACCENT = '#3d9cf5'
const FONT = '"Inter Variable", -apple-system, "Segoe UI", Roboto, sans-serif'
const HIT_RADIUS_PX = 18
const VECTOR_SECONDS = 60 // вектор движения: где цель будет через минуту
const SWEEP_PERIOD_MS = 4000

interface View {
  cx: number
  cy: number
  scale: number // пикселей на метр
  w: number
}

// Canvas рендерится React один раз, дальше всё рисует цикл requestAnimationFrame
// по данным из trackBuffer — без ререндеров компонентов.
export function TacticalMap() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rangeKm = useArmStore((s) => s.scene.rangeM / 1000)

  useEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let width = 0
    let height = 0
    let view: View = { cx: 0, cy: 0, scale: 1, w: 0 }
    let hoverId: string | null = null

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      width = wrap.clientWidth
      height = wrap.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()

    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      advanceTracks(now, now - last)
      last = now
      view = draw(ctx, width, height, now, hoverId)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    const pick = (e: MouseEvent): string | null => {
      const r = canvas.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      let best: string | null = null
      let bestD = HIT_RADIUS_PX
      for (const tr of tracks.values()) {
        const d = Math.hypot(view.cx + tr.dx * view.scale - mx, view.cy - tr.dy * view.scale - my)
        if (d < bestD) {
          bestD = d
          best = tr.target.id
        }
      }
      return best
    }
    const onClick = (e: MouseEvent) => {
      const id = pick(e)
      if (id) useArmStore.getState().select(id)
    }
    const onMove = (e: MouseEvent) => {
      hoverId = pick(e)
      canvas.style.cursor = hoverId ? 'pointer' : 'default'
    }
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('mousemove', onMove)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('mousemove', onMove)
    }
  }, [])

  return (
    <section className="panel map-panel" aria-label="Карта">
      <div className="panel-head">
        <h2>Воздушная обстановка</h2>
        <span className="count">радиус {rangeKm} км</span>
      </div>
      <div className="map-body" ref={wrapRef}>
        <canvas ref={canvasRef} aria-label="Схема воздушной обстановки, цель выбирается кликом" />
        <Legend />
        <LinkOverlay />
      </div>
    </section>
  )
}

function Legend() {
  return (
    <div className="legend hide-sm">
      <span>
        <ThreatShape level="HIGH" /> высокая угроза
      </span>
      <span>
        <ThreatShape level="MEDIUM" /> средняя
      </span>
      <span>
        <ThreatShape level="LOW" /> низкая
      </span>
      <span>
        <svg viewBox="0 0 12 12" aria-hidden>
          <circle cx="6" cy="6" r="4.5" fill="none" stroke={ACCENT} strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
        передана в РЭБ
      </span>
    </div>
  )
}

// предупреждение поверх карты: данные задерживаются или связи нет
function LinkOverlay() {
  const link = useArmStore((s) => s.link)
  const lastPacketAt = useArmStore((s) => s.lastPacketAt)
  const now = useNow(250)

  if (link.status === 'ONLINE' && !link.stale) return null

  if (link.status === 'ONLINE') {
    const silence = lastPacketAt ? ((now - lastPacketAt) / 1000).toFixed(1) : '?'
    return (
      <div className="overlay overlay--warn" role="alert">
        <IconAlert />
        <div className="overlay-text num">
          <b>Данные задерживаются</b>
          <span>Нет пакетов {silence} с</span>
        </div>
      </div>
    )
  }

  const left = link.nextRetryAt ? Math.max(0, Math.ceil((link.nextRetryAt - now) / 1000)) : null
  return (
    <div className="overlay" role="alert">
      <IconAlert />
      <div className="overlay-text num">
        <b>Нет связи с сервером</b>
        <span>
          Положение целей устарело.{' '}
          {link.status === 'RECONNECTING' ? 'Переподключение...' : left !== null ? `Повтор через ${left} с` : ''}
        </span>
      </div>
      {link.status === 'OFFLINE' && (
        <button className="btn btn--sm" onClick={retryNow}>
          Переподключить
        </button>
      )}
    </div>
  )
}

// --- рисование ---

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, hoverId: string | null): View {
  const { scene, selectedId } = useArmStore.getState()
  const cx = w / 2
  const cy = h / 2
  const radius = Math.max(40, Math.min(w, h) / 2 - 26)
  const scale = radius / scene.rangeM
  const view = { cx, cy, scale, w }

  ctx.clearRect(0, 0, w, h)
  drawSweep(ctx, cx, cy, radius, now)
  drawGrid(ctx, cx, cy, radius, scale, scene.rangeM, scene.zoneM)

  // выбранная цель рисуется последней, поверх остальных
  const order: Record<ThreatLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }
  const list = [...tracks.values()].sort(
    (a, b) =>
      Number(a.target.id === selectedId) - Number(b.target.id === selectedId) || order[a.target.threat] - order[b.target.threat],
  )
  for (const tr of list) drawTrack(ctx, tr, view, now, tr.target.id === selectedId, tr.target.id === hoverId)

  return view
}

function drawSweep(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, now: number) {
  if (!('createConicGradient' in ctx)) return
  const angle = ((now % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS) * Math.PI * 2 - Math.PI / 2
  const g = ctx.createConicGradient(angle - Math.PI / 4, cx, cy)
  g.addColorStop(0, 'rgba(61, 156, 245, 0)')
  g.addColorStop(0.125, 'rgba(61, 156, 245, 0.12)')
  g.addColorStop(0.1251, 'rgba(61, 156, 245, 0)')
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()
  ctx.restore()
}

function drawGrid(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, scale: number, rangeM: number, zoneM: number) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 1

  // кольца дальности через 2 км
  for (let m = 2000; m <= rangeM; m += 2000) {
    const r = m * scale
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = m === rangeM ? '#2f3641' : '#1b2028'
    ctx.stroke()
    ctx.font = `11px ${FONT}`
    ctx.fillStyle = '#566070'
    ctx.fillText(m === rangeM ? `${m / 1000} км` : String(m / 1000), cx + r * Math.SQRT1_2 + 10, cy - r * Math.SQRT1_2 - 6)
  }

  // перекрестие
  ctx.setLineDash([2, 6])
  ctx.strokeStyle = '#232a33'
  ctx.beginPath()
  ctx.moveTo(cx - radius, cy)
  ctx.lineTo(cx + radius, cy)
  ctx.moveTo(cx, cy - radius)
  ctx.lineTo(cx, cy + radius)
  ctx.stroke()
  ctx.setLineDash([])

  // риски азимута каждые 10°, подписи каждые 30°
  for (let a = 0; a < 360; a += 10) {
    const rad = (a * Math.PI) / 180
    const sin = Math.sin(rad)
    const cos = Math.cos(rad)
    const len = a % 30 === 0 ? 7 : 4
    ctx.beginPath()
    ctx.moveTo(cx + sin * radius, cy - cos * radius)
    ctx.lineTo(cx + sin * (radius - len), cy - cos * (radius - len))
    ctx.strokeStyle = '#3a424e'
    ctx.stroke()
    if (a % 30 === 0) {
      const cardinal = a === 0 ? 'С' : a === 90 ? 'В' : a === 180 ? 'Ю' : a === 270 ? 'З' : null
      ctx.font = cardinal ? `600 12px ${FONT}` : `11px ${FONT}`
      ctx.fillStyle = cardinal ? '#c3cad4' : '#566070'
      ctx.fillText(cardinal ?? String(a), cx + sin * (radius + 14), cy - cos * (radius + 14))
    }
  }

  // охраняемая зона
  const zr = zoneM * scale
  ctx.beginPath()
  ctx.arc(cx, cy, zr, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 77, 79, 0.06)'
  ctx.fill()
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = 'rgba(255, 77, 79, 0.55)'
  ctx.stroke()
  ctx.setLineDash([])
  ctx.font = `500 11px ${FONT}`
  ctx.fillStyle = 'rgba(255, 120, 122, 0.85)'
  ctx.fillText('охраняемая зона', cx, cy - zr - 9)

  // КП
  ctx.beginPath()
  ctx.arc(cx, cy, 9, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(61, 156, 245, 0.15)'
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx, cy - 5)
  ctx.lineTo(cx + 4.5, cy + 3.5)
  ctx.lineTo(cx - 4.5, cy + 3.5)
  ctx.closePath()
  ctx.fillStyle = ACCENT
  ctx.fill()
  ctx.font = `600 11px ${FONT}`
  ctx.fillStyle = '#9fc9f5'
  ctx.fillText('КП', cx, cy + 18)
  ctx.restore()
}

function drawMarker(ctx: CanvasRenderingContext2D, level: ThreatLevel, x: number, y: number) {
  const c = COLORS[level]
  ctx.beginPath()
  if (level === 'LOW') {
    ctx.arc(x, y, 5.5, 0, Math.PI * 2)
  } else {
    const s = level === 'HIGH' ? 8 : 7
    ctx.moveTo(x, y - s)
    ctx.lineTo(x + s, y)
    ctx.lineTo(x, y + s)
    ctx.lineTo(x - s, y)
    ctx.closePath()
  }
  if (level === 'HIGH') {
    ctx.shadowColor = c
    ctx.shadowBlur = 14
    ctx.fillStyle = c
    ctx.fill()
    ctx.shadowBlur = 0
  } else {
    ctx.fillStyle = '#101318'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = c
    ctx.stroke()
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawTrack(ctx: CanvasRenderingContext2D, tr: Track, v: View, now: number, selected: boolean, hover: boolean) {
  const t = tr.target
  const color = COLORS[t.threat]
  const sx = v.cx + tr.dx * v.scale
  const sy = v.cy - tr.dy * v.scale
  const stale = isTrackStale(tr, now)
  const alpha = stale ? 0.35 : 1

  ctx.save()

  // след: точки, которые бледнеют к началу
  const n = tr.trail.length
  tr.trail.forEach((p, i) => {
    ctx.globalAlpha = alpha * (0.1 + (0.5 * i) / Math.max(1, n))
    ctx.beginPath()
    ctx.arc(v.cx + p.x * v.scale, v.cy - p.y * v.scale, 1.6, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  })

  // вектор движения
  ctx.globalAlpha = alpha * 0.75
  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.lineTo(sx + tr.vx * VECTOR_SECONDS * v.scale, sy - tr.vy * VECTOR_SECONDS * v.scale)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.globalAlpha = alpha

  // выбранная цель: пульсирующее кольцо
  if (selected) {
    const p = (now % 1500) / 1500
    ctx.beginPath()
    ctx.arc(sx, sy, 12 + p * 14, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(61, 156, 245, ${0.6 * (1 - p)})`
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(sx, sy, 13, 0, Math.PI * 2)
    ctx.strokeStyle = ACCENT
    ctx.stroke()
  } else if (hover) {
    ctx.beginPath()
    ctx.arc(sx, sy, 13, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(160, 169, 182, 0.7)'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  if (t.status === 'EW_ASSIGNED') {
    ctx.beginPath()
    ctx.setLineDash([3, 3])
    ctx.arc(sx, sy, selected ? 17 : 13, 0, Math.PI * 2)
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.setLineDash([])
  }

  drawMarker(ctx, t.threat, sx, sy)

  // подпись-плашка
  const line1 = t.id
  const line2 = `${(t.distance / 1000).toFixed(1)} км  ${t.altitude} м`
  ctx.font = `600 12px ${FONT}`
  const w1 = ctx.measureText(line1).width
  ctx.font = `11px ${FONT}`
  const w2 = ctx.measureText(line2).width
  const bw = Math.max(w1, w2) + 14
  const bh = 34
  // у правого края подпись уходит влево от маркера, чтобы не обрезалась
  const bx = sx + 16 + bw > v.w - 4 ? sx - 16 - bw : sx + 16
  const by = Math.max(4, sy - bh - 6)
  roundRect(ctx, bx, by, bw, bh, 5)
  ctx.fillStyle = selected ? 'rgba(20, 40, 64, 0.92)' : 'rgba(16, 19, 24, 0.86)'
  ctx.fill()
  ctx.strokeStyle = selected ? ACCENT : 'rgba(47, 54, 65, 0.9)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = color
  ctx.fillRect(bx, by + 5, 2, bh - 10)

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = `600 12px ${FONT}`
  ctx.fillStyle = '#e7eaef'
  ctx.fillText(line1, bx + 8, by + 11)
  ctx.font = `11px ${FONT}`
  ctx.fillStyle = '#a0a9b6'
  ctx.fillText(line2, bx + 8, by + 24)

  ctx.restore()
}

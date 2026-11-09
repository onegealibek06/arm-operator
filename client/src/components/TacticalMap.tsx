import { useEffect, useRef } from 'react'
import { useNow } from '../hooks/useNow'
import { advanceTracks, isTrackStale, tracks, type Track } from '../map/trackBuffer'
import { retryNow } from '../net/connection'
import { useArmStore } from '../store/useArmStore'
import type { ThreatLevel } from '../types'

const COLORS: Record<ThreatLevel, string> = { HIGH: '#ff4d4f', MEDIUM: '#ffb020', LOW: '#9fb3c8' }
const ACCENT = '#4cc2ff'
const HIT_RADIUS_PX = 16
const VECTOR_SECONDS = 60 // вектор движения: где цель будет через минуту

interface View {
  cx: number
  cy: number
  scale: number // пикселей на метр
}

/**
 * 2D-схема на Canvas. Компонент рендерится React один раз, дальше рисование идёт
 * в цикле requestAnimationFrame и читает данные напрямую из trackBuffer/стора —
 * без ререндеров. Для 5 целей подошёл бы и SVG, но Canvas выдержит и сотни.
 */
export function TacticalMap() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let width = 0
    let height = 0
    let view: View = { cx: 0, cy: 0, scale: 1 }
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

    // Очистка: без неё после размонтирования остались бы цикл rAF и наблюдатель
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('mousemove', onMove)
    }
  }, [])

  return (
    <section className="panel map-panel" aria-label="Карта">
      <div className="panel-title">
        Карта · круговой обзор
        <span className="spacer" />
        <Legend />
      </div>
      <div className="map-body" ref={wrapRef}>
        <canvas ref={canvasRef} aria-label="Схема воздушной обстановки; выберите цель кликом или в таблице" />
        <LinkOverlay />
      </div>
    </section>
  )
}

function Legend() {
  return (
    <span style={{ display: 'flex', gap: 10, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
      {(['HIGH', 'MEDIUM', 'LOW'] as const).map((l) => (
        <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <i style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[l] }} />
          {l === 'HIGH' ? 'высокая' : l === 'MEDIUM' ? 'средняя' : 'низкая'}
        </span>
      ))}
    </span>
  )
}

/** Предупреждение поверх карты: данные задерживаются или связи нет. */
function LinkOverlay() {
  const link = useArmStore((s) => s.link)
  const lastPacketAt = useArmStore((s) => s.lastPacketAt)
  const now = useNow(250)

  if (link.status === 'ONLINE' && !link.stale) return null

  if (link.status === 'ONLINE') {
    const silence = lastPacketAt ? ((now - lastPacketAt) / 1000).toFixed(1) : '?'
    return (
      <div className="overlay overlay--warn" role="alert">
        <b>ДАННЫЕ ЗАДЕРЖИВАЮТСЯ</b> нет пакетов {silence} с
      </div>
    )
  }

  const left = link.nextRetryAt ? Math.max(0, Math.ceil((link.nextRetryAt - now) / 1000)) : null
  return (
    <div className="overlay" role="alert">
      <b>НЕТ СВЯЗИ</b>
      <span>
        Положение целей устарело.{' '}
        {link.status === 'RECONNECTING' ? 'Переподключение…' : left !== null ? `Повтор через ${left} с` : ''}
      </span>
      {link.status === 'OFFLINE' && (
        <button className="btn btn--danger" onClick={retryNow}>
          Подключиться сейчас
        </button>
      )}
    </div>
  )
}

// --- Рисование -------------------------------------------------------------

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, hoverId: string | null): View {
  const { scene, selectedId } = useArmStore.getState()
  const cx = w / 2
  const cy = h / 2
  const radius = Math.max(40, Math.min(w, h) / 2 - 22)
  const scale = radius / scene.rangeM
  const view = { cx, cy, scale }

  ctx.clearRect(0, 0, w, h)
  drawGrid(ctx, cx, cy, radius, scale, scene.rangeM, scene.zoneM)

  // Сначала низкие угрозы, сверху — высокие, выбранная цель — самой последней
  const order: Record<ThreatLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }
  const list = [...tracks.values()].sort(
    (a, b) =>
      Number(a.target.id === selectedId) - Number(b.target.id === selectedId) || order[a.target.threat] - order[b.target.threat],
  )
  for (const tr of list) drawTrack(ctx, tr, view, now, tr.target.id === selectedId, tr.target.id === hoverId)

  return view
}

function drawGrid(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, scale: number, rangeM: number, zoneM: number) {
  ctx.save()
  ctx.font = '11px ui-monospace, Menlo, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Кольца дальности через 2 км
  ctx.strokeStyle = '#1d2a38'
  ctx.fillStyle = '#5d7389'
  ctx.lineWidth = 1
  for (let m = 2000; m <= rangeM; m += 2000) {
    ctx.beginPath()
    ctx.arc(cx, cy, m * scale, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillText(`${m / 1000} км`, cx + 4 + m * scale * Math.cos(-Math.PI / 4) + 12, cy + m * scale * Math.sin(-Math.PI / 4))
  }

  // Лучи азимута через 30°
  for (let a = 0; a < 360; a += 30) {
    const rad = (a * Math.PI) / 180
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.sin(rad) * radius, cy - Math.cos(rad) * radius)
    ctx.stroke()
    const label = a === 0 ? 'С' : a === 90 ? 'В' : a === 180 ? 'Ю' : a === 270 ? 'З' : String(a)
    ctx.fillStyle = a % 90 === 0 ? '#9fb3c8' : '#5d7389'
    ctx.fillText(label, cx + Math.sin(rad) * (radius + 11), cy - Math.cos(rad) * (radius + 11))
  }

  // Охраняемая зона
  ctx.beginPath()
  ctx.arc(cx, cy, zoneM * scale, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 77, 79, 0.07)'
  ctx.fill()
  ctx.setLineDash([6, 4])
  ctx.strokeStyle = 'rgba(255, 77, 79, 0.7)'
  ctx.stroke()
  ctx.setLineDash([])

  // КП в центре
  ctx.fillStyle = ACCENT
  ctx.fillRect(cx - 4, cy - 4, 8, 8)
  ctx.fillStyle = '#9fb3c8'
  ctx.fillText('КП', cx, cy + 14)
  ctx.restore()
}

function drawTrack(ctx: CanvasRenderingContext2D, tr: Track, v: View, now: number, selected: boolean, hover: boolean) {
  const t = tr.target
  const color = COLORS[t.threat]
  const sx = v.cx + tr.dx * v.scale
  const sy = v.cy - tr.dy * v.scale
  const stale = isTrackStale(tr, now)

  ctx.save()
  ctx.globalAlpha = stale ? 0.35 : 1

  // След
  if (tr.trail.length > 1) {
    ctx.beginPath()
    tr.trail.forEach((p, i) => {
      const px = v.cx + p.x * v.scale
      const py = v.cy - p.y * v.scale
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.lineTo(sx, sy)
    ctx.strokeStyle = color
    ctx.globalAlpha *= 0.3
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.globalAlpha = stale ? 0.35 : 1
  }

  // Вектор движения
  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.lineTo(sx + tr.vx * VECTOR_SECONDS * v.scale, sy - tr.vy * VECTOR_SECONDS * v.scale)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Маркер
  ctx.beginPath()
  ctx.arc(sx, sy, t.threat === 'HIGH' ? 7 : 6, 0, Math.PI * 2)
  if (t.threat === 'LOW') {
    ctx.lineWidth = 2
    ctx.strokeStyle = color
    ctx.fillStyle = '#10161e'
    ctx.fill()
    ctx.stroke()
  } else {
    ctx.fillStyle = color
    ctx.fill()
  }

  // Передана в РЭБ — пунктирное кольцо
  if (t.status === 'EW_ASSIGNED') {
    ctx.beginPath()
    ctx.setLineDash([3, 3])
    ctx.arc(sx, sy, 12, 0, Math.PI * 2)
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Выбранная цель — рамка-прицел
  if (selected || hover) {
    const s = 15
    const c = 6
    ctx.strokeStyle = selected ? ACCENT : '#9fb3c8'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      ctx.moveTo(sx + dx * s, sy + dy * (s - c))
      ctx.lineTo(sx + dx * s, sy + dy * s)
      ctx.lineTo(sx + dx * (s - c), sy + dy * s)
    }
    ctx.stroke()
  }

  // Подпись
  ctx.font = `${selected ? 'bold ' : ''}12px ui-monospace, Menlo, monospace`
  ctx.textBaseline = 'middle'
  ctx.fillStyle = selected ? '#ffffff' : '#dbe5ef'
  ctx.fillText(t.id, sx + 18, sy - 6)
  ctx.font = '10px ui-monospace, Menlo, monospace'
  ctx.fillStyle = '#8296ab'
  ctx.fillText(`${(t.distance / 1000).toFixed(1)}км ${t.altitude}м`, sx + 18, sy + 7)

  ctx.restore()
}

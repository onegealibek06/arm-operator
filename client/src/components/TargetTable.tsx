import { memo, useEffect, useRef, type CSSProperties } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { deg, km, THREAT_LABEL, TYPE_LABEL } from '../labels'
import { selectVisibleTargets, useArmStore, type SortKey } from '../store/useArmStore'
import type { Target, ThreatLevel } from '../types'
import { IconSort } from './icons'

const COLUMNS: { key: SortKey | null; label: string; right?: boolean; className?: string }[] = [
  { key: 'id', label: 'Цель' },
  { key: 'threat', label: 'Угроза' },
  { key: null, label: 'Координаты' },
  { key: 'distance', label: 'Азимут, дальн.', right: true },
  { key: 'speed', label: 'Скорость', right: true },
]

const LEVELS: ThreatLevel[] = ['HIGH', 'MEDIUM', 'LOW']
const LEVEL_COLOR: Record<ThreatLevel, string> = { HIGH: 'var(--high)', MEDIUM: 'var(--med)', LOW: 'var(--low)' }

export function TargetTable() {
  const rows = useArmStore(useShallow(selectVisibleTargets))
  const total = useArmStore((s) => s.targetIds.length)
  const selectedId = useArmStore((s) => s.selectedId)
  const sort = useArmStore((s) => s.sort)
  const filter = useArmStore((s) => s.threatFilter)
  const offline = useArmStore((s) => s.link.status !== 'ONLINE' || s.link.stale)
  const { select, setSort, toggleThreat } = useArmStore.getState()

  return (
    <section className="panel table-panel" aria-label="Цели">
      <div className="panel-head">
        <h2>Цели</h2>
        <span className="count num">{rows.length === total ? total : `${rows.length} из ${total}`}</span>
        <span className="spacer" />
        <div className="segments" role="group" aria-label="Фильтр по угрозе">
          {LEVELS.map((l) => (
            <button
              key={l}
              aria-pressed={filter[l]}
              onClick={() => toggleThreat(l)}
              style={{ '--c': LEVEL_COLOR[l] } as CSSProperties}
            >
              <i />
              {THREAT_LABEL[l]}
            </button>
          ))}
        </div>
      </div>

      <div className={`table-wrap${offline ? ' is-stale' : ''}`}>
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const dir = c.key && sort.key === c.key ? sort.dir : null
                return (
                  <th
                    key={c.label}
                    className={[c.right && 'r', c.className].filter(Boolean).join(' ')}
                    aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {c.key ? (
                      <button onClick={() => setSort(c.key!)}>
                        {c.label}
                        <IconSort dir={dir} />
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <Row key={t.id} t={t} selected={t.id === selectedId} onSelect={select} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">{total === 0 ? 'Целей в зоне обзора нет' : 'Все цели скрыты фильтром'}</div>}
      </div>
    </section>
  )
}

// memo + стабильные ссылки в сторе: неизменившиеся строки не перерисовываются
const Row = memo(function Row({ t, selected, onSelect }: { t: Target; selected: boolean; onSelect: (id: string) => void }) {
  const ref = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <tr
      ref={ref}
      className={`row--${t.threat}${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(t.id)}
      aria-selected={selected}
    >
      <td className="id num">
        {t.id}
        <span className="sub">
          {TYPE_LABEL[t.type]}
          {t.status === 'EW_ASSIGNED' && ', РЭБ'}
          {t.status === 'VIDEO_REQUESTED' && ', видео'}
        </span>
      </td>
      <td>
        <span className={`chip chip--${t.threat}`}>{THREAT_LABEL[t.threat]}</span>
      </td>
      <td className="num">
        {t.lat.toFixed(4)}
        <span className="sub">{t.lon.toFixed(4)}</span>
      </td>
      <td className="num r" title="Азимут и дальность от КП">
        {deg(t.azimuth)}
        <span className="sub">{km(t.distance)} км</span>
      </td>
      <td className="num r">
        {t.speed.toFixed(0)}
        <span className="sub">м/с</span>
      </td>
    </tr>
  )
})

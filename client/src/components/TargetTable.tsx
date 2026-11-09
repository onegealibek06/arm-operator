import { memo, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { deg, km, THREAT_LABEL, TYPE_LABEL } from '../labels'
import { selectVisibleTargets, useArmStore, type SortKey } from '../store/useArmStore'
import type { Target, ThreatLevel } from '../types'

const COLUMNS: { key: SortKey | null; label: string; right?: boolean; className?: string }[] = [
  { key: 'threat', label: 'Угроза' },
  { key: 'id', label: 'ID' },
  { key: null, label: 'Тип' },
  { key: null, label: 'Координаты', className: 'col-coords' },
  { key: 'distance', label: 'Дальн., км', right: true },
  { key: 'azimuth', label: 'Азимут', right: true },
  { key: 'speed', label: 'Скор., м/с', right: true },
]

const LEVELS: ThreatLevel[] = ['HIGH', 'MEDIUM', 'LOW']

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
      <div className="panel-title">
        Цели <span className="num">{rows.length}/{total}</span>
        <span className="spacer" />
        <div className="chips" role="group" aria-label="Фильтр по угрозе">
          {LEVELS.map((l) => (
            <button key={l} className={`chip chip--${l}`} aria-pressed={filter[l]} onClick={() => toggleThreat(l)}>
              {THREAT_LABEL[l]}
            </button>
          ))}
        </div>
      </div>

      <div className={`table-wrap${offline ? ' is-stale' : ''}`}>
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.label}
                  className={[c.right && 'r', c.className].filter(Boolean).join(' ')}
                  aria-sort={c.key && sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.key ? (
                    <button onClick={() => setSort(c.key!)}>
                      {c.label}
                      {sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <Row key={t.id} t={t} selected={t.id === selectedId} onSelect={select} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">{total === 0 ? 'Нет целей в зоне обзора' : 'Все цели скрыты фильтром'}</div>}
      </div>
    </section>
  )
}

/**
 * Строка мемоизирована: стор переиспользует объект цели, если данные не изменились,
 * поэтому React пропускает перерисовку неизменных строк.
 */
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
      <td>
        <span className={`threat threat--${t.threat}`}>{THREAT_LABEL[t.threat]}</span>
      </td>
      <td className="num">
        <b>{t.id}</b>
        {t.status === 'EW_ASSIGNED' && <span className="tag">РЭБ</span>}
        {t.status === 'VIDEO_REQUESTED' && <span className="tag">ВИДЕО</span>}
      </td>
      <td>{TYPE_LABEL[t.type]}</td>
      <td className="num col-coords">
        {t.lat.toFixed(4)}, {t.lon.toFixed(4)}
      </td>
      <td className="num r">{km(t.distance)}</td>
      <td className="num r">{deg(t.azimuth)}</td>
      <td className="num r">{t.speed.toFixed(0)}</td>
    </tr>
  )
})

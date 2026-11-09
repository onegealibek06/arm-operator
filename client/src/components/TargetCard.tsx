import { useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { clock, deg, km, STATUS_LABEL, THREAT_LABEL, TYPE_LABEL } from '../labels'
import { ACTION_LABEL, sendCommand } from '../net/connection'
import { useArmStore } from '../store/useArmStore'
import type { CommandAction } from '../types'
import { IconClose, IconDrop, IconJam, IconVideo } from './icons'

const NEEDS_CONFIRM: Record<CommandAction, boolean> = {
  EW_HANDOFF: true,
  REQUEST_VIDEO: false,
  DROP_TARGET: true,
}

export function TargetCard() {
  const selectedId = useArmStore((s) => s.selectedId)
  const target = useArmStore((s) => (s.selectedId ? s.targets[s.selectedId] : undefined))
  const lost = useArmStore((s) => (s.selectedId ? s.lostTargets[s.selectedId] : undefined))
  const online = useArmStore((s) => s.link.status === 'ONLINE')
  const pendingActions = useArmStore(
    useShallow((s) =>
      Object.values(s.pending)
        .filter((p) => p.targetId === s.selectedId)
        .map((p) => p.action),
    ),
  )
  const result = useArmStore((s) => (s.selectedId ? s.lastResult[s.selectedId] : undefined))

  const [confirm, setConfirm] = useState<{ action: CommandAction; targetId: string } | null>(null)
  const confirming = confirm && confirm.targetId === selectedId ? confirm.action : null
  const setConfirming = (action: CommandAction | null) =>
    setConfirm(action && selectedId ? { action, targetId: selectedId } : null)

  if (!selectedId) {
    return (
      <section className="panel card-panel" aria-label="Выбранная цель">
        <div className="panel-head">
          <h2>Выбранная цель</h2>
        </div>
        <div className="empty">Выберите цель в списке или на карте. Стрелки вверх и вниз переключают цели.</div>
      </section>
    )
  }

  const shown = target ?? lost?.target
  if (!shown) return null

  const run = (action: CommandAction) => {
    if (NEEDS_CONFIRM[action] && confirming !== action) {
      setConfirming(action)
      return
    }
    setConfirming(null)
    sendCommand(action, shown.id)
  }

  const disabled = (a: CommandAction) =>
    !online || !target || pendingActions.includes(a) || (a === 'EW_HANDOFF' && target.status === 'EW_ASSIGNED')

  const label = (a: CommandAction) => (pendingActions.includes(a) ? 'Отправка...' : ACTION_LABEL[a])

  return (
    <section className="panel card-panel" aria-label={`Выбранная цель ${shown.id}`}>
      <div className="panel-head">
        <h2>Выбранная цель</h2>
      </div>
      <div className="card-body">
        <div className="card-head">
          <span className="ident num">{shown.id}</span>
          <span className="type">
            {TYPE_LABEL[shown.type]}
            {shown.status !== 'TRACKING' && `, ${STATUS_LABEL[shown.status].toLowerCase()}`}
          </span>
          <span className={`chip chip--${shown.threat}`}>{THREAT_LABEL[shown.threat]}</span>
          <button className="icon-btn" aria-label="Снять выбор" title="Снять выбор (Esc)" onClick={() => useArmStore.getState().select(null)}>
            <IconClose />
          </button>
        </div>

        {lost && !target && <div className="note note--warn">Цель потеряна в {clock(lost.lostAt)}, показаны последние данные</div>}

        <dl className="facts num">
          <Fact label="Дальность">
            {km(shown.distance)} <small>км</small>
          </Fact>
          <Fact label="Азимут">{deg(shown.azimuth)}</Fact>
          <Fact label="Курс">{deg(shown.course)}</Fact>
          <Fact label="Скорость">
            {shown.speed.toFixed(0)} <small>м/с</small>
          </Fact>
          <Fact label="Высота">
            {shown.altitude} <small>м</small>
          </Fact>
          <Fact label="Широта">{shown.lat.toFixed(4)}</Fact>
          <Fact label="Долгота">{shown.lon.toFixed(4)}</Fact>
          <Fact label="X / Y, км">
            {km(shown.x)} <small>/</small> {km(shown.y)}
          </Fact>
        </dl>

        {confirming && (
          <div className="confirm" role="alertdialog" aria-label="Подтверждение команды">
            <span>
              {ACTION_LABEL[confirming]} <b>{shown.id}</b>?
            </span>
            <button className="btn btn--sm" onClick={() => setConfirming(null)}>
              Отмена
            </button>
            <button className="btn btn--sm btn--danger" onClick={() => run(confirming)} autoFocus>
              Подтвердить
            </button>
          </div>
        )}

        <div className="actions">
          <button className="btn btn--danger" disabled={disabled('EW_HANDOFF')} onClick={() => run('EW_HANDOFF')}>
            <IconJam />
            {label('EW_HANDOFF')}
          </button>
          <button className="btn btn--accent" disabled={disabled('REQUEST_VIDEO')} onClick={() => run('REQUEST_VIDEO')}>
            <IconVideo />
            {label('REQUEST_VIDEO')}
          </button>
          <button className="btn" disabled={disabled('DROP_TARGET')} onClick={() => run('DROP_TARGET')}>
            <IconDrop />
            {label('DROP_TARGET')}
          </button>
        </div>

        {!online && <div className="note note--fail">Нет связи, команды недоступны</div>}
        {online && result && (
          <div className={`note num ${result.ok ? 'note--ok' : 'note--fail'}`}>
            {clock(result.ts)} {result.message}
          </div>
        )}
      </div>
    </section>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

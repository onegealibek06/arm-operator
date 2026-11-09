import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { clock, deg, km, STATUS_LABEL, THREAT_LABEL, TYPE_LABEL } from '../labels'
import { ACTION_LABEL, sendCommand } from '../net/connection'
import { useArmStore } from '../store/useArmStore'
import type { CommandAction } from '../types'

/** Команды, которые нельзя выполнить одним случайным кликом — оператор подтверждает. */
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
  // Запоминаем, к какой цели относится подтверждение: сменили цель — оно само «исчезает»
  const [confirm, setConfirm] = useState<{ action: CommandAction; targetId: string } | null>(null)
  const confirming = confirm && confirm.targetId === selectedId ? confirm.action : null
  const setConfirming = (action: CommandAction | null) =>
    setConfirm(action && selectedId ? { action, targetId: selectedId } : null)

  if (!selectedId) {
    return (
      <section className="panel card-panel" aria-label="Карточка цели">
        <div className="panel-title">Карточка цели</div>
        <div className="empty">Выберите цель в таблице или на карте (↑ ↓ — переключение)</div>
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

  return (
    <section className="panel card-panel" aria-label={`Карточка цели ${shown.id}`}>
      <div className="panel-title">Карточка цели</div>
      <div className="card-body">
        <div className="card-head">
          <h2 className="num">{shown.id}</h2>
          <span className="type">{TYPE_LABEL[shown.type]}</span>
          <span className={`threat threat--${shown.threat}`}>{THREAT_LABEL[shown.threat]}</span>
          <button className="close" aria-label="Закрыть карточку" onClick={() => useArmStore.getState().select(null)}>
            ✕
          </button>
        </div>

        {lost && !target && <div className="lost">Цель потеряна в {clock(lost.lostAt)} — показаны последние данные</div>}

        <dl className="facts num">
          <Fact label="Дальность, км" value={km(shown.distance)} />
          <Fact label="Азимут" value={deg(shown.azimuth)} />
          <Fact label="Курс" value={deg(shown.course)} />
          <Fact label="Скорость" value={`${shown.speed.toFixed(0)} м/с`} />
          <Fact label="Высота" value={`${shown.altitude} м`} />
          <Fact label="Статус" value={STATUS_LABEL[shown.status]} />
          <Fact label="X / Y, км" value={`${km(shown.x)} / ${km(shown.y)}`} />
          <Fact label="Широта" value={shown.lat.toFixed(5)} />
          <Fact label="Долгота" value={shown.lon.toFixed(5)} />
        </dl>

        {confirming && (
          <div className="confirm" role="alertdialog" aria-label="Подтверждение команды">
            <span>
              Подтвердить: <b>{ACTION_LABEL[confirming]}</b> по {shown.id}?
            </span>
            <button className="btn" onClick={() => setConfirming(null)}>
              Отмена
            </button>
            <button className="btn btn--danger" onClick={() => run(confirming)} autoFocus>
              Подтвердить
            </button>
          </div>
        )}

        <div className="actions">
          <button className="btn btn--danger" disabled={disabled('EW_HANDOFF')} onClick={() => run('EW_HANDOFF')}>
            {pendingActions.includes('EW_HANDOFF') ? 'Отправка…' : 'Передать в РЭБ'}
          </button>
          <button className="btn btn--primary" disabled={disabled('REQUEST_VIDEO')} onClick={() => run('REQUEST_VIDEO')}>
            {pendingActions.includes('REQUEST_VIDEO') ? 'Отправка…' : 'Запросить видео'}
          </button>
          <button className="btn" disabled={disabled('DROP_TARGET')} onClick={() => run('DROP_TARGET')}>
            {pendingActions.includes('DROP_TARGET') ? 'Отправка…' : 'Сбросить цель'}
          </button>
        </div>

        {!online && <div className="result result--fail">Нет связи — команды недоступны</div>}
        {online && result && (
          <div className={`result ${result.ok ? 'result--ok' : 'result--fail'}`}>
            {clock(result.ts)} · {result.ok ? '✔' : '✖'} {result.message}
          </div>
        )}
      </div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

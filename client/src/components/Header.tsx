import { useShallow } from 'zustand/react/shallow'
import { useNow } from '../hooks/useNow'
import { clock } from '../labels'
import { retryNow } from '../net/connection'
import { useArmStore } from '../store/useArmStore'

export function Header() {
  const now = useNow(500)
  const { link, packetsPerSec, lastPacketAt } = useArmStore(
    useShallow((s) => ({ link: s.link, packetsPerSec: s.packetsPerSec, lastPacketAt: s.lastPacketAt })),
  )
  const counts = useArmStore(
    useShallow((s) => {
      const c = { HIGH: 0, MEDIUM: 0, LOW: 0 }
      for (const id of s.targetIds) c[s.targets[id].threat] += 1
      return c
    }),
  )

  let mod = 'online'
  let label = 'ONLINE'
  let detail = 'связь в норме'
  if (link.status === 'ONLINE' && link.stale) {
    mod = 'stale'
    detail = lastPacketAt ? `нет данных ${((now - lastPacketAt) / 1000).toFixed(1)} с` : 'ожидание данных'
  } else if (link.status === 'RECONNECTING') {
    mod = 'reconnecting'
    label = 'RECONNECTING'
    detail = link.attempt > 0 ? `попытка ${link.attempt + 1}` : 'подключение…'
  } else if (link.status === 'OFFLINE') {
    mod = 'offline'
    label = 'OFFLINE'
    const left = link.nextRetryAt ? Math.max(0, Math.ceil((link.nextRetryAt - now) / 1000)) : 0
    detail = `${link.reason ?? 'нет связи'} · повтор через ${left} с`
  }

  // now тикает раз в 500 мс, а пакет мог прийти позже — без max время уходило в минус
  const age = lastPacketAt ? (Math.max(0, now - lastPacketAt) / 1000).toFixed(1) : '—'

  return (
    <header className="header">
      <div className="brand">
        АРМ ОПЕРАТОРА · КП
        <small>Воздушная обстановка</small>
      </div>

      <div className={`link link--${mod}`} role="status" aria-live="polite">
        <span className="dot" aria-hidden />
        <span>{label}</span>
        <small>{detail}</small>
        {link.status === 'OFFLINE' && (
          <button className="btn" style={{ padding: '2px 8px', fontSize: 12 }} onClick={retryNow}>
            Сейчас
          </button>
        )}
      </div>

      <div className="metrics num">
        <span>
          Поток <b>{packetsPerSec}</b> пак/с
        </span>
        <span className="hide-sm">
          Последний пакет <b>{age}</b> с
        </span>
        <span>
          Цели <b style={{ color: 'var(--danger)' }}>{counts.HIGH}</b> / <b style={{ color: 'var(--warn)' }}>{counts.MEDIUM}</b> /{' '}
          <b>{counts.LOW}</b>
        </span>
      </div>

      <span className="spacer" />
      <span className="clock num">{clock(now)}</span>
    </header>
  )
}

/** Баннер тревоги: цель высокой угрозы внутри охраняемой зоны. */
export function AlarmBanner() {
  const intruders = useArmStore(
    useShallow((s) => s.targetIds.filter((id) => s.targets[id].threat === 'HIGH' && s.targets[id].distance < s.scene.zoneM)),
  )
  if (intruders.length === 0) return <div />
  return (
    <div className="alarm" role="alert">
      ⚠ ВТОРЖЕНИЕ В ОХРАНЯЕМУЮ ЗОНУ: {intruders.join(', ')}
    </div>
  )
}

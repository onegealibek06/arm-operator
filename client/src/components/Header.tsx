import type { CSSProperties } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useNow } from '../hooks/useNow'
import { clock, THREAT_LABEL } from '../labels'
import { retryNow } from '../net/connection'
import { useArmStore } from '../store/useArmStore'
import type { ThreatLevel } from '../types'
import { IconAlert, Logo } from './icons'

const COUNTER_COLOR: Record<ThreatLevel, string> = { HIGH: 'var(--high)', MEDIUM: 'var(--med)', LOW: 'var(--low)' }

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
  let detail = 'связь в норме'
  if (link.status === 'ONLINE' && link.stale) {
    mod = 'stale'
    detail = lastPacketAt ? `нет данных ${((now - lastPacketAt) / 1000).toFixed(1)} с` : 'ожидание данных'
  } else if (link.status === 'RECONNECTING') {
    mod = 'reconnecting'
    detail = link.attempt > 0 ? `попытка ${link.attempt + 1}` : 'подключение'
  } else if (link.status === 'OFFLINE') {
    mod = 'offline'
    const left = link.nextRetryAt ? Math.max(0, Math.ceil((link.nextRetryAt - now) / 1000)) : 0
    detail = `повтор через ${left} с`
  }

  const age = lastPacketAt ? (Math.max(0, now - lastPacketAt) / 1000).toFixed(1) : '-'

  return (
    <header className="header">
      <div className="brand">
        <Logo />
        <div>
          <div className="brand-name">АРМ оператора</div>
          <div className="brand-sub">Командный пункт, воздушная обстановка</div>
        </div>
      </div>

      <div className={`status status--${mod}`} role="status" aria-live="polite" title={link.reason ?? undefined}>
        <span className="bars" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="status-label">{link.status}</span>
        <span className="status-detail num">{detail}</span>
        {link.status === 'OFFLINE' && (
          <button className="btn-link" onClick={retryNow}>
            Переподключить
          </button>
        )}
      </div>

      <div className="stats num">
        <span>
          Поток <b>{packetsPerSec}</b> пак/с
        </span>
        <span className="hide-sm hide-md">
          Последний пакет <b>{age}</b> с
        </span>
      </div>

      <span className="spacer" />

      <div className="threat-counters num" aria-label="Цели по уровню угрозы">
        {(['HIGH', 'MEDIUM', 'LOW'] as const).map((l) => (
          <div
            key={l}
            className={`counter${counts[l] > 0 && l !== 'LOW' ? ' is-hot' : ''}`}
            style={{ '--c': COUNTER_COLOR[l] } as CSSProperties}
          >
            <b>{counts[l]}</b>
            {THREAT_LABEL[l].toLowerCase()}
          </div>
        ))}
      </div>

      <span className="clock num hide-sm">{clock(now)}</span>
    </header>
  )
}

export function AlarmBanner() {
  const intruders = useArmStore(
    useShallow((s) => s.targetIds.filter((id) => s.targets[id].threat === 'HIGH' && s.targets[id].distance < s.scene.zoneM)),
  )
  if (intruders.length === 0) return <div />
  return (
    <div className="alarm" role="alert">
      <IconAlert />
      Вторжение в охраняемую зону: {intruders.join(', ')}
    </div>
  )
}

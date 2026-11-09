import { clock } from '../labels'
import { useArmStore } from '../store/useArmStore'

export function EventLog() {
  const events = useArmStore((s) => s.events)
  return (
    <section className="panel log-panel" aria-label="Журнал событий">
      <div className="panel-title">
        Журнал событий <span className="num">{events.length}</span>
      </div>
      <ol className="log num" aria-live="polite">
        {events.map((e) => (
          <li key={e.id} className={`lvl-${e.level}`}>
            <time>{clock(e.ts)}</time>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

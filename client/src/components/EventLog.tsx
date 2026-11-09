import { clock } from '../labels'
import { useArmStore } from '../store/useArmStore'

export function EventLog() {
  const events = useArmStore((s) => s.events)
  return (
    <section className="panel log-panel" aria-label="Журнал событий">
      <div className="panel-head">
        <h2>Журнал событий</h2>
        <span className="count num">{events.length}</span>
      </div>
      <ol className="log" aria-live="polite">
        {events.map((e) => (
          <li key={e.id} className={`lvl-${e.level}`}>
            <time className="num">{clock(e.ts)}</time>
            <i aria-hidden />
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

import { useEffect, useState } from 'react'

/** Текущее время, обновляется раз в intervalMs (часы, обратный отсчёт, «пакет N с назад»). */
export function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id) // без этого таймер жил бы после размонтирования
  }, [intervalMs])
  return now
}

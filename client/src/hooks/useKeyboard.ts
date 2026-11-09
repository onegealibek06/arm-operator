import { useEffect } from 'react'
import { selectVisibleTargets, useArmStore } from '../store/useArmStore'

export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [role="alertdialog"]')) return
      const s = useArmStore.getState()
      if (e.key === 'Escape') {
        s.select(null)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const ids = selectVisibleTargets(s).map((t) => t.id)
      if (ids.length === 0) return
      e.preventDefault()
      const i = s.selectedId ? ids.indexOf(s.selectedId) : -1
      const next = e.key === 'ArrowDown' ? (i + 1) % ids.length : (i - 1 + ids.length) % ids.length
      s.select(ids[next])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

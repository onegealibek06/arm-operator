import { useEffect } from 'react'
import { EventLog } from './components/EventLog'
import { AlarmBanner, Header } from './components/Header'
import { TacticalMap } from './components/TacticalMap'
import { TargetCard } from './components/TargetCard'
import { TargetTable } from './components/TargetTable'
import { useKeyboard } from './hooks/useKeyboard'
import { startConnection } from './net/connection'

export default function App() {
  // Одно соединение на всё приложение. Функция очистки закрывает сокет и все таймеры.
  useEffect(() => startConnection(), [])
  useKeyboard()

  return (
    <div className="app">
      <Header />
      <AlarmBanner />
      <main className="main">
        <TacticalMap />
        <EventLog />
        <div className="side">
          <TargetTable />
          <TargetCard />
        </div>
      </main>
    </div>
  )
}

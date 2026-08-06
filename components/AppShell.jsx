'use client'
import { useState, useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { startBacktestMonitor } from '../app/lib/backtestLog'

export function AppShell({ children }) {
  const [open, setOpen] = useState(true)

  // Monitor de precio del log de backtesting: revisa cada 60s las operativas
  // "en_proceso" para detectar cierre por TP1/SL. Corre mientras el navegador
  // esté abierto en cualquier página (no hay cron/servidor en este proyecto).
  useEffect(() => {
    const stop = startBacktestMonitor()
    return stop
  }, [])

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-slate-950">
      <Sidebar open={open} onToggle={() => setOpen(o => !o)} />
      <main className={`flex-1 transition-[margin] duration-300 ${open ? 'ml-52' : 'ml-0'}`}>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            title="Mostrar menú"
            className="fixed top-4 left-4 z-50 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-2 shadow-sm text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:shadow transition-all"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}
        {children}
      </main>
    </div>
  )
}

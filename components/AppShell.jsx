'use client'
import { useState } from 'react'
import { Sidebar } from './Sidebar'

export function AppShell({ children }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar open={open} onToggle={() => setOpen(o => !o)} />
      <main className={`flex-1 transition-[margin] duration-300 ${open ? 'ml-52' : 'ml-0'}`}>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            title="Mostrar menú"
            className="fixed top-4 left-4 z-50 bg-white border border-gray-200 rounded-xl p-2 shadow-sm text-gray-400 hover:text-gray-700 hover:shadow transition-all"
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

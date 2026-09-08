'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { mirrorToRemote, migrateAllToRemote } from '../app/lib/remoteStore'

const ThemeCtx = createContext({ dark: false, toggle: () => {} })

export function ThemeProvider({ children }) {
    const [dark, setDark] = useState(false)

    useEffect(() => {
        const stored     = localStorage.getItem('theme')
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        const isDark     = stored ? stored === 'dark' : prefersDark
        setDark(isDark)
        document.documentElement.classList.toggle('dark', isDark)

        // ThemeProvider envuelve toda la app (ver app/layout.jsx), así que este
        // es el único lugar que se monta siempre sin importar la página — de
        // aquí se dispara, una vez por carga, la migración de todo lo que ya
        // esté en localStorage hacia el espejo remoto (ver app/lib/remoteStore).
        migrateAllToRemote()
    }, [])

    const toggle = () => {
        setDark(d => {
            const next = !d
            document.documentElement.classList.toggle('dark', next)
            const value = next ? 'dark' : 'light'
            localStorage.setItem('theme', value)
            mirrorToRemote('theme', value)
            return next
        })
    }

    return <ThemeCtx.Provider value={{ dark, toggle }}>{children}</ThemeCtx.Provider>
}

export const useTheme = () => useContext(ThemeCtx)

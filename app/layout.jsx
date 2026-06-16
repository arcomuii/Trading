import './globals.css'
import { AppShell } from '../components/AppShell'
import { ThemeProvider } from '../components/ThemeProvider'

export const metadata = {
  title: 'Trading Dashboard',
  description: 'Dashboard personal de trading',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="bg-gray-50 dark:bg-slate-950">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  )
}

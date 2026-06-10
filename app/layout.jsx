import './globals.css'
import { AppShell } from '../components/AppShell'

export const metadata = {
  title: 'Trading Dashboard',
  description: 'Dashboard personal de trading',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className="bg-gray-50">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Trading Intelligence Dashboard',
  description: 'Real-time trading dashboard with signals, charts, and analysis',
  icons: {
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75" fill="%2310b981">📈</text></svg>',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-dark-900 text-gray-100">
        <main className="min-h-screen">
          {children}
        </main>
      </body>
    </html>
  )
}

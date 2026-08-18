'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  const isDark = mounted && (theme === 'dark' || (theme === 'system' && resolvedTheme === 'dark'))

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <button
        onClick={() => setTheme('light')}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
          mounted && !isDark
            ? 'bg-orange-100 text-orange-600'
            : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
        }`}
        aria-label="Light mode"
      >
        <Sun className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setTheme('dark')}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
          mounted && isDark
            ? 'bg-slate-700 text-slate-200'
            : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
        }`}
        aria-label="Dark mode"
      >
        <Moon className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

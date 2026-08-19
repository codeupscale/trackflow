"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CheckCircle2, Info, AlertTriangle, XCircle, Loader2 } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CheckCircle2 strokeWidth={2} className="size-4" />,
        info: <Info strokeWidth={2} className="size-4" />,
        warning: <AlertTriangle strokeWidth={2} className="size-4" />,
        error: <XCircle strokeWidth={2} className="size-4" />,
        loading: <Loader2 strokeWidth={2} className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          success: "!bg-emerald-600 !text-white !border-emerald-700 [&_[data-icon]]:!text-white",
          error: "!bg-red-600 !text-white !border-red-700 [&_[data-icon]]:!text-white",
          warning: "!bg-amber-500 !text-white !border-amber-600 [&_[data-icon]]:!text-white",
          info: "!bg-blue-600 !text-white !border-blue-700 [&_[data-icon]]:!text-white",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

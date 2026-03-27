"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root {...props} />
}

function TooltipTrigger({
  ref,
  className,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      delay={300}
      className={cn("cursor-default", className)}
      {...props}
    />
  )
}

function TooltipContent({
  ref,
  className,
  sideOffset = 8,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Popup> & { sideOffset?: number }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner sideOffset={sideOffset}>
        <TooltipPrimitive.Popup
          ref={ref}
          className={cn(
            "z-50 max-w-xs rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-xs text-slate-200 shadow-md",
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

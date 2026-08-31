'use client'

import * as React from 'react'
import { format, parse } from 'date-fns'
import { CalendarIcon, X } from 'lucide-react'
import type { Matcher } from 'react-day-picker'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface DatePickerProps {
  value: string // YYYY-MM-DD
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  minDate?: string // YYYY-MM-DD — dates before this are disabled
  maxDate?: string // YYYY-MM-DD — dates after this are disabled
  /** Show an X to clear back to the empty (unfiltered) state. */
  clearable?: boolean
}

function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  className,
  minDate,
  maxDate,
  clearable = false,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  const selectedDate = React.useMemo(() => {
    if (!value) return undefined
    return parse(value, 'yyyy-MM-dd', new Date())
  }, [value])

  const displayText = React.useMemo(() => {
    if (!selectedDate || !value) return placeholder
    return format(selectedDate, 'MMM d, yyyy')
  }, [selectedDate, value, placeholder])

  const disabledMatcher = React.useMemo(() => {
    const matchers: Matcher[] = []
    if (minDate) matchers.push({ before: parse(minDate, 'yyyy-MM-dd', new Date()) })
    if (maxDate) matchers.push({ after: parse(maxDate, 'yyyy-MM-dd', new Date()) })
    return matchers.length ? matchers : undefined
  }, [minDate, maxDate])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              'w-[180px] justify-start text-left font-normal',
              !value && 'text-muted-foreground',
              className,
            )}
          />
        }
      >
        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
        <span className="truncate">{displayText}</span>
        {clearable && value && (
          // stopPropagation so clearing doesn't also open the calendar. A span,
          // not a button — this sits inside the trigger button.
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear date"
            className="ml-auto inline-flex items-center rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            // The popover trigger opens on pointerdown, not click, so guarding
            // click alone clears the date AND opens the calendar.
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                e.preventDefault()
                onChange('')
              }
            }}
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => {
            if (date) {
              onChange(format(date, 'yyyy-MM-dd'))
            }
            setOpen(false)
          }}
          defaultMonth={selectedDate}
          disabled={disabledMatcher}
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }

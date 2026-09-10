'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Search, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { PayslipFieldPosition, PayslipImageFieldCatalogue } from '@/lib/validations/payroll';

interface Props {
  imageDataUri: string;
  catalogue: PayslipImageFieldCatalogue | undefined;
  positions: PayslipFieldPosition[];
  onChange: (positions: PayslipFieldPosition[]) => void;
  disabled?: boolean;
}

const FIELD_COLORS = ['#1F2937', '#FFFFFF', '#2563EB', '#B91C1C', '#0F766E'];

/**
 * The width of the rendered page in CSS pixels — A4's 210mm at 96dpi, the
 * exact box `payslips/image.blade.php` positions everything inside.
 *
 * A field's x/y are percentages and scale to any canvas, but its FONT SIZE is
 * absolute px in both the placer and the PDF. Show the artwork 600px wide and
 * a 17px value looks a third larger than it prints, so type sized to sit on a
 * line of the design here comes out too small there. Everything measured in px
 * — the size and the half-line vertical-centre offset — is multiplied by the
 * canvas's share of this width so the preview is honest at any panel width.
 */
const PAGE_WIDTH_PX = 793.7;

/**
 * How a field is anchored, in one place, because the placer and
 * `payslips/image.blade.php` must agree exactly or what is dragged is not what
 * prints. Centre spans a box from the page edge to twice the placement, so the
 * box's MIDDLE lands on the point — `text-align` alone does nothing to a box
 * that shrink-wraps its own text.
 */
function anchorStyle(x: number, align: 'left' | 'center' | 'right') {
  if (align === 'center') {
    return x <= 50
      ? { left: 0, width: `${x * 2}%` }
      : { right: 0, width: `${(100 - x) * 2}%` };
  }
  return align === 'right' ? { right: `${100 - x}%` } : { left: `${x}%` };
}

/** Nudge step for the arrow keys, as a percentage of the page. */
const NUDGE = 0.1;
const NUDGE_COARSE = 1;

/** Keep a coordinate on the page, at the two decimals the placer stores. */
function clampPercent(value: number): number {
  return Number(Math.min(100, Math.max(0, value)).toFixed(2));
}

/** The range the Size box offers, shared with the on-field buttons. */
const MIN_SIZE = 5;
const MAX_SIZE = 48;

function clampSize(value: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)));
}

/**
 * Place payroll values onto a company's own payslip artwork.
 *
 * There is no standing field list: you click the spot on the design where a
 * value belongs and pick it there. The picker opens at the click point, so
 * choosing a field and deciding where it goes are one action instead of two.
 *
 * Positions are stored as PERCENTAGES of the image, never pixels — the placer
 * shows the artwork at whatever width the panel happens to be and the PDF
 * renders it at A4, so pixels measured here would mean nothing there.
 */
export function PayslipFieldPlacer({
  imageDataUri,
  catalogue,
  positions,
  onChange,
  disabled = false,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [search, setSearch] = useState('');
  const [customText, setCustomText] = useState('');
  /** Alignment guides shown while a drag is snapped to a neighbour. */
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  /** Measured so type can be scaled to the page — see PAGE_WIDTH_PX. */
  const [canvasWidth, setCanvasWidth] = useState(600);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0) setCanvasWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = canvasWidth / PAGE_WIDTH_PX;

  const allFields = useMemo(
    () =>
      Object.entries(catalogue ?? {}).flatMap(([group, fields]) =>
        fields.map((f) => ({ ...f, group })),
      ),
    [catalogue],
  );

  const sampleFor = useMemo(
    () => Object.fromEntries(allFields.map((f) => [f.key, f.sample])),
    [allFields],
  );
  const labelFor = useMemo(
    () => Object.fromEntries(allFields.map((f) => [f.key, f.label])),
    [allFields],
  );

  // 'custom' is deliberately excluded: a design may carry any number of its
  // own text boxes, while a payroll value belongs in exactly one place.
  const placedKeys = useMemo(
    () => new Set(positions.filter((p) => p.key !== 'custom').map((p) => p.key)),
    [positions],
  );

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allFields
      .filter((f) => !placedKeys.has(f.key))
      .filter(
        (f) =>
          !term ||
          f.label.toLowerCase().includes(term) ||
          f.key.toLowerCase().includes(term) ||
          f.group.toLowerCase().includes(term),
      )
      .slice(0, 40);
  }, [allFields, placedKeys, search]);

  const update = useCallback(
    (index: number, patch: Partial<PayslipFieldPosition>) => {
      onChange(positions.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    },
    [onChange, positions],
  );

  const removeField = useCallback(
    (index: number) => {
      onChange(positions.filter((_, i) => i !== index));
      setSelected(null);
    },
    [onChange, positions],
  );

  /** Grow or shrink a field by one step, from wherever it currently is. */
  const resizeField = useCallback(
    (index: number, delta: number) => {
      const current = positions[index]?.size ?? 10;
      update(index, { size: clampSize(current + delta) });
    },
    [positions, update],
  );

  useEffect(() => {
    if (picker) searchRef.current?.focus();
  }, [picker]);

  /** Convert a pointer event to a percentage position inside the artwork. */
  const percentFromEvent = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    if (disabled || dragging !== null) return;
    // Clicks that land on a placed field are that field's business.
    if ((e.target as HTMLElement).closest('[data-placed-field]')) return;

    const pos = percentFromEvent(e);
    if (!pos) return;
    setSelected(null);
    setSearch('');
    setPicker({ x: Number(pos.x.toFixed(2)), y: Number(pos.y.toFixed(2)) });
  };

  const addFieldAtPicker = (key: string, text?: string) => {
    if (!picker) return;
    onChange([
      ...positions,
      {
        key,
        x: picker.x,
        y: picker.y,
        size: 10,
        align: 'left',
        bold: false,
        color: '#1F2937',
        ...(key === 'custom' ? { text: text ?? '' } : {}),
      },
    ]);
    setSelected(positions.length);
    setPicker(null);
    setCustomText('');
  };

  /**
   * Snap a dragged field to the edges of the others.
   *
   * Values in a payslip belong in columns and rows, and a hand-dragged
   * position is never exactly the same as the one above it — a column of
   * amounts each half a percent apart reads as sloppy on the printed page.
   * Anything within the threshold takes the neighbour's exact coordinate, and
   * the guide lines show which one it locked onto.
   */
  const SNAP = 0.7; // percent of the page

  const snap = (value: number, others: number[]) => {
    let best: number | null = null;
    let bestDistance = SNAP;

    for (const other of others) {
      const distance = Math.abs(value - other);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = other;
      }
    }

    return best;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging === null || disabled) return;
    const pos = percentFromEvent(e);
    if (!pos) return;

    const others = positions.filter((_, i) => i !== dragging);
    const snappedX = snap(pos.x, others.map((p) => p.x));
    const snappedY = snap(pos.y, others.map((p) => p.y));

    setGuides({ x: snappedX, y: snappedY });
    update(dragging, {
      x: Number((snappedX ?? pos.x).toFixed(2)),
      y: Number((snappedY ?? pos.y).toFixed(2)),
    });
  };

  const endDrag = () => {
    setDragging(null);
    setGuides({ x: null, y: null });
  };

  const active = selected !== null ? positions[selected] : undefined;

  return (
    <div className="space-y-3">
      <div className="mx-auto flex w-full max-w-[600px] items-center justify-between gap-2">
        <p className="text-[0.65rem] text-muted-foreground">
          {disabled
            ? 'You do not have permission to edit this design.'
            : 'Click your design to place a field, then drag it. Arrow keys nudge, Shift+arrow moves further, + and − resize. Boxes show the field name here; each employee’s own data fills in on their payslip.'}
        </p>
        {positions.length > 0 && !disabled && (
          <button
            type="button"
            onClick={() => {
              onChange([]);
              setSelected(null);
            }}
            className="shrink-0 text-[0.6rem] text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <div
        ref={canvasRef}
        tabIndex={0}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClick={onCanvasClick}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Escape') {
            setPicker(null);
            return;
          }
          if (selected === null) return;
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            removeField(selected);
            return;
          }
          // Size, from the keyboard. Matching type to the artwork is a
          // sequence of small trials, and doing it without the hand leaving
          // the design is the difference between three adjustments and one.
          // Parenthesised deliberately: `&&` binds tighter than `||`, so the
          // Alt clause reads as a third alternative rather than qualifying the
          // whole condition. Alt+arrow is checked BEFORE the nudge block below,
          // which owns the bare arrows.
          if (e.key === '+' || e.key === '=' || (e.key === 'ArrowUp' && e.altKey)) {
            e.preventDefault();
            resizeField(selected, 1);
            return;
          }
          if (e.key === '-' || e.key === '_' || (e.key === 'ArrowDown' && e.altKey)) {
            e.preventDefault();
            resizeField(selected, -1);
            return;
          }

          // Fine placement. Dragging is limited by the screen: at the working
          // width one pixel of mouse travel is more than one pixel on the
          // page, so the last half-millimetre of alignment is unreachable by
          // hand. Shift jumps a whole percent for coarse moves.
          const step = e.shiftKey ? NUDGE_COARSE : NUDGE;
          const axis: Record<string, [keyof PayslipFieldPosition, number]> = {
            ArrowLeft: ['x', -step],
            ArrowRight: ['x', step],
            ArrowUp: ['y', -step],
            ArrowDown: ['y', step],
          };
          const move = axis[e.key];
          if (!move) return;
          e.preventDefault();
          const [key, delta] = move;
          const current = positions[selected][key] as number;
          update(selected, { [key]: clampPercent(current + delta) });
        }}
        className={cn(
          // Capped and centred at roughly a page's width. Stretching the
          // artwork across a wide screen makes a payslip look like a banner
          // and shrinks the type until placement is guesswork — positions are
          // percentages, so the working width is a presentation choice with no
          // effect on the rendered PDF.
          'relative mx-auto w-full max-w-[600px] select-none overflow-hidden rounded-md',
          'border border-border bg-white shadow-sm outline-none',
          dragging !== null ? 'cursor-grabbing' : !disabled && 'cursor-crosshair',
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageDataUri} alt="Payslip design" className="block w-full" draggable={false} />

        {/* Alignment guides — only while a drag has locked onto a neighbour,
            so they say "this is now in the same column" rather than acting as
            permanent decoration. */}
        {guides.x !== null && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary/70"
            style={{ left: `${guides.x}%` }}
          />
        )}
        {guides.y !== null && (
          <div
            className="pointer-events-none absolute left-0 right-0 h-px bg-primary/70"
            style={{ top: `${guides.y}%` }}
          />
        )}

        {positions.map((field, index) => {
          const isSelected = selected === index;
          const align = field.align ?? 'left';
          return (
            <div
              key={`${field.key}-${index}`}
              style={{
                top: `${field.y}%`,
                // Same anchoring as the PDF: the saved point is the text's
                // vertical centre, so what is dragged is what prints.
                marginTop: `-${((field.size ?? 10) * 0.62 * scale).toFixed(2)}px`,
                ...anchorStyle(field.x, align),
                fontSize: `${((field.size ?? 10) * scale).toFixed(2)}px`,
                fontWeight: field.bold ? 700 : 400,
                color: field.color ?? '#1F2937',
                textAlign: align,
              }}
              // The positioning box only. For a centred field it reaches all
              // the way to the page edge, so it must not swallow clicks or
              // wear the outline — that is the chip's job, and the chip is
              // only ever as wide as the text that prints.
              className="pointer-events-none absolute whitespace-nowrap leading-tight"
            >
              <span
                data-placed-field
                onPointerDown={(e) => {
                  if (disabled) return;
                  e.preventDefault();
                  e.stopPropagation();
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  setPicker(null);
                  setSelected(index);
                  setDragging(index);
                  canvasRef.current?.focus();
                }}
                className={cn(
                  'group pointer-events-auto relative inline-block cursor-grab',
                  isSelected
                    ? 'outline outline-2 outline-offset-1 outline-primary'
                    : 'outline outline-1 outline-offset-1 outline-primary/25 hover:outline-primary/60',
                )}
                title={
                  field.key === 'custom'
                    ? 'Your own text'
                    : `${labelFor[field.key] ?? field.key} — fills per employee, e.g. "${sampleFor[field.key] ?? ''}"`
                }
              >
                {/* The FIELD, not a sample value. Showing "Software Engineer"
                    here made a placeholder look like a hard-coded answer; the
                    name of the field is what is actually placed, and the real
                    value arrives per employee at render time. Custom text is
                    the exception — that IS literal, so it shows as typed. */}
                {field.key === 'custom'
                  ? field.text || 'Your text'
                  : (labelFor[field.key] ?? field.key)}

                {/* Size, ON the field. Matching type to the artwork is done by
                    eye, comparing the value against the printed label right
                    beside it — so the control belongs where the eye already is,
                    not in a panel below the canvas that forces a look away
                    between every adjustment. The numeric box remains for when
                    an exact number is known.

                    Only while selected: two extra buttons on every field the
                    cursor passes over would bury the design under chrome. */}
                {!disabled && isSelected && (
                  <span className="absolute -bottom-2.5 -right-2 flex items-center gap-px">
                    {([
                      ['−', -1, 'Smaller'],
                      ['+', 1, 'Larger'],
                    ] as const).map(([glyph, delta, label]) => (
                      <button
                        key={label}
                        type="button"
                        aria-label={`${label}: ${labelFor[field.key] ?? field.key}`}
                        title={`${label} (${field.size ?? 10}px)`}
                        // Without stopping the pointerdown, pressing these also
                        // starts a drag and the field slides away under the
                        // cursor while being resized.
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          resizeField(index, delta);
                        }}
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-sm border border-border',
                          'bg-background text-[0.65rem] font-semibold leading-none text-foreground shadow-sm',
                          'hover:bg-primary hover:text-primary-foreground',
                        )}
                      >
                        {glyph}
                      </button>
                    ))}
                  </span>
                )}

                {/* Delete sits ON the field — reaching a field's own remove
                    control should never mean hunting for it in a panel. The
                    stopPropagation matters: without it the pointerdown that
                    hits this button also starts a drag, and the field slides
                    out from under the cursor as it is removed. */}
                {!disabled && (
                  <button
                    type="button"
                    aria-label={`Remove ${labelFor[field.key] ?? field.key}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeField(index);
                    }}
                    className={cn(
                      'absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full',
                      'bg-destructive text-destructive-foreground shadow-sm transition-opacity',
                      'hover:bg-destructive/90',
                      isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    )}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </span>
            </div>
          );
        })}

        {/* Field picker, opened where the user clicked */}
        {picker && !disabled && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              top: `${Math.min(picker.y, 60)}%`,
              left: `${Math.min(picker.x, 62)}%`,
            }}
            className="absolute z-10 w-56 rounded-md border border-border bg-popover shadow-lg"
          >
            <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
              <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search fields…"
                className="w-full bg-transparent text-[0.7rem] outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                aria-label="Close"
                onClick={() => setPicker(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {/* Your own text, for a box the product has no field for. Always
                  offered, and pre-filled with whatever was typed in the search
                  box — someone looking for a field we do not have has already
                  written its name by the time they find out. */}
              <div className="border-b border-border/60 px-2 pb-1.5 pt-1">
                <p className="mb-1 text-[0.58rem] uppercase tracking-wider text-muted-foreground">
                  Your own text
                </p>
                <div className="flex items-center gap-1">
                  <input
                    value={customText || search}
                    onChange={(e) => setCustomText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const text = (customText || search).trim();
                        if (text) addFieldAtPicker('custom', text);
                      }
                    }}
                    placeholder="Type any text…"
                    className="w-full rounded border border-border bg-background px-1.5 py-1 text-[0.68rem] outline-none"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-6 shrink-0 px-2 text-[0.62rem]"
                    disabled={!(customText || search).trim()}
                    onClick={() => addFieldAtPicker('custom', (customText || search).trim())}
                  >
                    Add
                  </Button>
                </div>
              </div>

              {matches.length === 0 ? (
                <p className="px-2 py-3 text-center text-[0.65rem] text-muted-foreground">
                  {allFields.length === 0 ? 'Loading fields…' : 'No matching field — add it as your own text above.'}
                </p>
              ) : (
                matches.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => addFieldAtPicker(f.key)}
                    className="flex w-full items-baseline justify-between gap-2 px-2 py-1 text-left hover:bg-primary/10"
                  >
                    <span className="truncate text-[0.68rem]">{f.label}</span>
                    <span className="shrink-0 text-[0.58rem] uppercase tracking-wider text-muted-foreground">
                      {f.group}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {positions.length === 0 && !picker && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded bg-foreground/80 px-3 py-1.5 text-[0.7rem] font-medium text-background">
              Click where a value should appear
            </p>
          </div>
        )}
      </div>

      {/* Properties for the selected field */}
      {active && (
        <div className="mx-auto flex w-full max-w-[600px] flex-wrap items-end gap-3 rounded-md border border-border/60 bg-muted/20 p-2.5">
          <div className="min-w-0">
            <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">Selected</p>
            {active.key === 'custom' ? (
              <Input
                value={active.text ?? ''}
                disabled={disabled}
                onChange={(e) => update(selected!, { text: e.target.value })}
                placeholder="Your text"
                className="mt-0.5 h-7 w-44 text-xs"
              />
            ) : (
              <p className="truncate text-xs font-medium">{labelFor[active.key] ?? active.key}</p>
            )}
          </div>

          {/* Exact placement. Dragging gets a field close; a payslip's columns
              want it exact, and a value that has to line up with one already
              placed is set by copying its number rather than by eye. Percent
              of the page — the same unit that is stored and printed. */}
          <div className="space-y-1">
            <Label className="text-[0.6rem]">X %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={active.x}
              disabled={disabled}
              onChange={(e) => update(selected!, { x: clampPercent(Number(e.target.value)) })}
              className="h-7 w-[4.5rem] text-xs tabular-nums"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[0.6rem]">Y %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={active.y}
              disabled={disabled}
              onChange={(e) => update(selected!, { y: clampPercent(Number(e.target.value)) })}
              className="h-7 w-[4.5rem] text-xs tabular-nums"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[0.6rem]">Size</Label>
            <Input
              type="number"
              min={MIN_SIZE}
              max={MAX_SIZE}
              value={active.size ?? 10}
              disabled={disabled}
              onChange={(e) => update(selected!, { size: clampSize(Number(e.target.value)) })}
              className="h-7 w-16 text-xs tabular-nums"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[0.6rem]">Align</Label>
            <div className="flex gap-0.5">
              {([
                ['left', AlignLeft],
                ['center', AlignCenter],
                ['right', AlignRight],
              ] as const).map(([value, Icon]) => (
                <Button
                  key={value}
                  type="button"
                  variant={(active.align ?? 'left') === value ? 'secondary' : 'ghost'}
                  size="sm"
                  disabled={disabled}
                  onClick={() => update(selected!, { align: value })}
                  className="h-7 w-7 p-0"
                >
                  <Icon className="h-3.5 w-3.5" />
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[0.6rem]">Weight</Label>
            <Button
              type="button"
              variant={active.bold ? 'secondary' : 'ghost'}
              size="sm"
              disabled={disabled}
              onClick={() => update(selected!, { bold: !active.bold })}
              className="h-7 w-7 p-0"
            >
              <Bold className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="space-y-1">
            <Label className="text-[0.6rem]">Colour</Label>
            <div className="flex items-center gap-1">
              {FIELD_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={disabled}
                  aria-label={`Use ${c}`}
                  onClick={() => update(selected!, { color: c })}
                  style={{ backgroundColor: c }}
                  className={cn(
                    'h-5 w-5 rounded-full border',
                    (active.color ?? '#1F2937').toUpperCase() === c
                      ? 'border-foreground/70 ring-1 ring-foreground/30'
                      : 'border-border/60',
                  )}
                />
              ))}
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => removeField(selected!)}
            className="ml-auto h-7 text-xs text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1.5 h-3 w-3" />
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

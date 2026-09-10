'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  FileCode2,
  ImageIcon,
  Loader2,
  RotateCcw,
  Save,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

import { PayslipFieldPlacer } from '@/components/hr/PayslipFieldPlacer';
import {
  usePayslipImageFields,
  usePayslipPlaceholders,
  usePayslipTemplate,
  useUpdatePayslipTemplate,
} from '@/hooks/hr/use-payslip-template';
import { usePermissionStore } from '@/stores/permission-store';
import api from '@/lib/api';
import { readBlobError } from '@/lib/download';
import { cn } from '@/lib/utils';
import type {
  PayslipLayout,
  PayslipTemplate,
  PayslipTemplateFormData,
} from '@/lib/validations/payroll';

/** A full-page design, so a larger cap than a logo — but still bounded. */
const MAX_BACKGROUND_BYTES = 3 * 1024 * 1024;

/**
 * Two ways to build a payslip, both of them the company's own design. The
 * built-in layouts are gone from the UI: they still exist server-side purely
 * as the fallback when a company's design fails to render, so nobody is ever
 * left without a payslip.
 */
const LAYOUTS: { value: PayslipLayout; name: string; blurb: string }[] = [
  {
    value: 'image',
    name: 'Upload your design',
    blurb: 'Your JPEG or PNG payslip. Drag each value onto it once; every run fills it in.',
  },
  {
    value: 'custom',
    name: 'Your own HTML',
    blurb: 'A template you code yourself, using placeholders for the figures.',
  },
];

const STARTER_TEMPLATE = `<html>
  <body style="font-family: Arial, sans-serif; color: #1f2937;">
    <h1>{{ company.name }}</h1>

    <h2>Payslip for {{ employee.name }} {{ draft_stamp }}</h2>
    <p>{{ period.name }} &mdash; {{ period.start }} to {{ period.end }}</p>

    <h3>Earnings</h3>
    <table width="100%" cellpadding="6" style="border-collapse: collapse;">
      {{#each earnings}}
        <tr>
          <td style="border-bottom: 1px solid #eee;">{{ label }}</td>
          <td style="border-bottom: 1px solid #eee; text-align: right;">{{ amount }}</td>
        </tr>
      {{/each}}
    </table>

    {{#if deductions}}
      <h3>Deductions</h3>
      <table width="100%" cellpadding="6" style="border-collapse: collapse;">
        {{#each deductions}}
          <tr>
            <td style="border-bottom: 1px solid #eee;">{{ label }}</td>
            <td style="border-bottom: 1px solid #eee; text-align: right;">{{ amount }}</td>
          </tr>
        {{/each}}
      </table>
    {{/if}}

    <h2>Net Pay: {{ pay.net }}</h2>
  </body>
</html>`;

/**
 * The fields the API accepts. Values the screen no longer edits are still
 * round-tripped, so removing them from the UI never silently wipes a row.
 */
function toFormData(t: PayslipTemplate): PayslipTemplateFormData {
  return {
    layout: t.layout,
    accent_color: t.accent_color,
    company_name: t.company_name,
    company_address: t.company_address,
    company_registration_no: t.company_registration_no,
    footer_note: t.footer_note,
    logo_data_uri: t.logo_data_uri,
    show_payment_details: t.show_payment_details,
    show_employer_contributions: t.show_employer_contributions,
    show_attendance_summary: t.show_attendance_summary,
    show_leave_balance: t.show_leave_balance,
    show_ytd_totals: t.show_ytd_totals,
    show_signature_block: t.show_signature_block,
    custom_template_html: t.custom_template_html,
    custom_template_name: t.custom_template_name,
    background_image_data_uri: t.background_image_data_uri,
    background_image_name: t.background_image_name,
    field_positions: t.field_positions ?? [],
  };
}

export default function PayslipDesignPage() {
  const { hasPermission } = usePermissionStore();
  const canManage = hasPermission('payroll.manage_structures');

  const { data: template, isLoading, isError } = usePayslipTemplate();
  const updateTemplate = useUpdatePayslipTemplate();

  const [form, setForm] = useState<PayslipTemplateFormData | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** For the image layout: place fields on the artwork, or see the rendered PDF. */
  const [imageMode, setImageMode] = useState<'place' | 'pdf'>('place');
  /** Bumped by "Try again" to re-run the preview without changing the design. */
  const [previewNonce, setPreviewNonce] = useState(0);

  const templateInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  // Held so an object URL is only revoked once its replacement has rendered —
  // revoking the live one first makes the iframe flash blank on every edit.
  const previousUrlRef = useRef<string | null>(null);

  const { data: placeholders } = usePayslipPlaceholders(form?.layout === 'custom');
  const { data: imageFields } = usePayslipImageFields(form?.layout === 'image');

  useEffect(() => {
    if (template && !form) setForm(toFormData(template));
  }, [template, form]);

  const set = useCallback(<K extends keyof PayslipTemplateFormData>(
    key: K,
    value: PayslipTemplateFormData[K],
  ) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  // ── Live preview ────────────────────────────────────────────────────────
  // Heavy fields are omitted when they still match what the server stored: a
  // design can be 3MB of base64, and re-uploading it on every edit would push
  // megabytes to render a preview the server can build from its own row.
  const previewPayload = useMemo(() => {
    if (!form) return null;

    // An image design with nothing uploaded has nothing to render. Asking the
    // server anyway returns the built-in fallback layout — correct for a real
    // payslip, badly wrong as a preview, because it shows a stock HTML design
    // the company never chose and did not upload.
    if (form.layout === 'image' && !form.background_image_data_uri) return null;

    // The placer already renders the artwork and the values live, so the image
    // layout only needs a PDF when the user explicitly asks to see one.
    if (form.layout === 'image' && imageMode !== 'pdf') return null;

    const payload: Partial<PayslipTemplateFormData> = { ...form };

    if (template && payload.background_image_data_uri === template.background_image_data_uri) {
      delete payload.background_image_data_uri;
    }
    if (template && payload.custom_template_html === template.custom_template_html) {
      delete payload.custom_template_html;
    }
    if (template && payload.logo_data_uri === template.logo_data_uri) {
      delete payload.logo_data_uri;
    }

    return JSON.stringify(payload);
  }, [form, template, imageMode]);

  // A stale PDF must not survive a switch that invalidates it — otherwise
  // moving from "your own HTML" to an empty uploaded design leaves the HTML
  // render sitting in the panel as if it were the new design.
  useEffect(() => {
    if (previewPayload === null) {
      if (previousUrlRef.current) URL.revokeObjectURL(previousUrlRef.current);
      previousUrlRef.current = null;
      setPreviewUrl(null);
      setPreviewError(null);
    }
  }, [previewPayload]);

  useEffect(() => {
    if (!previewPayload) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await api.post(
          '/hr/payslips/template/preview',
          JSON.parse(previewPayload),
          { responseType: 'blob' },
        );
        if (cancelled) return;

        const url = URL.createObjectURL(res.data as Blob);
        if (previousUrlRef.current) URL.revokeObjectURL(previousUrlRef.current);
        previousUrlRef.current = url;
        setPreviewUrl(url);
        setPreviewError(null);
      } catch (err) {
        // Say WHAT failed. "Preview could not be rendered" is unactionable —
        // a validation problem, an expired session and a render crash all look
        // identical, and the person seeing it cannot tell us which it was.
        if (cancelled) return;

        const status = (err as { response?: { status?: number } })?.response?.status;
        const detail = await readBlobError(err);

        setPreviewError(
          detail
            ? `Preview failed: ${detail}`
            : status
              ? `Preview failed (HTTP ${status}). ${
                  status === 401 || status === 419
                    ? 'Your session may have expired — reload the page.'
                    : 'Try again, or check the server logs.'
                }`
              : 'Preview failed: no response from the server.',
        );
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewPayload, previewNonce]);

  useEffect(() => () => {
    if (previousUrlRef.current) URL.revokeObjectURL(previousUrlRef.current);
  }, []);

  // ── Uploads ─────────────────────────────────────────────────────────────
  const onBackgroundPicked = (file: File | undefined) => {
    if (!file) return;

    if (!/^image\/(png|jpeg|jpg)$/.test(file.type)) {
      toast.error('The payslip design must be a JPEG or PNG image.');
      return;
    }
    if (file.size > MAX_BACKGROUND_BYTES) {
      toast.error('That design is too large. Please use an image under 3MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      let keptPlacements = false;

      setForm((prev) => {
        if (!prev) return prev;

        // Placements only survive a re-upload of the SAME file — a corrected
        // export of the design already on screen. They are percentages, so
        // that case keeps every field exactly where it was even at a different
        // resolution. A DIFFERENT design is a different page, and carrying the
        // old coordinates over scatters values across boxes they do not
        // belong in, which is worse than placing them again.
        const sameDesign =
          Boolean(prev.background_image_name) && prev.background_image_name === file.name;

        keptPlacements = sameDesign && (prev.field_positions ?? []).length > 0;

        return {
          ...prev,
          layout: 'image',
          background_image_data_uri: String(reader.result),
          background_image_name: file.name,
          field_positions: sameDesign ? (prev.field_positions ?? []) : [],
        };
      });

      // Straight to placing: a freshly uploaded design has no fields on it, so
      // landing on the PDF view would show a blank page and look broken.
      setImageMode('place');
      toast.success(
        keptPlacements
          ? `Replaced ${file.name}. Your placed fields were kept.`
          : `Loaded ${file.name}. Click it to place your fields.`,
      );
    };
    reader.onerror = () => toast.error('Could not read that image.');
    reader.readAsDataURL(file);
  };

  const onTemplatePicked = (file: File | undefined) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setForm((prev) =>
        prev
          ? {
              ...prev,
              layout: 'custom',
              custom_template_html: String(reader.result),
              custom_template_name: file.name,
            }
          : prev,
      );
      toast.success(`Loaded ${file.name}. Check the preview, then save.`);
    };
    reader.onerror = () => toast.error('Could not read that file.');
    reader.readAsText(file);
  };

  const dirty = useMemo(
    () => (template && form ? JSON.stringify(toFormData(template)) !== JSON.stringify(form) : false),
    [template, form],
  );

  const placedCount = (form?.field_positions ?? []).length;

  /** The right panel is an editing surface, not a preview, while placing. */
  const isPlacing =
    form?.layout === 'image' && Boolean(form.background_image_data_uri) && imageMode === 'place';

  /** The image layout's PDF view — padded and page-width, like the placer. */
  const isPdfForImage = form?.layout === 'image' && !isPlacing;

  if (isError) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="py-12 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive/60" />
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            Failed to load the payslip design
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    // The whole screen is capped and centred. A payslip designer is a
    // fixed-width tool — spreading two narrow cards across a 1600px monitor is
    // what made this read as an empty black page.
    <div className="mx-auto flex w-full max-w-[1060px] flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Payslip Design</h1>
          <p className="text-xs text-muted-foreground">
            Your own payslip, filled in automatically for each employee. Changes here never affect
            what anyone is paid.
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => template && setForm(toFormData(template))}
                className="h-8 text-xs"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Discard
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => form && updateTemplate.mutate(form)}
              disabled={!dirty || updateTemplate.isPending}
              className="h-8 text-xs"
            >
              {updateTemplate.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              Save design
            </Button>
          </div>
        )}
      </div>

      {/* Both columns are capped and the pair is centred. A payslip is a
          fixed-size document, so letting the panel grow with the monitor just
          stretches an A4 page across a widescreen — the artwork gets a page's
          width and the controls sit beside it, whatever the display. */}
      <div
        className={cn(
          'grid items-start gap-4',
          form?.layout === 'image'
            ? 'lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]'
            : 'lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]',
        )}
      >
        {/* ── Design ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          {isLoading || !form ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </CardContent>
            </Card>
          ) : (
            <>
              {/* One column: at 300px wide, two side-by-side cards forced the
                  titles to wrap mid-phrase ("Upload your / design"). */}
              <Card>
                <CardContent className="flex flex-col gap-2 p-3">
                  {LAYOUTS.map((l) => {
                    const active = form.layout === l.value;
                    return (
                      <button
                        key={l.value}
                        type="button"
                        disabled={!canManage}
                        onClick={() => set('layout', l.value)}
                        className={cn(
                          'rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60',
                          active
                            ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                            : 'border-border hover:bg-muted/40',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold">{l.name}</span>
                          {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                        </div>
                        <p className="mt-0.5 text-[0.65rem] leading-snug text-muted-foreground">
                          {l.blurb}
                        </p>
                      </button>
                    );
                  })}
                </CardContent>
              </Card>

              {/* Upload your design */}
              {form.layout === 'image' && (
                <Card>
                  <CardContent className="space-y-3 p-4">
                    <p className="text-xs font-semibold">Your payslip design</p>

                    <input
                      ref={backgroundInputRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      hidden
                      onChange={(e) => onBackgroundPicked(e.target.files?.[0])}
                    />

                    {form.background_image_name ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
                          <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-[0.7rem]">
                            {form.background_image_name}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[0.65rem] text-muted-foreground">
                            {placedCount} field{placedCount === 1 ? '' : 's'} placed
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!canManage}
                            onClick={() => backgroundInputRef.current?.click()}
                            className="h-7 text-xs"
                          >
                            <Upload className="mr-1.5 h-3 w-3" />
                            Replace
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canManage}
                        onClick={() => backgroundInputRef.current?.click()}
                        className="h-8 w-full text-xs"
                      >
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                        Upload design
                      </Button>
                    )}

                    <p className="text-[0.65rem] leading-snug text-muted-foreground">
                      {form.background_image_data_uri
                        ? 'Click your design on the right where a value belongs.'
                        : 'JPEG or PNG, under 3MB. A full-page A4 export works best.'}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Your own HTML */}
              {form.layout === 'custom' && (
                <Card>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold">Your own HTML</p>
                        <p className="text-[0.65rem] text-muted-foreground">
                          Upload an HTML file, or paste it below. Use the placeholders where each
                          figure should appear.
                        </p>
                      </div>
                      <input
                        ref={templateInputRef}
                        type="file"
                        accept=".html,.htm,text/html"
                        hidden
                        onChange={(e) => onTemplatePicked(e.target.files?.[0])}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canManage}
                        onClick={() => templateInputRef.current?.click()}
                        className="h-8 shrink-0 text-xs"
                      >
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                        Upload HTML
                      </Button>
                    </div>

                    {form.custom_template_name && (
                      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
                        <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate text-[0.7rem]">{form.custom_template_name}</span>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Template HTML</Label>
                        {!form.custom_template_html && canManage && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[0.65rem]"
                            onClick={() => set('custom_template_html', STARTER_TEMPLATE)}
                          >
                            Start from an example
                          </Button>
                        )}
                      </div>
                      <Textarea
                        value={form.custom_template_html ?? ''}
                        disabled={!canManage}
                        onChange={(e) => set('custom_template_html', e.target.value)}
                        spellCheck={false}
                        rows={14}
                        className="font-mono text-[0.68rem] leading-relaxed"
                        placeholder="Paste or upload your payslip HTML…"
                      />
                      <p className="text-[0.65rem] text-muted-foreground">
                        Scripts and embedded documents are not allowed — payslips are rendered on
                        our server. If a design fails to render, we fall back to a plain layout so
                        nobody is left without a payslip.
                      </p>
                    </div>

                    {placeholders && (
                      <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
                        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                          Placeholders
                        </p>
                        <div className="max-h-44 space-y-1 overflow-y-auto">
                          {Object.entries(placeholders.values).map(([key, sample]) => (
                            <div key={key} className="flex items-baseline justify-between gap-3">
                              <code className="text-[0.65rem] text-primary">{`{{ ${key} }}`}</code>
                              <span className="truncate text-[0.62rem] text-muted-foreground">
                                {sample || '—'}
                              </span>
                            </div>
                          ))}
                          {Object.entries(placeholders.lists).map(([key, fields]) => (
                            <div key={key} className="pt-1">
                              <code className="text-[0.65rem] text-primary">
                                {`{{#each ${key} }} … {{/each}}`}
                              </code>
                              <span className="ml-2 text-[0.62rem] text-muted-foreground">
                                inside: {fields.map((f) => `{{ ${f} }}`).join(', ')}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        {/* ── The payslip itself ─────────────────────────────────────── */}
        <div className="xl:sticky xl:top-4 xl:self-start">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isPlacing ? 'Your design' : 'Preview'}
                </span>
                {previewing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>

              {form?.layout === 'image' && form.background_image_data_uri ? (
                <div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
                  {(
                    [
                      ['place', 'Place fields'],
                      ['pdf', 'Preview PDF'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setImageMode(value)}
                      className={cn(
                        'rounded px-2 py-0.5 text-[0.62rem] font-medium transition-colors',
                        imageMode === value
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-[0.62rem] text-muted-foreground">Sample figures</span>
              )}
            </div>

            <CardContent className={cn(form?.layout === 'image' ? 'p-3' : 'p-0')}>
              {/* An uploaded design with no file yet: nothing to preview, and
                  showing the fallback layout here would look like a design the
                  company never chose. */}
              {form?.layout === 'image' && !form.background_image_data_uri ? (
                <div className="mx-auto flex h-[62vh] min-h-[380px] w-full max-w-[600px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border text-center">
                  <ImageIcon className="h-9 w-9 text-muted-foreground/40" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Upload your payslip design
                    </p>
                    <p className="text-[0.65rem] text-muted-foreground">
                      JPEG or PNG, under 3MB. It will appear here to place your fields on.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canManage}
                    onClick={() => backgroundInputRef.current?.click()}
                    className="h-8 text-xs"
                  >
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    Upload design
                  </Button>
                </div>
              ) : isPlacing && form?.background_image_data_uri ? (
                <PayslipFieldPlacer
                  imageDataUri={form.background_image_data_uri}
                  catalogue={imageFields}
                  positions={form.field_positions ?? []}
                  disabled={!canManage}
                  onChange={(next) => set('field_positions', next)}
                />
              ) : previewError ? (
                <div className="mx-auto flex h-[62vh] min-h-[380px] w-full max-w-[600px] flex-col items-center justify-center gap-2 px-8 text-center">
                  <AlertTriangle className="h-6 w-6 text-amber-500/70" />
                  <p className="text-xs font-medium text-foreground">Preview unavailable</p>
                  <p className="text-[0.68rem] leading-relaxed text-muted-foreground">
                    {previewError}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1 h-7 text-xs"
                    onClick={() => setPreviewNonce((n) => n + 1)}
                  >
                    <RotateCcw className="mr-1.5 h-3 w-3" />
                    Try again
                  </Button>
                </div>
              ) : previewUrl ? (
                <iframe
                  src={previewUrl}
                  title="Payslip preview"
                  className={cn(
                    'h-[62vh] min-h-[380px] w-full border-0 bg-white',
                    isPdfForImage && 'mx-auto max-w-[600px] rounded-md border border-border shadow-sm',
                  )}
                />
              ) : (
                <Skeleton
                  className={cn(
                    'h-[62vh] min-h-[380px] w-full',
                    isPdfForImage ? 'mx-auto max-w-[600px]' : 'rounded-none',
                  )}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

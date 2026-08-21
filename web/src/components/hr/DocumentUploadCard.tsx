'use client';

import { useState, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Upload, X, FileText, Image, File, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import {
  DOCUMENT_CATEGORIES,
  documentCategoryLabels,
} from '@/lib/validations/employee';
import { z } from 'zod/v4';

function getFileIcon(mimeType: string) {
  if (mimeType === 'application/pdf') return FileText;
  if (mimeType.startsWith('image/')) return Image;
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPTED_TYPES =
  'application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const multiUploadSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES, { error: 'Please select a category' }),
  expiry_date: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

type MultiUploadInput = z.infer<typeof multiUploadSchema>;

interface SelectedFile {
  file: File;
  title: string;
  error?: string;
}

interface DocumentUploadCardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (formData: FormData) => void;
  isPending: boolean;
}

export function DocumentUploadCard({
  open,
  onOpenChange,
  onUpload,
  isPending,
}: DocumentUploadCardProps) {
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<MultiUploadInput>({
    resolver: zodResolver(multiUploadSchema) as any,
    defaultValues: {
      category: undefined,
      expiry_date: null,
      notes: null,
    },
  });

  const validateFile = useCallback((file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) return 'File too large (max 10MB)';
    const acceptedMimes = ACCEPTED_TYPES.split(',');
    if (!acceptedMimes.includes(file.type)) return 'Unsupported file type';
    return null;
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      setFileError(null);
      const newFiles: SelectedFile[] = [];
      for (const file of Array.from(files)) {
        const error = validateFile(file);
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
        newFiles.push({ file, title: nameWithoutExt, error: error ?? undefined });
      }
      setSelectedFiles((prev) => [...prev, ...newFiles]);
    },
    [validateFile]
  );

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateTitle = useCallback((index: number, title: string) => {
    setSelectedFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, title } : f))
    );
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        e.target.value = '';
      }
    },
    [addFiles]
  );

  const onSubmit = async (data: MultiUploadInput) => {
    const validFiles = selectedFiles.filter((f) => !f.error);
    if (validFiles.length === 0) {
      setFileError('Please select at least one file');
      return;
    }

    for (let i = 0; i < validFiles.length; i++) {
      const formData = new FormData();
      formData.append('file', validFiles[i].file);
      formData.append('title', validFiles[i].title);
      formData.append('category', data.category);
      if (data.expiry_date) formData.append('expiry_date', data.expiry_date);
      if (data.notes) formData.append('notes', data.notes);
      onUpload(formData);
    }
    handleOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      form.reset();
      setSelectedFiles([]);
      setFileError(null);
    }
    onOpenChange(nextOpen);
  };

  const validCount = selectedFiles.filter((f) => !f.error).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Upload Documents</DialogTitle>
          <DialogDescription>
            Select one or more files to upload. Max 10MB each.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4 min-h-0 flex-1"
          >
            {/* Drop zone */}
            <div
              className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 cursor-pointer transition-colors shrink-0 ${
                isDragOver
                  ? 'border-primary bg-primary/5'
                  : fileError
                    ? 'border-destructive'
                    : 'border-border hover:border-primary/50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              aria-label="Drop zone for file upload"
            >
              <Upload className="size-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Drag and drop files, or click to browse
              </p>
              <p className="text-[0.6rem] text-muted-foreground">
                PDF, JPEG, PNG, WebP, DOC, DOCX
              </p>
              {fileError && (
                <p className="text-xs text-destructive">{fileError}</p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                multiple
                onChange={handleInputChange}
                className="hidden"
                aria-hidden="true"
              />
            </div>

            {/* Selected files list */}
            {selectedFiles.length > 0 && (
              <div className="flex flex-col gap-2 overflow-y-auto max-h-[140px] [scrollbar-width:thin] [scrollbar-color:theme(colors.border)_transparent]">
                {selectedFiles.map((sf, idx) => {
                  const Icon = getFileIcon(sf.file.type);
                  return (
                    <div
                      key={`${sf.file.name}-${idx}`}
                      className={`flex items-center gap-2 rounded-md border p-2 ${sf.error ? 'border-destructive/50 bg-destructive/5' : 'border-border'}`}
                    >
                      <Icon className="size-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <Input
                          value={sf.title}
                          onChange={(e) => updateTitle(idx, e.target.value)}
                          className="h-7 text-xs border-0 p-0 shadow-none focus-visible:ring-0"
                          placeholder="Document title"
                        />
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[0.6rem] text-muted-foreground truncate">{sf.file.name}</span>
                          <span className="text-[0.6rem] text-muted-foreground">({formatFileSize(sf.file.size)})</span>
                        </div>
                        {sf.error && <p className="text-[0.6rem] text-destructive mt-0.5">{sf.error}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                        className="rounded-full p-0.5 hover:bg-muted shrink-0"
                        aria-label="Remove file"
                      >
                        <X className="size-3.5 text-muted-foreground" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Shared fields */}
            <div className="grid grid-cols-2 gap-3 shrink-0">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Category</FormLabel>
                    <Select
                      value={field.value ?? ''}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="h-9 text-xs">
                          <span data-slot="select-value" className="flex flex-1 text-left text-xs">
                            {field.value ? documentCategoryLabels[field.value] ?? field.value : <span className="text-muted-foreground">Select category</span>}
                          </span>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectGroup>
                          {DOCUMENT_CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                              {documentCategoryLabels[cat]}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="expiry_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Expiry Date <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        className="h-9 text-xs"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value || null)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="shrink-0">
                  <FormLabel className="text-xs">Notes <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Additional notes..."
                      rows={2}
                      className="text-xs"
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value || null)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2 sm:gap-0 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending || validCount === 0}>
                {isPending && (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                )}
                Upload {validCount > 1 ? `${validCount} Files` : validCount === 1 ? '1 File' : ''}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import {
  FileText,
  Image,
  File,
  Download,
  Trash2,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/utils';
import type { EmployeeDocument } from '@/lib/validations/employee';
import { documentCategoryLabels } from '@/lib/validations/employee';

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

function getExpiryState(
  expiryDate: string | null
): 'none' | 'valid' | 'expiring' | 'expired' {
  if (!expiryDate) return 'none';
  const expiry = new Date(expiryDate);
  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  if (expiry < now) return 'expired';
  if (expiry <= thirtyDaysFromNow) return 'expiring';
  return 'valid';
}

interface DocumentListItemProps {
  document: EmployeeDocument;
  canVerify: boolean;
  canDelete: boolean;
  onVerify?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function DocumentListItem({
  document,
  canVerify,
  canDelete,
  onVerify,
  onDelete,
}: DocumentListItemProps) {
  const Icon = getFileIcon(document.mime_type);
  const expiryState = getExpiryState(document.expiry_date);

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="shrink-0">
        <Icon className="size-8 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm text-foreground truncate">
            {document.title}
          </p>
          {document.is_verified && (
            <CheckCircle2
              className="size-4 text-green-600 dark:text-green-400 shrink-0"
              aria-label="Verified"
            />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge variant="secondary" className="text-[10px]">
            {documentCategoryLabels[document.category] ?? document.category}
          </Badge>
          <span className="text-xs text-muted-foreground truncate">
            {document.file_name}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatFileSize(document.file_size)}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground">
            Uploaded {formatDate(document.created_at)}
          </span>
          {expiryState !== 'none' && (
            <Badge
              variant="outline"
              className={cn(
                'text-[10px]',
                expiryState === 'expired' &&
                  'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
                expiryState === 'expiring' &&
                  'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',
                expiryState === 'valid' &&
                  'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800'
              )}
            >
              {expiryState === 'expired'
                ? 'Expired'
                : expiryState === 'expiring'
                  ? `Expires ${formatDate(document.expiry_date)}`
                  : `Valid until ${formatDate(document.expiry_date)}`}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          render={
            <a
              href={document.download_url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Download ${document.title}`}
            />
          }
        >
          <Download data-icon="inline-start" />
          <span className="hidden sm:inline">Download</span>
        </Button>

        {canVerify && !document.is_verified && onVerify && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onVerify(document.id)}
            aria-label={`Verify ${document.title}`}
          >
            <ShieldCheck data-icon="inline-start" />
            <span className="hidden sm:inline">Verify</span>
          </Button>
        )}

        {canDelete && onDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(document.id)}
            aria-label={`Delete ${document.title}`}
          >
            <Trash2 />
          </Button>
        )}
      </div>
    </div>
  );
}

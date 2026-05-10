'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, apiGet } from '@/lib/api/client';

/**
 * Lazy-loaded file listing for a project. Hits `GET /api/projects/{id}/files`
 * and renders a sortable-by-path table. The button in the header reloads
 * on demand so users don't have to refresh the whole page after the
 * Obsidian plugin pushes changes.
 *
 * Server-side response uses BigInt for size; the route serializes it to
 * a string. We parse it once on display.
 */

interface ApiFile {
  id: string;
  path: string;
  fileType: 'TEXT' | 'BINARY';
  contentHash: string;
  size: string;
  mimeType: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastModifiedById: string | null;
}

export function FilesList({ projectId }: { projectId: string }): ReactElement {
  const t = useTranslations('project');
  const [files, setFiles] = useState<ApiFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { files: data } = await apiGet<{ files: ApiFile[] }>(
        `/api/projects/${projectId}/files`,
      );
      setFiles(data.sort(byPath));
    } catch (err) {
      const msg = err instanceof ApiError ? err.body.error.message : String(err);
      setError(t('filesError', { error: msg }));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t('filesTitle')}</CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCwIcon className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="sr-only">{t('filesRefresh')}</span>
        </Button>
      </CardHeader>
      <CardContent>
        {error && <p className="text-destructive text-sm">{error}</p>}
        {!error && files && files.length === 0 && (
          <p className="text-muted-foreground text-sm">{t('filesEmpty')}</p>
        )}
        {!error && files && files.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('filesPath')}</TableHead>
                <TableHead className="w-24">{t('filesType')}</TableHead>
                <TableHead className="w-28 text-right">{t('filesSize')}</TableHead>
                <TableHead className="w-44">{t('filesUpdated')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs">{f.path}</TableCell>
                  <TableCell>
                    <span className="text-muted-foreground text-xs uppercase">{f.fileType}</span>
                  </TableCell>
                  <TableCell className="text-right text-xs">{formatSize(f.size)}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {new Date(f.updatedAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function byPath(a: ApiFile, b: ApiFile): number {
  return a.path.localeCompare(b.path);
}

function formatSize(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeftIcon } from 'lucide-react';
import { ApiError, apiGet } from '@/lib/api/client';
import type { NoteFile } from '@/lib/notes/types';
import { NotesBrowser } from '@/components/notes/NotesBrowser';

interface ApiFile {
  id: string;
  path: string;
  fileType: 'TEXT' | 'BINARY';
  mimeType: string | null;
}

export default function NotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.ReactElement {
  const t = useTranslations('notes');
  const { id } = use(params);
  const [files, setFiles] = useState<NoteFile[] | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [filesRes, projectRes] = await Promise.all([
        apiGet<{ files: ApiFile[] }>(`/api/projects/${id}/files`),
        apiGet<{ project: { name: string } }>(`/api/projects/${id}`),
      ]);
      setFiles(
        filesRes.files.map((f) => ({
          id: f.id,
          path: f.path,
          fileType: f.fileType,
          mimeType: f.mimeType,
        })),
      );
      setProjectName(projectRes.project.name);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : t('loadError'));
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-destructive">{error}</p>;
  if (!files) return null as unknown as React.ReactElement;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <Link
          href={`/projects/${id}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-4" />
          {projectName || t('back')}
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-lg font-semibold">{t('title')}</h1>
      </header>

      <NotesBrowser projectId={id} files={files} />
    </div>
  );
}

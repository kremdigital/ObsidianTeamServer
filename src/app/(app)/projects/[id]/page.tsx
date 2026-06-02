'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError, apiGet } from '@/lib/api/client';
import type { NoteFile } from '@/lib/notes/types';
import { NotesBrowser } from '@/components/notes/NotesBrowser';

interface ProjectDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconEmoji: string | null;
  ownerId: string;
  _count: { members: number; files: number };
}

interface ApiFile {
  id: string;
  path: string;
  fileType: 'TEXT' | 'BINARY';
  mimeType: string | null;
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations('project');
  const { id } = use(params);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [files, setFiles] = useState<NoteFile[] | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [projectRes, filesRes] = await Promise.all([
        apiGet<{ project: ProjectDetail; role: string | null }>(`/api/projects/${id}`),
        apiGet<{ files: ApiFile[] }>(`/api/projects/${id}/files`),
      ]);
      setProject(projectRes.project);
      setRole(projectRes.role);
      setFiles(
        filesRes.files.map((f) => ({
          id: f.id,
          path: f.path,
          fileType: f.fileType,
          mimeType: f.mimeType,
        })),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : 'Ошибка');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-destructive">{error}</p>;
  if (!project || !files) return null;

  const canManage = role === 'ADMIN';

  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col gap-4">
      <header className="flex shrink-0 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-2xl">{project.iconEmoji ?? '📒'}</span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{project.name}</h1>
            {project.description && (
              <p className="text-muted-foreground truncate text-sm">{project.description}</p>
            )}
          </div>
        </div>
        {canManage && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/projects/${project.id}/settings`}>
              <SettingsIcon className="mr-2 size-4" />
              {t('settings')}
            </Link>
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1">
        <NotesBrowser projectId={project.id} files={files} />
      </div>
    </div>
  );
}

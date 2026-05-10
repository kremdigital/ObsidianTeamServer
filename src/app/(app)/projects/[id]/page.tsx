'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, apiGet } from '@/lib/api/client';
import { FilesList } from './FilesList';

interface ProjectDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconEmoji: string | null;
  ownerId: string;
  _count: { members: number; files: number };
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations('project');
  const tDash = useTranslations('dashboard');
  const { id } = use(params);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { project: p, role: r } = await apiGet<{ project: ProjectDetail; role: string | null }>(
        `/api/projects/${id}`,
      );
      setProject(p);
      setRole(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : 'Ошибка');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-destructive">{error}</p>;
  if (!project) return null;

  const canManage = role === 'ADMIN';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{project.iconEmoji ?? '📒'}</span>
          <div>
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            {project.description && (
              <p className="text-muted-foreground text-sm">{project.description}</p>
            )}
          </div>
        </div>
        {canManage && (
          <Button asChild variant="outline">
            <Link href={`/projects/${project.id}/settings`}>
              <SettingsIcon className="mr-2 size-4" />
              {t('settings')}
            </Link>
          </Button>
        )}
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('metadataTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">slug:</span>{' '}
            <code className="font-mono text-xs">{project.slug}</code>
          </div>
          <div>
            <span className="text-muted-foreground">
              {tDash('memberCount', { count: project._count.members })}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">
              {tDash('fileCount', { count: project._count.files })}
            </span>
          </div>
        </CardContent>
      </Card>

      <FilesList projectId={project.id} />
    </div>
  );
}

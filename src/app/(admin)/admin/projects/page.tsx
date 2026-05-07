'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiGet } from '@/lib/api/client';

interface AdminProject {
  id: string;
  slug: string;
  name: string;
  iconEmoji: string | null;
  ownerId: string;
  owner: { email: string; name: string };
  createdAt: string;
  _count: { members: number; files: number };
}

const fmt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' });

export default function AdminProjectsPage() {
  const t = useTranslations('admin.projects');
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    const { projects: list } = await apiGet<{ projects: AdminProject[] }>(
      `/api/admin/projects?${params.toString()}`,
    );
    setProjects(list);
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('search')}
          className="max-w-sm"
        />
      </header>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('table.name')}</TableHead>
              <TableHead>{t('table.owner')}</TableHead>
              <TableHead>{t('table.members')}</TableHead>
              <TableHead>{t('table.files')}</TableHead>
              <TableHead>{t('table.created')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/projects/${p.id}`} className="hover:underline">
                    {p.iconEmoji ?? '📒'} {p.name}{' '}
                    <span className="text-muted-foreground text-xs">({p.slug})</span>
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{p.owner.email}</TableCell>
                <TableCell>{p._count.members}</TableCell>
                <TableCell>{p._count.files}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {fmt.format(new Date(p.createdAt))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiGet } from '@/lib/api/client';

interface UserDetail {
  id: string;
  email: string;
  name: string;
  role: string;
  emailVerified: string | null;
  disabledAt: string | null;
  createdAt: string;
  _count: { ownedProjects: number; memberships: number; apiKeys: number };
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
}

const fmt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

export default function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations('admin.userDetail');
  const { id } = use(params);
  const [user, setUser] = useState<UserDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ user: UserDetail; auditLogs: AuditEntry[] }>(
        `/api/admin/users/${id}`,
      );
      setUser(data.user);
      setAudit(data.auditLogs);
    } catch (err) {
      void err;
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Link href="/admin/users" className="text-muted-foreground text-sm hover:underline">
        {t('back')}
      </Link>
      <h1 className="text-2xl font-semibold">{user.name}</h1>
      <p className="text-muted-foreground">{user.email}</p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('stats')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <span className="text-muted-foreground">{t('ownedProjects')}: </span>
            <b>{user._count.ownedProjects}</b>
          </div>
          <div>
            <span className="text-muted-foreground">{t('memberships')}: </span>
            <b>{user._count.memberships}</b>
          </div>
          <div>
            <span className="text-muted-foreground">{t('apiKeys')}: </span>
            <b>{user._count.apiKeys}</b>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('auditTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('noAudit')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Время</TableHead>
                  <TableHead>Действие</TableHead>
                  <TableHead>Сущность</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground text-xs">
                      {fmt.format(new Date(e.createdAt))}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.action}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {e.entityType}
                      {e.entityId ? ` / ${e.entityId.slice(0, 8)}…` : ''}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{e.ip ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

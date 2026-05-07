'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiGet } from '@/lib/api/client';

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
  user: { id: string; email: string; name: string } | null;
}

const fmt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

export default function AdminAuditLogPage() {
  const t = useTranslations('admin.auditLog');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filters, setFilters] = useState({
    userId: '',
    action: '',
    entityType: '',
    from: '',
    to: '',
  });

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v) params.set(k, v);
    }
    const data = await apiGet<{ entries: AuditEntry[] }>(
      `/api/admin/audit-log?${params.toString()}`,
    );
    setEntries(data.entries);
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3 lg:grid-cols-5">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t('filterUser')}</Label>
          <Input
            value={filters.userId}
            onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t('filterAction')}</Label>
          <Input
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t('filterEntity')}</Label>
          <Input
            value={filters.entityType}
            onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t('filterFrom')}</Label>
          <Input
            type="datetime-local"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t('filterTo')}</Label>
          <Input
            type="datetime-local"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </div>
        <div className="flex items-end gap-2 sm:col-span-3 lg:col-span-5">
          <Button
            variant="outline"
            type="button"
            onClick={() => setFilters({ userId: '', action: '', entityType: '', from: '', to: '' })}
          >
            {t('reset')}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('table.when')}</TableHead>
              <TableHead>{t('table.user')}</TableHead>
              <TableHead>{t('table.action')}</TableHead>
              <TableHead>{t('table.entity')}</TableHead>
              <TableHead>{t('table.ip')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center text-sm">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-muted-foreground text-xs">
                  {fmt.format(new Date(e.createdAt))}
                </TableCell>
                <TableCell className="text-sm">{e.user?.email ?? '—'}</TableCell>
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
      </div>
    </div>
  );
}

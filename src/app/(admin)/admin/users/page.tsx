'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CheckIcon, LockIcon, ShieldCheckIcon, Trash2Icon, UnlockIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { UserRole } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ApiError, apiGet } from '@/lib/api/client';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  emailVerified: string | null;
  disabledAt: string | null;
  createdAt: string;
}

export default function AdminUsersPage() {
  const t = useTranslations('admin.users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    try {
      const { users: list } = await apiGet<{ users: AdminUser[] }>(
        `/api/admin/users?${params.toString()}`,
      );
      setUsers(list);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.body.error.message : 'Ошибка');
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchUser(id: string, body: Record<string, unknown>) {
    await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await load();
  }

  async function deleteUser(id: string) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error?.message ?? 'Не удалось удалить');
      return;
    }
    await load();
  }

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
              <TableHead>{t('table.email')}</TableHead>
              <TableHead>{t('table.role')}</TableHead>
              <TableHead>{t('table.verified')}</TableHead>
              <TableHead>{t('table.disabled')}</TableHead>
              <TableHead className="w-1" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <Link href={`/admin/users/${u.id}`} className="hover:underline">
                    {u.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{u.email}</TableCell>
                <TableCell>
                  <span className="font-mono text-xs">{u.role}</span>
                </TableCell>
                <TableCell>
                  {u.emailVerified ? (
                    <CheckIcon className="size-4 text-green-600" />
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void patchUser(u.id, { emailVerified: true })}
                    >
                      <ShieldCheckIcon className="mr-1 size-4" />
                      {t('verify')}
                    </Button>
                  )}
                </TableCell>
                <TableCell>
                  {u.disabledAt ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void patchUser(u.id, { disabled: false })}
                    >
                      <UnlockIcon className="mr-1 size-4" />
                      {t('unblock')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void patchUser(u.id, { disabled: true })}
                    >
                      <LockIcon className="mr-1 size-4" />
                      {t('block')}
                    </Button>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('delete')}
                    onClick={() => setConfirmDelete(u)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title={t('deleteDialog.title')}
        description={t('deleteDialog.description')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={async () => {
          if (confirmDelete) await deleteUser(confirmDelete.id);
        }}
      />
    </div>
  );
}

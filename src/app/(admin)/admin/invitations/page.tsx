'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckIcon, CopyIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
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
import { ApiError, apiGet, apiPost } from '@/lib/api/client';

interface ServerInvitation {
  id: string;
  email: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  invitedBy: { id: string; email: string; name: string };
}

const fmt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' });

export default function AdminInvitationsPage() {
  const t = useTranslations('admin.invitations');
  const [list, setList] = useState<ServerInvitation[]>([]);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { invitations } = await apiGet<{ invitations: ServerInvitation[] }>(
      '/api/admin/invitations',
    );
    setList(invitations);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const { url } = await apiPost<{ url: string }>('/api/admin/invitations', { email });
      setCreatedUrl(url);
      setEmail('');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.body.error.message : 'Ошибка');
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/admin/invitations/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    await load();
  }

  async function handleCopy() {
    if (!createdUrl) return;
    await navigator.clipboard.writeText(createdUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      <form onSubmit={create} className="flex max-w-xl items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="inv-email">{t('email')}</Label>
          <Input
            id="inv-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <Button type="submit" disabled={pending || !email}>
          {t('create')}
        </Button>
      </form>

      {createdUrl && (
        <div className="bg-muted/30 flex max-w-xl items-center gap-2 rounded-md border p-2">
          <code className="flex-1 font-mono text-xs break-all">{createdUrl}</code>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
            {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
            <span className="ml-1">{copied ? t('copied') : t('copyLink')}</span>
          </Button>
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('table.email')}</TableHead>
              <TableHead>{t('table.invitedBy')}</TableHead>
              <TableHead>{t('table.expires')}</TableHead>
              <TableHead>{t('table.created')}</TableHead>
              <TableHead className="w-1" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>{inv.email}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {inv.invitedBy.name}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {fmt.format(new Date(inv.expiresAt))}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {fmt.format(new Date(inv.createdAt))}
                </TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('revoke')}
                    onClick={() => void revoke(inv.id)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

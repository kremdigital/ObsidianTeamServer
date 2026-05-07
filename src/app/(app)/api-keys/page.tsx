'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckIcon, CopyIcon, KeyRoundIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ApiError, apiGet, apiPost } from '@/lib/api/client';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface CreatedKey extends ApiKey {
  plain: string;
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDate(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return dateFormatter.format(new Date(value));
}

export default function ApiKeysPage() {
  const t = useTranslations('apiKeys');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [keyToDelete, setKeyToDelete] = useState<ApiKey | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const { keys: list } = await apiGet<{ keys: ApiKey[] }>('/api/api-keys');
      setKeys(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  async function handleDelete(key: ApiKey) {
    try {
      await fetch(`/api/api-keys/${key.id}`, { method: 'DELETE', credentials: 'include' });
      toast.success(t('toasts.deleted'));
      await loadKeys();
    } catch {
      toast.error(t('toasts.deleteFailed'));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon className="mr-2 size-4" />
          {t('createButton')}
        </Button>
      </header>

      {!loading && keys.length === 0 && (
        <EmptyState
          icon={<KeyRoundIcon className="size-10" />}
          title={t('empty.title')}
          description={t('empty.text')}
        />
      )}

      {keys.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table.name')}</TableHead>
                <TableHead>{t('table.prefix')}</TableHead>
                <TableHead>{t('table.lastUsed')}</TableHead>
                <TableHead>{t('table.created')}</TableHead>
                <TableHead>{t('table.expires')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell className="font-mono text-xs">{key.keyPrefix}…</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(key.lastUsedAt, '—')}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(key.createdAt, '—')}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(key.expiresAt, t('table.never'))}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('table.delete')}
                      onClick={() => setKeyToDelete(key)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {createOpen && (
        <CreateKeyDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(created) => {
            setCreateOpen(false);
            setCreatedKey(created);
            void loadKeys();
          }}
        />
      )}

      <CreatedKeyDialog keyData={createdKey} onClose={() => setCreatedKey(null)} />

      <ConfirmDialog
        open={Boolean(keyToDelete)}
        onOpenChange={(open) => !open && setKeyToDelete(null)}
        title={t('deleteDialog.title')}
        description={t('deleteDialog.description')}
        confirmLabel={t('deleteDialog.confirm')}
        destructive
        onConfirm={async () => {
          if (keyToDelete) await handleDelete(keyToDelete);
        }}
      />
    </div>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (key: CreatedKey) => void;
}) {
  const t = useTranslations('apiKeys');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { key } = await apiPost<{ key: CreatedKey }>('/api/api-keys', { name });
      onCreated(key);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : t('toasts.createFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createDialog.title')}</DialogTitle>
          <DialogDescription>{t('createDialog.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="key-name">{t('createDialog.nameLabel')}</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              maxLength={100}
            />
            {error && <p className="text-destructive text-xs">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {t('createDialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreatedKeyDialog({
  keyData,
  onClose,
}: {
  keyData: CreatedKey | null;
  onClose: () => void;
}) {
  const t = useTranslations('apiKeys');
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!keyData) return;
    await navigator.clipboard.writeText(keyData.plain);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={Boolean(keyData)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createdDialog.title')}</DialogTitle>
          <DialogDescription className="text-destructive">
            {t('createdDialog.warning')}
          </DialogDescription>
        </DialogHeader>
        {keyData && (
          <div className="flex flex-col gap-2">
            <div className="bg-muted/30 flex items-center gap-2 rounded-md border p-2">
              <code className="flex-1 font-mono text-xs break-all">{keyData.plain}</code>
              <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                <span className="ml-1">
                  {copied ? t('createdDialog.copied') : t('createdDialog.copy')}
                </span>
              </Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>{t('createdDialog.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

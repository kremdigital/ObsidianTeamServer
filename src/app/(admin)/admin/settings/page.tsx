'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiGet } from '@/lib/api/client';

interface Settings {
  openRegistration?: boolean;
  smtpEnabled?: boolean;
  defaultUserRole?: 'USER' | 'SUPERADMIN';
  publicUrl?: string;
}

export default function AdminSettingsPage() {
  const t = useTranslations('admin.settings');
  const [s, setS] = useState<Settings>({});
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const { settings } = await apiGet<{ settings: Settings }>('/api/admin/settings');
    setS(settings);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(s),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error?.message ?? 'Ошибка');
        return;
      }
      toast.success(t('saved'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      <form onSubmit={save} className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('openRegistration')}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={Boolean(s.openRegistration)}
              onChange={(e) => setS({ ...s, openRegistration: e.target.checked })}
            />
            <p className="text-muted-foreground text-sm">{t('openRegistrationDescription')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('smtpEnabled')}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={Boolean(s.smtpEnabled)}
              onChange={(e) => setS({ ...s, smtpEnabled: e.target.checked })}
            />
            <p className="text-muted-foreground text-sm">{t('smtpEnabledDescription')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('publicUrl')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="public-url" className="sr-only">
              {t('publicUrl')}
            </Label>
            <Input
              id="public-url"
              type="url"
              value={s.publicUrl ?? ''}
              onChange={(e) => setS({ ...s, publicUrl: e.target.value })}
              placeholder="https://example.com"
            />
            <p className="text-muted-foreground text-sm">{t('publicUrlDescription')}</p>
          </CardContent>
        </Card>

        <Button type="submit" disabled={pending} className="self-start">
          {t('save')}
        </Button>
      </form>
    </div>
  );
}

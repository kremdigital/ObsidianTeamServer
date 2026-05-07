'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/components/auth/AuthProvider';

export default function ProfilePage() {
  const t = useTranslations('profile');
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t('name')}</Label>
            <Input value={user.name} readOnly />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('email')}</Label>
            <Input value={user.email} readOnly />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('language')}</Label>
            <Input value={user.language.toUpperCase()} readOnly />
          </div>
          <p className="text-muted-foreground pt-2 text-xs">
            Редактирование профиля — будет добавлено вместе с админкой пользователей.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

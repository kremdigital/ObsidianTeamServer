'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/forms/FormField';
import { FormError } from '@/components/forms/FormError';
import { ApiError, apiPost } from '@/lib/api/client';

const schema = z.object({
  password: z.string().min(8, 'Пароль должен быть не короче 8 символов').max(128),
});
type FormValues = z.infer<typeof schema>;

export default function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const t = useTranslations('auth.resetPassword');
  const { token } = use(params);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '' },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await apiPost('/api/auth/reset-password', { token, password: values.password });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.body.error.code === 'invalid_token') {
        setServerError(t('invalidToken'));
      } else if (err instanceof ApiError) {
        setServerError(err.body.error.message);
      } else {
        setServerError('Сетевая ошибка');
      }
    }
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('successTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{t('successText')}</p>
          <div className="mt-6">
            <Link href="/login" className="text-sm font-medium hover:underline">
              {t('loginLink')} →
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </CardHeader>
      <CardContent>
        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormError message={serverError} />

            <FormField<FormValues> name="password" label={t('password')}>
              {(field) => (
                <Input
                  id={field.id}
                  type="password"
                  autoComplete="new-password"
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  name={field.name}
                  aria-invalid={field['aria-invalid']}
                />
              )}
            </FormField>

            <Button type="submit" disabled={methods.formState.isSubmitting}>
              {t('submit')}
            </Button>
          </form>
        </FormProvider>
      </CardContent>
    </Card>
  );
}

'use client';

import { useState } from 'react';
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

const schema = z.object({ email: z.string().email('Некорректный email') });
type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const t = useTranslations('auth.forgotPassword');
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await apiPost('/api/auth/forgot-password', values);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) setServerError(err.body.error.message);
      else setServerError('Сетевая ошибка');
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
              ← {t('backToLogin')}
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

            <FormField<FormValues> name="email" label={t('email')}>
              {(field) => (
                <Input
                  id={field.id}
                  type="email"
                  autoComplete="email"
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

            <Link
              href="/login"
              className="text-muted-foreground text-center text-sm hover:underline"
            >
              ← {t('backToLogin')}
            </Link>
          </form>
        </FormProvider>
      </CardContent>
    </Card>
  );
}

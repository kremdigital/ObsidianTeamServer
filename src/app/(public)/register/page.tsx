'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
  email: z.string().email('Некорректный email'),
  name: z.string().min(1, 'Введите имя').max(100),
  password: z.string().min(8, 'Пароль должен быть не короче 8 символов').max(128),
});
type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const t = useTranslations('auth.register');
  const params = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);

  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', name: '', password: '' },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const inviteToken = params.get('invite');
    try {
      await apiPost('/api/auth/register', {
        ...values,
        ...(inviteToken ? { inviteToken } : {}),
      });
      setDoneEmail(values.email);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.body.error.code === 'email_taken') setServerError(t('emailTaken'));
        else if (err.status === 403) setServerError(t('closed'));
        else setServerError(err.body.error.message);

        if (err.body.error.fields) {
          for (const [field, msgs] of Object.entries(err.body.error.fields)) {
            if (field in values) {
              methods.setError(field as keyof FormValues, { message: msgs[0] ?? '' });
            }
          }
        }
      } else {
        setServerError('Сетевая ошибка');
      }
    }
  }

  if (doneEmail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('successTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{t('successText', { email: doneEmail })}</p>
          <div className="mt-6">
            <Link href="/login" className="text-sm font-medium hover:underline">
              ← {t('loginLink')}
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

            <FormField<FormValues> name="name" label={t('name')}>
              {(field) => (
                <Input
                  id={field.id}
                  autoComplete="name"
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  name={field.name}
                  aria-invalid={field['aria-invalid']}
                />
              )}
            </FormField>

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

            <p className="text-muted-foreground pt-2 text-center text-sm">
              {t('haveAccount')}{' '}
              <Link href="/login" className="text-foreground font-medium hover:underline">
                {t('loginLink')}
              </Link>
            </p>
          </form>
        </FormProvider>
      </CardContent>
    </Card>
  );
}

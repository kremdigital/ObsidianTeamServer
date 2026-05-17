'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
  password: z.string().min(1, 'Введите пароль'),
  rememberMe: z.boolean().optional(),
});
type FormValues = z.infer<typeof schema>;

/**
 * Client island for the login card. The server-rendered `page.tsx` fetches
 * the `openRegistration` flag from the DB and hands it down; this island
 * uses it to decide whether the "Sign up" prompt should be rendered. When
 * registration is closed, exposing the link would just send users into a
 * 403 — better to hide it.
 */
export function LoginForm({ openRegistration }: { openRegistration: boolean }) {
  return (
    <Suspense fallback={null}>
      <LoginFormInner openRegistration={openRegistration} />
    </Suspense>
  );
}

function LoginFormInner({ openRegistration }: { openRegistration: boolean }) {
  const t = useTranslations('auth.login');
  const router = useRouter();
  const params = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);

  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await apiPost('/api/auth/login', {
        email: values.email,
        password: values.password,
        rememberMe: values.rememberMe === true,
      });
      router.replace(params.get('next') ?? '/dashboard');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setServerError(t('invalidCredentials'));
      } else if (err instanceof ApiError) {
        setServerError(err.body.error.message);
      } else {
        setServerError('Сетевая ошибка');
      }
    }
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

            <FormField<FormValues> name="password" label={t('password')}>
              {(field) => (
                <Input
                  id={field.id}
                  type="password"
                  autoComplete="current-password"
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  name={field.name}
                  aria-invalid={field['aria-invalid']}
                />
              )}
            </FormField>

            <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="text-foreground accent-foreground h-4 w-4"
                {...methods.register('rememberMe')}
              />
              {t('rememberMe')}
            </label>

            <Button type="submit" disabled={methods.formState.isSubmitting}>
              {t('submit')}
            </Button>

            <div className="flex flex-col items-center gap-2 pt-2 text-sm">
              <Link href="/forgot-password" className="text-muted-foreground hover:underline">
                {t('forgotPassword')}
              </Link>
              {openRegistration && (
                <p className="text-muted-foreground">
                  {t('noAccount')}{' '}
                  <Link href="/register" className="text-foreground font-medium hover:underline">
                    {t('register')}
                  </Link>
                </p>
              )}
            </div>
          </form>
        </FormProvider>
      </CardContent>
    </Card>
  );
}

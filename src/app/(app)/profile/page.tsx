'use client';

import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/forms/FormField';
import { FormError } from '@/components/forms/FormError';
import { useAuth, type AuthUser } from '@/components/auth/AuthProvider';
import { ApiError, apiPatch } from '@/lib/api/client';

/**
 * Self-service profile editor. Fields submit only when they actually
 * changed (the server-side PATCH is idempotent — it also diffs against
 * the current row — but skipping no-ops on the client saves a roundtrip
 * when the user opens the page and immediately clicks Save without
 * touching anything).
 *
 * Email is editable but flagged with a hint that a change resets the
 * `emailVerified` timestamp. The full re-verification flow (token email)
 * is not yet wired here — administrators can verify manually until that
 * lands.
 *
 * Language is a one-option dropdown today (`ru` only). Kept as a select
 * so adding `en` is a one-line follow-up.
 */
const schema = z.object({
  name: z.string().trim().min(1, 'Имя не может быть пустым').max(100),
  email: z.string().email('Некорректный email').max(254),
  language: z.string().min(2).max(10),
});
type FormValues = z.infer<typeof schema>;

const LANGUAGE_OPTIONS = [{ value: 'ru', label: 'Русский' }] as const;

export default function ProfilePage() {
  const t = useTranslations('profile');
  const { user, setUser } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  if (!user) return null;

  return (
    <ProfileForm
      user={user}
      setUser={setUser}
      t={t}
      serverError={serverError}
      setServerError={setServerError}
    />
  );
}

function ProfileForm({
  user,
  setUser,
  t,
  serverError,
  setServerError,
}: {
  user: AuthUser;
  setUser: (u: AuthUser | null) => void;
  t: ReturnType<typeof useTranslations>;
  serverError: string | null;
  setServerError: (s: string | null) => void;
}) {
  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: user.name,
      email: user.email,
      language: user.language,
    },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);

    // Send only the fields that actually changed — keeps the audit log
    // trail compact and skips the email-re-verification reset when the
    // user opens-and-saves without editing the email.
    const patch: Partial<FormValues> = {};
    if (values.name !== user.name) patch.name = values.name;
    if (values.email !== user.email) patch.email = values.email;
    if (values.language !== user.language) patch.language = values.language;

    if (Object.keys(patch).length === 0) {
      toast.info(t('noChanges'));
      return;
    }

    try {
      const res = await apiPatch<{ user: AuthUser }>('/api/auth/me', patch);
      setUser(res.user);
      methods.reset({
        name: res.user.name,
        email: res.user.email,
        language: res.user.language,
      });
      toast.success(t('saved'));
      if (patch.email) {
        toast.warning(t('emailReVerifyHint'), { duration: 6000 });
      }
    } catch (err) {
      if (err instanceof ApiError && err.body.error.code === 'email_taken') {
        methods.setError('email', { message: t('emailTaken') });
        return;
      }
      if (err instanceof ApiError && err.body.error.fields) {
        for (const [field, msgs] of Object.entries(err.body.error.fields)) {
          methods.setError(field as keyof FormValues, { message: msgs[0] ?? '' });
        }
        return;
      }
      setServerError(err instanceof ApiError ? err.body.error.message : 'Сетевая ошибка');
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FormProvider {...methods}>
            <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <FormError message={serverError} />

              <FormField<FormValues> name="name" label={t('name')}>
                {(field) => (
                  <Input
                    id={field.id}
                    type="text"
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

              <FormField<FormValues> name="language" label={t('language')}>
                {(field) => (
                  <select
                    id={field.id}
                    name={field.name}
                    value={(field.value as string) ?? ''}
                    onChange={(e) => field.onChange(e.target.value)}
                    onBlur={field.onBlur}
                    className="border-input bg-background text-foreground h-9 rounded-md border px-3 text-sm"
                    aria-invalid={field['aria-invalid']}
                  >
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>

              <Button
                type="submit"
                disabled={methods.formState.isSubmitting || !methods.formState.isDirty}
              >
                {t('save')}
              </Button>
            </form>
          </FormProvider>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, apiPost } from '@/lib/api/client';

type Status = 'pending' | 'success' | 'error';

export default function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const t = useTranslations('auth.verifyEmail');
  const { token } = use(params);
  const [status, setStatus] = useState<Status>('pending');

  useEffect(() => {
    let cancelled = false;
    apiPost('/api/auth/verify-email', { token })
      .then(() => {
        if (!cancelled) setStatus('success');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) setStatus('error');
        else setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {status === 'pending' && t('verifying')}
          {status === 'success' && t('successTitle')}
          {status === 'error' && t('errorTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {status === 'success' && (
          <>
            <p className="text-muted-foreground text-sm">{t('successText')}</p>
            <div className="mt-6">
              <Link href="/login" className="text-sm font-medium hover:underline">
                {t('loginLink')} →
              </Link>
            </div>
          </>
        )}
        {status === 'error' && (
          <>
            <p className="text-muted-foreground text-sm">{t('errorText')}</p>
            <div className="mt-6">
              <Link href="/login" className="text-sm font-medium hover:underline">
                ← {t('loginLink')}
              </Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, apiGet, apiPost } from '@/lib/api/client';

interface ServerInviteInfo {
  type: 'server';
  email: string;
}
interface ProjectInviteInfo {
  type: 'project';
  email: string | null;
  role: string;
  projectName: string;
}
type InviteInfo = ServerInviteInfo | ProjectInviteInfo;

interface CurrentUser {
  email: string;
  name: string;
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const t = useTranslations('invitePage');
  const { token } = use(params);
  const router = useRouter();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<{ projectId: string; alreadyMember: boolean } | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<InviteInfo>(`/api/auth/invite/${encodeURIComponent(token)}`);
        if (cancelled) return;

        if (data.type === 'server') {
          router.replace(`/register?invite=${encodeURIComponent(token)}`);
          return;
        }

        setInfo(data);

        // Try to read current user (may 401 silently — user might not be logged in).
        try {
          const me = await apiGet<{ user: CurrentUser }>('/api/auth/me');
          setUser(me.user);
        } catch {
          // not logged in — handled below
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.body.error.message : t('invalid'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router, t]);

  async function handleAccept() {
    setPending(true);
    try {
      const res = await apiPost<{ projectId: string; alreadyMember: boolean }>(
        '/api/auth/accept-invite',
        { token },
      );
      setAccepted(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : t('invalid'));
    } finally {
      setPending(false);
    }
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('invalid')}</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (!info || info.type !== 'project') {
    return (
      <Card>
        <CardContent className="text-muted-foreground p-6 text-sm">{t('loading')}</CardContent>
      </Card>
    );
  }

  if (accepted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{accepted.alreadyMember ? t('alreadyMember') : t('accepted')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={`/projects/${accepted.projectId}`}>{t('openProject')}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('projectTitle', { name: info.projectName })}</CardTitle>
        <p className="text-muted-foreground text-sm">{t('projectText', { role: info.role })}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!user && (
          <>
            <p className="text-muted-foreground text-sm">{t('loginRequired')}</p>
            <Button asChild>
              <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Войти</Link>
            </Button>
          </>
        )}
        {user && info.email && info.email.toLowerCase() !== user.email.toLowerCase() && (
          <p className="text-destructive text-sm">{t('wrongEmail', { email: info.email })}</p>
        )}
        {user && (!info.email || info.email.toLowerCase() === user.email.toLowerCase()) && (
          <Button onClick={() => void handleAccept()} disabled={pending}>
            {t('accept')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

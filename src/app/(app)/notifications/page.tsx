import { useTranslations } from 'next-intl';
import { BellIcon } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';

export default function NotificationsPage() {
  const t = useTranslations('notifications');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <EmptyState
        icon={<BellIcon className="size-10" />}
        title={t('title')}
        description={t('soon')}
      />
    </div>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BellIcon, FolderIcon, KeyRoundIcon, UserCircleIcon, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  labelKey: 'dashboard' | 'profile' | 'apiKeys' | 'notifications';
  icon: LucideIcon;
}

const ITEMS: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard', icon: FolderIcon },
  { href: '/profile', labelKey: 'profile', icon: UserCircleIcon },
  { href: '/api-keys', labelKey: 'apiKeys', icon: KeyRoundIcon },
  { href: '/notifications', labelKey: 'notifications', icon: BellIcon },
];

export function Sidebar() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  return (
    <aside className="bg-muted/20 hidden w-56 shrink-0 border-r px-3 py-4 md:block">
      <nav className="flex flex-col gap-1">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

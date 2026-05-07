'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ClipboardListIcon,
  FolderIcon,
  MailIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  labelKey: 'users' | 'projects' | 'invitations' | 'settings' | 'auditLog';
  icon: LucideIcon;
}

const ITEMS: NavItem[] = [
  { href: '/admin/users', labelKey: 'users', icon: UsersIcon },
  { href: '/admin/projects', labelKey: 'projects', icon: FolderIcon },
  { href: '/admin/invitations', labelKey: 'invitations', icon: MailIcon },
  { href: '/admin/settings', labelKey: 'settings', icon: SettingsIcon },
  { href: '/admin/audit-log', labelKey: 'auditLog', icon: ClipboardListIcon },
];

export function AdminSidebar() {
  const t = useTranslations('admin.nav');
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

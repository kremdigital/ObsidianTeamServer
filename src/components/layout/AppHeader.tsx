'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronDownIcon, LogOutIcon, UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/auth/AuthProvider';

export function AppHeader() {
  const t = useTranslations('nav');
  const { user, logout } = useAuth();

  return (
    <header className="bg-background sticky top-0 z-30 flex h-14 items-center justify-between border-b px-6">
      <Link href="/dashboard" className="text-base font-semibold">
        Obsidian Sync
      </Link>

      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2">
              <UserIcon className="size-4" />
              <span>{user.name}</span>
              <ChevronDownIcon className="size-4 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              {user.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile">{t('profile')}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/api-keys">{t('apiKeys')}</Link>
            </DropdownMenuItem>
            {user.role === 'SUPERADMIN' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/admin/users">{t('admin')}</Link>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void logout()}>
              <LogOutIcon className="mr-2 size-4" />
              {t('logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  );
}

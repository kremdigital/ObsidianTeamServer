import { redirect } from 'next/navigation';
import { type ReactNode } from 'react';
import { getCurrentUser } from '@/lib/auth/session';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { AppHeader } from '@/components/layout/AppHeader';
import { Sidebar } from '@/components/layout/Sidebar';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const initialUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified ? user.emailVerified.toISOString() : null,
    language: user.language,
  };

  return (
    <AuthProvider initialUser={initialUser}>
      <div className="flex flex-1 flex-col">
        <AppHeader />
        <div className="flex flex-1">
          <Sidebar />
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
    </AuthProvider>
  );
}

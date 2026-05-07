import type { ReactNode } from 'react';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted/30 flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

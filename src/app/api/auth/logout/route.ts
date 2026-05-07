import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { hashJti, verifyRefreshToken } from '@/lib/auth/jwt';
import { clearAccessCookie, clearRefreshCookie, readRefreshCookie } from '@/lib/auth/cookies';

export async function POST(): Promise<NextResponse> {
  const refresh = await readRefreshCookie();
  if (refresh) {
    const payload = await verifyRefreshToken(refresh);
    if (payload) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashJti(payload.jti), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }
  await Promise.all([clearRefreshCookie(), clearAccessCookie()]);
  return NextResponse.json({ success: true });
}

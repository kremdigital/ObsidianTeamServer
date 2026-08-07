import { NextResponse } from 'next/server';
import { errors } from '@/lib/http/errors';
import { refreshFailureMessage, refreshSessionCookies } from '@/lib/auth/refresh-session';

export async function POST(request: Request): Promise<NextResponse> {
  const result = await refreshSessionCookies(request);
  if (!result.ok) {
    return errors.unauthorized(refreshFailureMessage(result.reason));
  }
  return NextResponse.json({ accessToken: result.accessToken });
}

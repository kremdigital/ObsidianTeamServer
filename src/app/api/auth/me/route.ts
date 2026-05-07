import { NextResponse } from 'next/server';
import { errors } from '@/lib/http/errors';
import { getCurrentUser } from '@/lib/auth/session';

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
      language: user.language,
    },
  });
}

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { errors } from '@/lib/http/errors';
import { getCurrentUser } from '@/lib/auth/session';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  const { id } = await context.params;

  try {
    const result = await prisma.apiKey.deleteMany({
      where: { id, userId: user.id },
    });
    if (result.count === 0) {
      return errors.notFound('API-ключ не найден');
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return errors.notFound('API-ключ не найден');
    }
    throw err;
  }

  return NextResponse.json({ success: true });
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { getCurrentUser } from '@/lib/auth/session';
import { generateApiKey } from '@/lib/auth/api-key';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(100),
  expiresAt: z.string().datetime().optional(),
});

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  const keys = await prisma.apiKey.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ keys });
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;

  const generated = await generateApiKey();

  const created = await prisma.apiKey.create({
    data: {
      userId: user.id,
      name: parsed.data.name,
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      ...(parsed.data.expiresAt ? { expiresAt: new Date(parsed.data.expiresAt) } : {}),
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      key: { ...created, plain: generated.plain },
    },
    { status: 201 },
  );
}

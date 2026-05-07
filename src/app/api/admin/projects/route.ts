import { NextResponse } from 'next/server';
import { type Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { requireSuperAdmin } from '@/lib/auth/admin';

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const search = (url.searchParams.get('search') ?? '').trim();
  const where: Prisma.ProjectWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { slug: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};

  const projects = await prisma.project.findMany({
    where,
    select: {
      id: true,
      slug: true,
      name: true,
      iconEmoji: true,
      ownerId: true,
      owner: { select: { email: true, name: true } },
      createdAt: true,
      _count: { select: { members: true, files: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return NextResponse.json({ projects });
}

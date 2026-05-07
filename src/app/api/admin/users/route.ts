import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { requireSuperAdmin } from '@/lib/auth/admin';
import { hashPassword } from '@/lib/auth/password';
import { readAuditClientMeta, recordAuditLog } from '@/lib/audit/record';

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 200;

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(128),
  role: z.enum(['USER', 'SUPERADMIN']).default('USER'),
});

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const search = (url.searchParams.get('search') ?? '').trim();
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(url.searchParams.get('pageSize') ?? PAGE_SIZE_DEFAULT)),
  );

  const where: Prisma.UserWhereInput = search
    ? {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        disabledAt: true,
        language: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { ownedProjects: true, memberships: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({ users, page, pageSize, total });
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody(request, createUserSchema);
  if (!parsed.ok) return parsed.response;

  const email = parsed.data.email.trim().toLowerCase();
  const passwordHash = await hashPassword(parsed.data.password);

  try {
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: parsed.data.name,
        role: parsed.data.role,
        emailVerified: new Date(),
      },
      select: { id: true, email: true, name: true, role: true },
    });

    const meta = readAuditClientMeta(request);
    await recordAuditLog({
      userId: auth.user.id,
      action: 'admin.user.create',
      entityType: 'User',
      entityId: created.id,
      metadata: { email: created.email, role: created.role },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return NextResponse.json({ user: created }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return errors.conflict('email_taken', 'Этот email уже занят');
    }
    throw err;
  }
}

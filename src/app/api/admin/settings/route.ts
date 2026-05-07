import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { parseJsonBody } from '@/lib/http/errors';
import { requireSuperAdmin } from '@/lib/auth/admin';
import { readAuditClientMeta, recordAuditLog } from '@/lib/audit/record';

const ALLOWED_KEYS = ['openRegistration', 'smtpEnabled', 'defaultUserRole', 'publicUrl'] as const;

const patchSchema = z.object({
  openRegistration: z.boolean().optional(),
  smtpEnabled: z.boolean().optional(),
  defaultUserRole: z.enum(['USER', 'SUPERADMIN']).optional(),
  publicUrl: z.string().url().optional(),
});

export async function GET(): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const rows = await prisma.serverConfig.findMany({
    where: { key: { in: [...ALLOWED_KEYS] } },
    select: { key: true, value: true, updatedAt: true },
  });
  const settings: Record<string, unknown> = {};
  for (const row of rows) settings[row.key] = row.value;
  return NextResponse.json({ settings });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;

  const updates: Array<[string, Prisma.InputJsonValue]> = [];
  for (const key of ALLOWED_KEYS) {
    const value = parsed.data[key];
    if (value !== undefined) updates.push([key, value as Prisma.InputJsonValue]);
  }

  await prisma.$transaction(
    updates.map(([key, value]) =>
      prisma.serverConfig.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      }),
    ),
  );

  const meta = readAuditClientMeta(request);
  await recordAuditLog({
    userId: auth.user.id,
    action: 'admin.settings.update',
    entityType: 'ServerConfig',
    metadata: parsed.data as Prisma.InputJsonValue,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ success: true });
}

import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { requireSuperAdmin } from '@/lib/auth/admin';
import { readAuditClientMeta, recordAuditLog } from '@/lib/audit/record';
import { sendMail, serverInvitationMessage } from '@/lib/email';

const TTL_MS = 14 * 24 * 60 * 60 * 1000;

const createSchema = z.object({
  email: z.string().email(),
});

export async function GET(): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const invitations = await prisma.serverInvitation.findMany({
    where: { acceptedAt: null },
    select: {
      id: true,
      email: true,
      token: true,
      expiresAt: true,
      createdAt: true,
      invitedBy: { select: { id: true, email: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ invitations });
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;

  const email = parsed.data.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return errors.conflict('user_exists', 'Пользователь с таким email уже зарегистрирован');
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TTL_MS);

  const invitation = await prisma.serverInvitation.create({
    data: {
      email,
      token,
      invitedById: auth.user.id,
      expiresAt,
    },
    select: { id: true, email: true, token: true, expiresAt: true, createdAt: true },
  });

  await sendMail(serverInvitationMessage({ to: email, inviterName: auth.user.name, token }));

  const meta = readAuditClientMeta(request);
  await recordAuditLog({
    userId: auth.user.id,
    action: 'admin.invitation.create',
    entityType: 'ServerInvitation',
    entityId: invitation.id,
    metadata: { email },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  const publicUrl = (process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return NextResponse.json({ invitation, url: `${publicUrl}/invite/${token}` }, { status: 201 });
}

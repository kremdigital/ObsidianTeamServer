import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { getCurrentUser } from '@/lib/auth/session';
import { canManageMembers, loadProjectAccess } from '@/lib/auth/permissions';
import { projectInvitationMessage, sendMail } from '@/lib/email';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

const createSchema = z
  .object({
    email: z.string().email().optional(),
    role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']),
    shareLink: z.boolean().optional(),
  })
  .refine((v) => v.shareLink === true || typeof v.email === 'string', {
    message: 'Either email or shareLink:true must be provided',
    path: ['email'],
  });

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  const { id } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canManageMembers(user, access)) return errors.forbidden();

  const invitations = await prisma.projectInvitation.findMany({
    where: { projectId: id, acceptedAt: null },
    select: {
      id: true,
      email: true,
      role: true,
      token: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ invitations });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  const { id } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canManageMembers(user, access)) return errors.forbidden();

  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;

  const project = await prisma.project.findUnique({
    where: { id },
    select: { name: true },
  });
  if (!project) return errors.notFound('Проект не найден');

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const email = parsed.data.email?.trim().toLowerCase() ?? null;

  const invitation = await prisma.projectInvitation.create({
    data: {
      projectId: id,
      role: parsed.data.role,
      token,
      invitedById: user.id,
      expiresAt,
      ...(email ? { email } : {}),
    },
    select: {
      id: true,
      email: true,
      role: true,
      token: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  if (email) {
    await sendMail(
      projectInvitationMessage({
        to: email,
        projectName: project.name,
        inviterName: user.name,
        token,
      }),
    );
  }

  const publicUrl = (process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return NextResponse.json(
    {
      invitation,
      url: `${publicUrl}/invite/${token}`,
    },
    { status: 201 },
  );
}

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { getCurrentUser } from '@/lib/auth/session';

const schema = z.object({
  token: z.string().min(1).max(256),
});

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = await parseJsonBody(request, schema);
  if (!parsed.ok) return parsed.response;

  const user = await getCurrentUser();
  if (!user) return errors.unauthorized('Войдите, чтобы принять приглашение');

  const invitation = await prisma.projectInvitation.findUnique({
    where: { token: parsed.data.token },
    select: {
      id: true,
      projectId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      invitedById: true,
    },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return errors.invalid('invalid_invite', 'Приглашение недействительно или истекло');
  }

  if (invitation.email && invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    return errors.invalid('invite_email_mismatch', 'Email не совпадает с приглашением');
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.projectMember.create({
        data: {
          projectId: invitation.projectId,
          userId: user.id,
          role: invitation.role,
          ...(invitation.invitedById ? { addedById: invitation.invitedById } : {}),
        },
      });
      await tx.projectInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date(), acceptedById: user.id },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Already a member — still mark invitation accepted to avoid stale tokens.
      await prisma.projectInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date(), acceptedById: user.id },
      });
      return NextResponse.json({ projectId: invitation.projectId, alreadyMember: true });
    }
    throw err;
  }

  return NextResponse.json({ projectId: invitation.projectId, alreadyMember: false });
}

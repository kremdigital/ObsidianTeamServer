import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { errors } from '@/lib/http/errors';

/**
 * Public invite-introspection endpoint. Used by the /invite/[token] UI page
 * before authentication to know whether this is a server-invitation
 * (→ register flow) or a project-invitation (→ accept flow).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;

  const projectInvite = await prisma.projectInvitation.findUnique({
    where: { token },
    select: {
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      project: { select: { name: true } },
    },
  });
  if (projectInvite) {
    if (projectInvite.acceptedAt || projectInvite.expiresAt < new Date()) {
      return errors.invalid('invalid_invite', 'Приглашение недействительно или истекло');
    }
    return NextResponse.json({
      type: 'project',
      email: projectInvite.email,
      role: projectInvite.role,
      projectName: projectInvite.project.name,
    });
  }

  const serverInvite = await prisma.serverInvitation.findUnique({
    where: { token },
    select: { email: true, expiresAt: true, acceptedAt: true },
  });
  if (serverInvite) {
    if (serverInvite.acceptedAt || serverInvite.expiresAt < new Date()) {
      return errors.invalid('invalid_invite', 'Приглашение недействительно или истекло');
    }
    return NextResponse.json({ type: 'server', email: serverInvite.email });
  }

  return errors.notFound('Приглашение не найдено');
}

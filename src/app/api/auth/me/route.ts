import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { authenticateRequest } from '@/lib/auth/authenticate';
import { getCurrentUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { updateProfileSchema } from '@/lib/auth/schemas';
import { readAuditClientMeta, recordAuditLog } from '@/lib/audit/record';

/**
 * Identity probe used by both the web UI (cookie / Bearer access token) and
 * the Obsidian plugin (X-API-Key). Returns the authenticated user, including
 * fields the web UI relies on (`role`, `emailVerified`, `language`).
 *
 * The plugin only needs `id` / `email` / `name`, but it's fine — and simpler —
 * to ship the full payload from one endpoint than to keep two near-duplicate
 * routes in sync.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const actor = await authenticateRequest(request);
  if (!actor) return errors.unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { emailVerified: true, language: true },
  });
  if (!user) return errors.unauthorized();

  return NextResponse.json({
    user: {
      id: actor.id,
      email: actor.email,
      name: actor.name,
      role: actor.role,
      emailVerified: user.emailVerified,
      language: user.language,
    },
  });
}

/**
 * Self-service profile update. Limited to the cookie / Bearer session
 * flow on purpose — accepting X-API-Key here would let a stolen plugin
 * key change a user's email out from under them, which is exactly the
 * scenario API-key revocation is supposed to defend against.
 *
 * A changed email resets `emailVerified` so the user has to re-verify
 * via the existing verification flow before any email-gated feature
 * trusts the new address again.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const me = await getCurrentUser();
  if (!me) return errors.unauthorized();

  const parsed = await parseJsonBody(request, updateProfileSchema);
  if (!parsed.ok) return parsed.response;

  const data: Prisma.UserUpdateInput = {};
  const audit: Record<string, unknown> = {};

  if (parsed.data.name !== undefined && parsed.data.name !== me.name) {
    data.name = parsed.data.name;
    audit.name = parsed.data.name;
  }

  if (parsed.data.language !== undefined && parsed.data.language !== me.language) {
    data.language = parsed.data.language;
    audit.language = parsed.data.language;
  }

  if (parsed.data.email !== undefined) {
    const newEmail = parsed.data.email.trim().toLowerCase();
    if (newEmail !== me.email) {
      const existing = await prisma.user.findUnique({
        where: { email: newEmail },
        select: { id: true },
      });
      if (existing) {
        return errors.conflict('email_taken', 'Этот email уже зарегистрирован');
      }
      data.email = newEmail;
      data.emailVerified = null;
      audit.email = newEmail;
      audit.emailVerifiedReset = true;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ user: me });
  }

  const updated = await prisma.user.update({
    where: { id: me.id },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerified: true,
      language: true,
    },
  });

  const meta = readAuditClientMeta(request);
  await recordAuditLog({
    userId: me.id,
    action: 'auth.profile.update',
    entityType: 'User',
    entityId: me.id,
    metadata: audit as Prisma.InputJsonValue,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ user: updated });
}

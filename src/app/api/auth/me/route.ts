import { NextResponse } from 'next/server';
import { errors } from '@/lib/http/errors';
import { authenticateRequest } from '@/lib/auth/authenticate';
import { prisma } from '@/lib/db/client';

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

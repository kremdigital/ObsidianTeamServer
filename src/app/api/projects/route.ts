import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { authenticateRequest } from '@/lib/auth/authenticate';
import { getCurrentUser } from '@/lib/auth/session';
import { generateUniqueSlug } from '@/lib/projects/slug';

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  iconEmoji: z.string().max(8).optional(),
});

// GET accepts either session auth (web UI) or X-API-Key (Obsidian plugin).
// POST stays session-only — we don't expose project creation to the plugin
// for now; users create projects in the web UI before binding from the
// plugin.
export async function GET(request: Request): Promise<NextResponse> {
  const actor = await authenticateRequest(request);
  if (!actor) return errors.unauthorized();

  const projects = await prisma.project.findMany({
    where: {
      OR: [{ ownerId: actor.id }, { members: { some: { userId: actor.id } } }],
    },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      iconEmoji: true,
      ownerId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { members: true, files: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json({ projects });
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;

  const slug = await generateUniqueSlug(parsed.data.name);

  const project = await prisma.project.create({
    data: {
      slug,
      name: parsed.data.name,
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.iconEmoji !== undefined ? { iconEmoji: parsed.data.iconEmoji } : {}),
      ownerId: user.id,
      members: {
        create: { userId: user.id, role: 'ADMIN', addedById: user.id },
      },
    },
    select: { id: true, slug: true, name: true, description: true, iconEmoji: true, ownerId: true },
  });

  return NextResponse.json({ project }, { status: 201 });
}

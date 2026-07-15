import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '@/lib/db/client';
import { errors } from '@/lib/http/errors';
import { authenticateRequest } from '@/lib/auth/authenticate';
import { canManageMembers, loadProjectAccess } from '@/lib/auth/permissions';
import { getProjectRoot } from '@/lib/files/paths';

const bodySchema = z
  .object({
    olderThanDays: z.number().int().nonnegative().optional(),
    fileType: z.enum(['TEXT', 'BINARY']).optional(),
  })
  .strict();

// Bound each deleteMany's bound-parameter count well under Postgres' 65535
// wire limit so a very large tombstone backlog can't overflow it.
const CHUNK = 1_000;

/**
 * Hard-delete tombstoned (soft-deleted) files in a project, together with
 * their `OperationLog` entries and on-disk bytes / version snapshots.
 *
 * This is the durable counterpart to soft-delete. `applyDelete` only sets
 * `deletedAt` and removes the live bytes — the row and its CREATE op live
 * forever, so a replayed CREATE could revive the file. Purging removes them
 * for good, and gives a supported way to reclaim storage without hand-written
 * SQL. ADMIN / project owner / SUPERADMIN only.
 *
 * Body (optional JSON):
 *   { olderThanDays?: number; fileType?: 'TEXT' | 'BINARY' }
 *   - olderThanDays omitted / 0 → purge every tombstone;
 *     N → only tombstones deleted more than N days ago.
 *   - fileType → restrict to a single file type.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await authenticateRequest(request);
  if (!user) return errors.unauthorized();

  const { id } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canManageMembers(user, access)) return errors.forbidden();

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) return errors.invalid('invalid_body', 'Invalid purge parameters');
  const { olderThanDays, fileType } = parsed.data;
  const cutoff =
    olderThanDays && olderThanDays > 0 ? new Date(Date.now() - olderThanDays * 86_400_000) : null;

  // Whole DB side runs in one interactive transaction. The tombstones are
  // re-read *and locked* (`FOR UPDATE`) inside it, so a file concurrently
  // revived into a LIVE row is either excluded (revive committed first) or its
  // revive blocks until we finish (revive loses) — never a live file destroyed.
  const { opsCount, purged } = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "VaultFile"
        WHERE "projectId" = ${id}
          AND "deletedAt" IS NOT NULL
          ${cutoff ? Prisma.sql`AND "deletedAt" < ${cutoff}` : Prisma.empty}
          ${fileType ? Prisma.sql`AND "fileType"::text = ${fileType}` : Prisma.empty}
        FOR UPDATE
      `);
      if (rows.length === 0) return { opsCount: 0, purged: rows };

      const fileIds = rows.map((r) => r.id);

      // OperationLog has no fileId column, but every op records its file's id
      // in `payload.fileId`. Match on THAT, not on path strings: a path can
      // have been reused by a different, still-live file whose CREATE/RENAME
      // history we must not delete (deleting it breaks that live file's
      // catch-up — binaries silently vanish on fresh clients).
      let opsCount = 0;
      for (let i = 0; i < fileIds.length; i += CHUNK) {
        const chunk = fileIds.slice(i, i + CHUNK);
        const r = await tx.operationLog.deleteMany({
          where: {
            projectId: id,
            OR: chunk.map((fid) => ({ payload: { path: ['fileId'], equals: fid } })),
          },
        });
        opsCount += r.count;
      }

      // The rows are locked as tombstones, so `deletedAt: { not: null }` is
      // belt-and-suspenders. Cascade removes FileVersion + YjsDocument rows.
      for (let i = 0; i < fileIds.length; i += CHUNK) {
        await tx.vaultFile.deleteMany({
          where: { id: { in: fileIds.slice(i, i + CHUNK) }, deletedAt: { not: null } },
        });
      }

      return { opsCount, purged: rows };
    },
    { timeout: 120_000 },
  );

  if (purged.length === 0) {
    return NextResponse.json({ files: 0, operations: 0, versionDirsRemoved: 0 });
  }

  // Disk cleanup: only the per-file `.versions/<fileId>/` directory, which the
  // DB cascade does not reach. Cleanup is keyed by fileId (safe) — NOT by path.
  // A tombstone's live-path bytes were already removed by `applyDelete`, and
  // deleting by path here would be a data-loss hazard: the transaction frees
  // the tombstone's path, and a client may create a brand-new live file at that
  // same path before this loop runs — unlinking it by path would destroy it.
  const versionsRoot = join(getProjectRoot(id), '.versions');
  let versionDirsRemoved = 0;
  for (const t of purged) {
    try {
      await rm(join(versionsRoot, t.id), { recursive: true });
      versionDirsRemoved += 1;
    } catch {
      // No version snapshots for this file — nothing to remove.
    }
  }

  return NextResponse.json({
    files: purged.length,
    operations: opsCount,
    versionDirsRemoved,
  });
}

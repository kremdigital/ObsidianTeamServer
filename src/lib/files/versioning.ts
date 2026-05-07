import { prisma } from '@/lib/db/client';
import { writeVersionSnapshot } from './storage';

export interface RecordedVersion {
  id: string;
  versionNumber: number;
  contentHash: string;
  createdAt: Date;
}

/**
 * Snapshot the given content for a file and record a `FileVersion` row.
 * Skips creation when the new content hash matches the most recent version.
 */
export async function recordFileVersion(opts: {
  projectId: string;
  fileId: string;
  data: Buffer | Uint8Array;
  contentHash: string;
  authorId: string | null;
  message?: string | null;
}): Promise<RecordedVersion | null> {
  const last = await prisma.fileVersion.findFirst({
    where: { fileId: opts.fileId },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true, contentHash: true },
  });

  if (last && last.contentHash === opts.contentHash) {
    return null;
  }

  const versionNumber = (last?.versionNumber ?? 0) + 1;
  const snapshotPath = await writeVersionSnapshot(
    opts.projectId,
    opts.fileId,
    versionNumber,
    opts.data,
  );

  const created = await prisma.fileVersion.create({
    data: {
      fileId: opts.fileId,
      versionNumber,
      contentHash: opts.contentHash,
      snapshotPath,
      ...(opts.authorId ? { authorId: opts.authorId } : {}),
      ...(opts.message ? { message: opts.message } : {}),
    },
    select: { id: true, versionNumber: true, contentHash: true, createdAt: true },
  });

  return created;
}

import { NextResponse } from 'next/server';
import { lookup as lookupMime } from 'mime-types';
import { Prisma, type FileType } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { errors } from '@/lib/http/errors';
import { authenticateRequest, getMaxFileSize } from '@/lib/auth/authenticate';
import { canEditFiles, canViewProject, loadProjectAccess } from '@/lib/auth/permissions';
import { writeProjectFile } from '@/lib/files/storage';
import { InvalidPathError, normalizeVaultPath } from '@/lib/files/paths';
import { recordFileVersion } from '@/lib/files/versioning';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await authenticateRequest(request);
  if (!user) return errors.unauthorized();

  const { id } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canViewProject(user, access)) return errors.forbidden();

  const url = new URL(request.url);
  const includeDeleted = url.searchParams.get('includeDeleted') === 'true';

  const files = await prisma.vaultFile.findMany({
    where: {
      projectId: id,
      ...(includeDeleted ? {} : { deletedAt: null }),
    },
    select: {
      id: true,
      path: true,
      fileType: true,
      contentHash: true,
      size: true,
      mimeType: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      lastModifiedById: true,
    },
    orderBy: { path: 'asc' },
  });

  return NextResponse.json({
    files: files.map((f) => ({ ...f, size: f.size.toString() })),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await authenticateRequest(request);
  if (!user) return errors.unauthorized();

  const { id } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canEditFiles(user, access)) return errors.forbidden();

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return errors.invalid('expected_multipart', 'Ожидается multipart/form-data');
  }

  const form = await request.formData();
  const rawPath = form.get('path');
  const rawFile = form.get('file');

  if (typeof rawPath !== 'string' || !rawPath) {
    return errors.invalid('path_required', 'Параметр path обязателен');
  }
  if (!(rawFile instanceof Blob)) {
    return errors.invalid('file_required', 'Файл обязателен');
  }

  let normalizedPath: string;
  try {
    normalizedPath = normalizeVaultPath(rawPath);
  } catch (err) {
    if (err instanceof InvalidPathError) {
      return errors.invalid('invalid_path', err.message);
    }
    throw err;
  }

  const max = getMaxFileSize();
  if (max !== null && rawFile.size > max) {
    return errors.invalid('file_too_large', `Файл больше ${max} байт`);
  }

  const buffer = Buffer.from(await rawFile.arrayBuffer());

  const written = await writeProjectFile(id, normalizedPath, buffer);

  const detectedMime =
    typeof rawFile.type === 'string' && rawFile.type.length > 0
      ? rawFile.type
      : lookupMime(normalizedPath) || 'application/octet-stream';

  const fileType: FileType = isTextLike(normalizedPath, detectedMime) ? 'TEXT' : 'BINARY';

  try {
    const file = await prisma.vaultFile.create({
      data: {
        projectId: id,
        path: normalizedPath,
        fileType,
        contentHash: written.contentHash,
        size: BigInt(written.size),
        mimeType: detectedMime,
        lastModifiedById: user.id,
      },
      select: {
        id: true,
        path: true,
        fileType: true,
        contentHash: true,
        size: true,
        mimeType: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await recordFileVersion({
      projectId: id,
      fileId: file.id,
      data: buffer,
      contentHash: written.contentHash,
      authorId: user.id,
    });

    return NextResponse.json({ file: { ...file, size: file.size.toString() } }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return errors.conflict('path_exists', 'Файл с таким путём уже существует');
    }
    throw err;
  }
}

function isTextLike(path: string, mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (
    path.endsWith('.md') ||
    path.endsWith('.txt') ||
    path.endsWith('.json') ||
    path.endsWith('.yml') ||
    path.endsWith('.yaml') ||
    path.endsWith('.csv')
  )
    return true;
  return false;
}

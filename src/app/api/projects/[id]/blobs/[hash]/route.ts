import { NextResponse } from 'next/server';
import { authenticateRequest, getMaxFileSize } from '@/lib/auth/authenticate';
import { canEditFiles, loadProjectAccess } from '@/lib/auth/permissions';
import { errors } from '@/lib/http/errors';
import { corsPreflight, withCors } from '@/lib/http/cors';
import { writeStagedBlob } from '@/lib/files/storage';
import { sha256OfBuffer } from '@/lib/files/hash';

interface RouteContext {
  params: Promise<{ id: string; hash: string }>;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

export async function OPTIONS(request: Request): Promise<Response> {
  return corsPreflight(request);
}

/**
 * Stage a content-addressed binary blob for a subsequent metadata-only
 * `file:create` / `file:update-binary` socket event. This keeps multi-megabyte
 * binary payloads off the Socket.IO channel (sized for tiny Yjs ops): the
 * plugin PUTs the bytes here over `fetch`, then emits a small socket op that
 * tells the sync handler to fold the staged blob into the vault by hash.
 *
 * Idempotent (re-PUTting the same hash rewrites the blob). The blob is removed
 * by the socket handler once consumed, or by an orphan sweep otherwise.
 */
export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const user = await authenticateRequest(request);
  if (!user) return withCors(errors.unauthorized(), request);

  const { id, hash } = await context.params;
  if (!SHA256_HEX.test(hash)) {
    return withCors(errors.invalid('invalid_hash', 'Invalid content hash'), request);
  }

  const access = await loadProjectAccess(user, id);
  if (!access) return withCors(errors.notFound('Проект не найден'), request);
  if (!canEditFiles(user, access)) return withCors(errors.forbidden(), request);

  const buffer = Buffer.from(await request.arrayBuffer());

  const max = getMaxFileSize();
  if (max !== null && buffer.byteLength > max) {
    return withCors(errors.invalid('file_too_large', `Файл больше ${max} байт`), request);
  }

  // Integrity: the staged blob must match the hash it's addressed by, so the
  // socket handler can trust the bytes it folds in (and so a corrupted upload
  // never masquerades as a valid file).
  if (sha256OfBuffer(buffer) !== hash) {
    return withCors(errors.invalid('hash_mismatch', 'Содержимое не соответствует хешу'), request);
  }

  const written = await writeStagedBlob(id, hash, buffer);
  return withCors(NextResponse.json({ hash: written.contentHash, size: written.size }), request);
}

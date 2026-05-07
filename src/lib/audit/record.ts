import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { auditLogger, logger } from '@/lib/logger';

export interface AuditEntry {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Record an audit log entry — both into the DB (`AuditLog`) and into the
 * structured audit-log file via pino. Failures of either path are logged but
 * never thrown — auditing must not block primary actions.
 */
export async function recordAuditLog(entry: AuditEntry): Promise<void> {
  // 1) File-based audit (separate `audit.log` rotated file in production).
  auditLogger.info(
    {
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    },
    'audit',
  );

  // 2) DB-backed audit (queryable from `/admin/audit-log`).
  try {
    await prisma.auditLog.create({
      data: {
        ...(entry.userId ? { userId: entry.userId } : {}),
        action: entry.action,
        entityType: entry.entityType,
        ...(entry.entityId ? { entityId: entry.entityId } : {}),
        ...(entry.metadata !== undefined && entry.metadata !== null
          ? { metadata: entry.metadata }
          : {}),
        ...(entry.ip ? { ip: entry.ip } : {}),
        ...(entry.userAgent ? { userAgent: entry.userAgent } : {}),
      },
    });
  } catch (err) {
    logger.warn({ err, entry }, 'audit-log DB write failed');
  }
}

export function readAuditClientMeta(request: Request): {
  ip: string | null;
  userAgent: string | null;
} {
  const fwd = request.headers.get('x-forwarded-for');
  const ip = fwd ? (fwd.split(',')[0]?.trim() ?? null) : request.headers.get('x-real-ip');
  return { ip, userAgent: request.headers.get('user-agent') };
}

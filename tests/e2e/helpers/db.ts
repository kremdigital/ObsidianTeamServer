import { rm } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const TEST_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://obsidian:obsidian@localhost:5432/obsidian_sync_test';

const adapter = new PrismaPg({ connectionString: TEST_DATABASE_URL });
export const e2ePrisma = new PrismaClient({ adapter, log: ['error'] });

const TRUNCATE_ORDER = [
  'AuditLog',
  'OperationLog',
  'FileVersion',
  'YjsDocument',
  'VaultFile',
  'ProjectInvitation',
  'ServerInvitation',
  'ProjectMember',
  'Project',
  'ApiKey',
  'RefreshToken',
  'PasswordResetToken',
  'EmailVerificationToken',
  'User',
  'ServerConfig',
] as const;

const STORAGE_ROOT = './storage-e2e';

export async function resetE2eDatabase(): Promise<void> {
  const tables = TRUNCATE_ORDER.map((t) => `"${t}"`).join(', ');
  await e2ePrisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`);
  await rm(STORAGE_ROOT, { recursive: true, force: true });
}

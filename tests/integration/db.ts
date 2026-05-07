import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://obsidian:obsidian@localhost:5432/obsidian_sync_test';

const adapter = new PrismaPg({ connectionString: TEST_DATABASE_URL });
export const testPrisma = new PrismaClient({ adapter, log: ['error'] });

// Order matters: child tables first.
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

export async function resetDatabase(): Promise<void> {
  const tables = TRUNCATE_ORDER.map((t) => `"${t}"`).join(', ');
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`);
}

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? '';

  if (!adminEmail || !adminPassword) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env to run the seed.');
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      role: UserRole.SUPERADMIN,
    },
    create: {
      email: adminEmail,
      passwordHash,
      name: 'Super Admin',
      role: UserRole.SUPERADMIN,
      emailVerified: new Date(),
      language: 'ru',
    },
  });

  const openRegistration = (process.env.OPEN_REGISTRATION ?? 'false').toLowerCase() === 'true';

  await prisma.serverConfig.upsert({
    where: { key: 'openRegistration' },
    update: { value: openRegistration },
    create: { key: 'openRegistration', value: openRegistration },
  });

  await prisma.serverConfig.upsert({
    where: { key: 'smtpEnabled' },
    update: {},
    create: { key: 'smtpEnabled', value: Boolean(process.env.SMTP_HOST) },
  });

  await prisma.serverConfig.upsert({
    where: { key: 'defaultUserRole' },
    update: {},
    create: { key: 'defaultUserRole', value: 'USER' },
  });

  console.log(`Seed complete. Superadmin: ${admin.email} (id=${admin.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: connectionString,
  },
});

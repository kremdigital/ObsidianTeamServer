import { vi } from 'vitest';

interface SentMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const sentMails: SentMail[] = [];

vi.mock('@/lib/email', async () => {
  const actual = await vi.importActual<typeof import('@/lib/email')>('@/lib/email');
  return {
    ...actual,
    sendMail: vi.fn(async (msg: SentMail) => {
      sentMails.push(msg);
    }),
  };
});

(globalThis as { __sentMails?: SentMail[] }).__sentMails = sentMails;

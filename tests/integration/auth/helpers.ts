import { resetDatabase, testPrisma } from '../db';

interface SentMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function resetAndConfigureRegistration(open: boolean): Promise<void> {
  await resetDatabase();
  await testPrisma.serverConfig.create({
    data: { key: 'openRegistration', value: open },
  });
}

export function makeRequest(url: string, body: unknown): Request {
  return new Request(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getMailsBucket(): SentMail[] {
  const g = globalThis as { __sentMails?: SentMail[] };
  if (!g.__sentMails) g.__sentMails = [];
  return g.__sentMails;
}

export function getSentMails(): readonly SentMail[] {
  return getMailsBucket();
}

export function clearSentMails(): void {
  const list = getMailsBucket();
  list.length = 0;
}

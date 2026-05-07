import { mkdir, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
  describe(): string;
}

let cached: MailTransport | null = null;

export function getMailTransport(): MailTransport {
  if (cached) return cached;
  cached = buildTransport();
  return cached;
}

export function resetMailTransportForTests(): void {
  cached = null;
}

function buildTransport(): MailTransport {
  const host = process.env.SMTP_HOST;
  if (host) {
    return new SmtpTransport(buildSmtpTransporter(host));
  }
  return new FileTransport();
}

function buildSmtpTransporter(host: string): Transporter {
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER ?? '';
  const pass = process.env.SMTP_PASSWORD ?? '';
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });
}

class SmtpTransport implements MailTransport {
  constructor(private readonly transporter: Transporter) {}

  async send(message: MailMessage): Promise<void> {
    const from = process.env.SMTP_FROM ?? 'no-reply@obsidian-sync.local';
    await this.transporter.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }

  describe(): string {
    return `smtp://${process.env.SMTP_HOST}:${process.env.SMTP_PORT ?? 587}`;
  }
}

class FileTransport implements MailTransport {
  private readonly logFile = join(process.env.LOG_DIR ?? './logs', 'emails.log');

  async send(message: MailMessage): Promise<void> {
    const entry = [
      `=== ${new Date().toISOString()} ===`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      '--- text ---',
      message.text,
      '--- html ---',
      message.html,
      '',
    ].join('\n');

    await mkdir(dirname(this.logFile), { recursive: true });
    await appendFile(this.logFile, entry + '\n', 'utf8');

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[email:dev] -> ${message.to} | ${message.subject}`);
    }
  }

  describe(): string {
    return `file://${this.logFile}`;
  }
}

import type { MailMessage } from './transport';

function publicUrl(): string {
  return (process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111;">
${body}
<hr style="margin-top:32px;border:none;border-top:1px solid #ddd"/>
<p style="font-size:12px;color:#666">Obsidian Team</p>
</body></html>`;
}

export function verifyEmailMessage(input: {
  to: string;
  name: string;
  token: string;
}): MailMessage {
  const link = `${publicUrl()}/verify-email/${encodeURIComponent(input.token)}`;
  const subject = 'Подтверждение адреса электронной почты';
  const text = `Здравствуйте, ${input.name}!

Подтвердите ваш email, перейдя по ссылке: ${link}

Ссылка действительна 24 часа. Если вы не регистрировались — проигнорируйте письмо.`;
  const html = wrapHtml(
    subject,
    `<h1>Здравствуйте, ${escapeHtml(input.name)}!</h1>
     <p>Подтвердите ваш email, нажав на кнопку:</p>
     <p><a href="${link}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Подтвердить email</a></p>
     <p>Или скопируйте ссылку: <code>${escapeHtml(link)}</code></p>
     <p>Ссылка действительна 24 часа. Если вы не регистрировались — проигнорируйте письмо.</p>`,
  );
  return { to: input.to, subject, html, text };
}

export function passwordResetMessage(input: {
  to: string;
  name: string;
  token: string;
}): MailMessage {
  const link = `${publicUrl()}/reset-password/${encodeURIComponent(input.token)}`;
  const subject = 'Восстановление пароля';
  const text = `Здравствуйте, ${input.name}!

Если вы запросили восстановление пароля, перейдите по ссылке: ${link}

Ссылка действительна 1 час. Если запрос — не ваш, проигнорируйте письмо.`;
  const html = wrapHtml(
    subject,
    `<h1>Восстановление пароля</h1>
     <p>Если вы запросили восстановление, нажмите кнопку:</p>
     <p><a href="${link}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Сбросить пароль</a></p>
     <p>Или скопируйте ссылку: <code>${escapeHtml(link)}</code></p>
     <p>Ссылка действительна 1 час. Если запрос — не ваш, проигнорируйте письмо.</p>`,
  );
  return { to: input.to, subject, html, text };
}

export function projectInvitationMessage(input: {
  to: string;
  projectName: string;
  inviterName: string;
  token: string;
}): MailMessage {
  const link = `${publicUrl()}/invite/${encodeURIComponent(input.token)}`;
  const subject = `Приглашение в проект «${input.projectName}»`;
  const text = `${input.inviterName} приглашает вас в проект «${input.projectName}» на Obsidian Team.

Принять приглашение: ${link}`;
  const html = wrapHtml(
    subject,
    `<h1>Приглашение в проект</h1>
     <p><b>${escapeHtml(input.inviterName)}</b> приглашает вас в проект <b>${escapeHtml(input.projectName)}</b> на Obsidian Team.</p>
     <p><a href="${link}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Принять приглашение</a></p>
     <p>Или скопируйте ссылку: <code>${escapeHtml(link)}</code></p>`,
  );
  return { to: input.to, subject, html, text };
}

export function serverInvitationMessage(input: {
  to: string;
  inviterName: string;
  token: string;
}): MailMessage {
  const link = `${publicUrl()}/invite/${encodeURIComponent(input.token)}`;
  const subject = 'Приглашение на сервер Obsidian Team';
  const text = `${input.inviterName} приглашает вас на сервер Obsidian Team.

Перейдите для регистрации: ${link}`;
  const html = wrapHtml(
    subject,
    `<h1>Приглашение на сервер</h1>
     <p><b>${escapeHtml(input.inviterName)}</b> приглашает вас на сервер Obsidian Team.</p>
     <p><a href="${link}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Зарегистрироваться</a></p>
     <p>Или скопируйте ссылку: <code>${escapeHtml(link)}</code></p>`,
  );
  return { to: input.to, subject, html, text };
}

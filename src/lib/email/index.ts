import { getMailTransport, type MailMessage } from './transport';

export type { MailMessage } from './transport';
export {
  verifyEmailMessage,
  passwordResetMessage,
  projectInvitationMessage,
  serverInvitationMessage,
} from './templates';

export async function sendMail(message: MailMessage): Promise<void> {
  const transport = getMailTransport();
  await transport.send(message);
}

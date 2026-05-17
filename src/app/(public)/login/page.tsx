import { isOpenRegistration } from '@/lib/auth/registration';
import { LoginForm } from './LoginForm';

/**
 * Server component for the login route. Reads `openRegistration` from the
 * DB once per render and hands the boolean to the client-side
 * `LoginForm`, which uses it to decide whether to show the "Sign up"
 * prompt. Keeping the read here (rather than firing a `useEffect` fetch
 * from the form) means the link state is correct on the very first
 * paint — no flicker, no link briefly visible before the request returns.
 */
export default async function LoginPage() {
  const openRegistration = await isOpenRegistration();
  return <LoginForm openRegistration={openRegistration} />;
}

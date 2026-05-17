import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, 'Пароль должен быть не короче 8 символов')
  .max(128, 'Пароль слишком длинный');

export const emailSchema = z.string().email('Некорректный email').max(254);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100),
  inviteToken: z.string().min(1).max(256).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  /**
   * When true, the issued session lives for `JWT_REMEMBER_TTL` (30 days
   * by default) instead of the short access TTL. Optional so existing
   * clients that don't send the field stay on the short session.
   */
  rememberMe: z.boolean().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1).max(256),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(256),
  password: passwordSchema,
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1).max(256),
});

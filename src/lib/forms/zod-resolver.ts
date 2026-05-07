import type { Resolver, FieldValues } from 'react-hook-form';
import type { ZodType } from 'zod';

/**
 * Minimal react-hook-form resolver for zod v4 schemas.
 * The official `@hookform/resolvers/zod` v5 typing is fragile against zod v4 generics,
 * and `standardSchemaResolver` doesn't surface custom messages reliably for our fields.
 */
export function zodResolver<T extends FieldValues>(schema: ZodType<T>): Resolver<T> {
  const resolver: Resolver<T> = async (values) => {
    const result = await schema.safeParseAsync(values);
    if (result.success) {
      return { values: result.data, errors: {} };
    }
    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
      if (!(key in errors)) {
        errors[key] = { type: issue.code ?? 'invalid', message: issue.message };
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { values: {} as any, errors: errors as any };
  };
  return resolver;
}

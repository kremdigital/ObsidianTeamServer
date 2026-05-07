import { NextResponse } from 'next/server';
import type { ZodIssue, ZodSchema } from 'zod';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
}

export function apiError(
  code: string,
  message: string,
  status: number,
  fields?: Record<string, string[]>,
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(fields ? { fields } : {}),
    },
  };
  return NextResponse.json(body, { status });
}

export const errors = {
  validation: (fields: Record<string, string[]>) =>
    apiError('validation_error', 'Validation failed', 400, fields),
  unauthorized: (message = 'Authentication required') => apiError('unauthorized', message, 401),
  forbidden: (message = 'Forbidden') => apiError('forbidden', message, 403),
  notFound: (message = 'Not found') => apiError('not_found', message, 404),
  conflict: (code: string, message: string) => apiError(code, message, 409),
  invalid: (code: string, message: string) => apiError(code, message, 400),
  internal: (message = 'Internal server error') => apiError('internal_error', message, 500),
};

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodSchema<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse<ApiErrorBody> }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: errors.invalid('invalid_json', 'Request body must be valid JSON'),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of result.error.issues as ZodIssue[]) {
      const key = issue.path.length > 0 ? issue.path.join('.') : '_';
      const list = fields[key] ?? [];
      list.push(issue.message);
      fields[key] = list;
    }
    return { ok: false, response: errors.validation(fields) };
  }

  return { ok: true, data: result.data };
}

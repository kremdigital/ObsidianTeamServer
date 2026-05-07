import { logger } from './index';

export interface RequestLogContext {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  userId?: string | null;
}

/**
 * Single-line API access log. Call this at the end of every API handler that
 * uses {@link withApiLogger} — the wrapper handles invocation automatically.
 */
export function logApiRequest(ctx: RequestLogContext): void {
  const lvl = ctx.status >= 500 ? 'error' : ctx.status >= 400 ? 'warn' : 'info';
  logger[lvl](
    {
      http: {
        method: ctx.method,
        path: ctx.path,
        status: ctx.status,
        durationMs: ctx.durationMs,
      },
      ...(ctx.userId ? { userId: ctx.userId } : {}),
    },
    'api.request',
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, context?: any) => Promise<Response> | Response;

/**
 * Wrap a Next.js route handler with start/finish access logging. Adds < 1ms
 * overhead per request. The wrapped handler must still return a `Response`.
 *
 * Usage:
 * ```ts
 * export const POST = withApiLogger(async (request) => { ... });
 * ```
 */
export function withApiLogger<H extends Handler>(handler: H): H {
  const wrapped: Handler = async (request, context) => {
    const started = performance.now();
    const url = new URL(request.url);
    let response: Response;
    try {
      response = await handler(request, context);
    } catch (err) {
      const durationMs = Math.round(performance.now() - started);
      logger.error(
        { http: { method: request.method, path: url.pathname, status: 500, durationMs }, err },
        'api.unhandled',
      );
      throw err;
    }
    const durationMs = Math.round(performance.now() - started);
    logApiRequest({
      method: request.method,
      path: url.pathname,
      status: response.status,
      durationMs,
    });
    return response;
  };
  return wrapped as H;
}

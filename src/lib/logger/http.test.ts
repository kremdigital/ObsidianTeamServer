// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';
import { withApiLogger } from './http';

describe('withApiLogger', () => {
  it('preserves the response status', async () => {
    const handler = withApiLogger(async (_request: Request) =>
      NextResponse.json({ ok: true }, { status: 201 }),
    );
    const res = await handler(new Request('http://localhost/api/x', { method: 'POST' }));
    expect(res.status).toBe(201);
  });

  it('returns whatever the wrapped handler produces (no rewrites)', async () => {
    const handler = withApiLogger(
      async (_request: Request) =>
        new Response('hello', { status: 200, headers: { 'x-custom': 'yes' } }),
    );
    const res = await handler(new Request('http://localhost/api/y'));
    expect(await res.text()).toBe('hello');
    expect(res.headers.get('x-custom')).toBe('yes');
  });

  it('rethrows handler errors', async () => {
    const handler = withApiLogger(async (_request: Request) => {
      throw new Error('boom');
    });
    await expect(handler(new Request('http://localhost/api/z'))).rejects.toThrow('boom');
  });
});

/** Small HTTP helpers shared by the route modules. */

import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

/** An error carrying the status code we want to return. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (message: string) => new HttpError(404, message);
export const badRequest = (message: string, detail?: string) =>
  new HttpError(400, message, detail);

/**
 * Parse and validate a request body, throwing a 400 with readable field errors.
 * Express 5 forwards rejected promises to the error handler, so throwing is enough.
 */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw badRequest('Invalid request body', detail);
  }
  return result.data;
}

/** Central error handler. Must be registered last. */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, detail: error.detail });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error('[api] unhandled error:', error);
  res.status(500).json({ error: 'Internal server error', detail: message });
}

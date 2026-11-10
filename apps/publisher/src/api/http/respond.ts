import type { NextFunction, Request, Response } from 'express';
import { FanqieServiceError } from '../../sdk/errors.js';

export function ok(res: Response, data: unknown, status = 200) {
  res.status(status).json({ success: true, data });
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const serviceError = error instanceof FanqieServiceError
    ? error
    : new FanqieServiceError('internal_error', error instanceof Error ? error.message : String(error), 500);
  res.status(serviceError.status).json({
    success: false,
    code: serviceError.code,
    error: serviceError.message,
    details: serviceError.details,
  });
}

export class FanqieClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, options: { status: number; code: string; details?: unknown }) {
    super(message);
    this.name = 'FanqieClientError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}

export class FanqieServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 500, details?: unknown) {
    super(message);
    this.name = 'FanqieServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function driverNotConfigured(operation: string): FanqieServiceError {
  return new FanqieServiceError(
    'driver_not_configured',
    `Fanqie platform driver is not configured for operation: ${operation}`,
    501,
  );
}

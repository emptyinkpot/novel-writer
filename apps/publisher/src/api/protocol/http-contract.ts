export const FANQIE_HTTP_ROUTES = [
  'GET /health',
  'GET /accounts',
  'POST /accounts/login/discover',
  'POST /accounts/:id/login',
  'POST /accounts/:id/session/check',
  'POST /accounts/:id/reauth',
  'POST /works/scan',
  'POST /chapters/remote/sync',
  'POST /publish/chapter',
  'POST /publish/tomato',
  'POST /publish/database-chapter',
  'POST /publish/database-chapter/validate',
  'POST /publish/next-database-chapter',
  'GET /publish/jobs/:jobId',
  'GET /remote/chapters/:bookId/:itemId',
  'POST /edit/chapter',
  'POST /edit/database-chapter',
  'POST /edit/database-chapter/compare',
  'GET /reader/search',
  'GET /reader/books/:bookId',
  'GET /reader/chapters/:itemId',
  'POST /reader/export/chapter-text',
  'POST /reader/export/book-text',
  'GET /database/publication-targets',
  'GET /database/fanqie-works',
  'POST /database/sync-fanqie-works',
  'POST /database/register-publication-target',
  'GET /database/publish-context',
  'GET /database/publish-chapter',
] as const;

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  code: string;
  error: string;
  details?: unknown;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

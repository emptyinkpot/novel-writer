export type FanqieToolId =
  | 'account.list'
  | 'account.login'
  | 'account.login.discover'
  | 'account.session.check'
  | 'account.reauth'
  | 'work.scan'
  | 'chapter.remote.sync'
  | 'publish.chapter'
  | 'publish.tomato'
  | 'publish.database.chapter'
  | 'publish.database.chapter.validate'
  | 'publish.next.database.chapter'
  | 'publish.job.get'
  | 'remote.chapter.get'
  | 'remote.chapter.edit'
  | 'database.chapter.edit'
  | 'database.chapter.compare'
  | 'reader.book.search'
  | 'reader.book.get'
  | 'reader.chapter.get'
  | 'reader.chapter.export.text'
  | 'reader.book.export.text'
  | 'database.publication.targets'
  | 'database.fanqie.works'
  | 'database.fanqie.works.sync'
  | 'database.publication.target.register'
  | 'database.publish.context'
  | 'database.publish.chapter';

export interface FanqieToolDescriptor {
  id: FanqieToolId;
  owner: 'account' | 'scan' | 'chapter' | 'publish' | 'edit' | 'reader' | 'database';
  transport: 'http';
  route: string;
}

export const FANQIE_TOOLS: FanqieToolDescriptor[] = [
  { id: 'account.list', owner: 'account', transport: 'http', route: 'GET /accounts' },
  { id: 'account.login', owner: 'account', transport: 'http', route: 'POST /accounts/:id/login' },
  { id: 'account.login.discover', owner: 'account', transport: 'http', route: 'POST /accounts/login/discover' },
  { id: 'account.session.check', owner: 'account', transport: 'http', route: 'POST /accounts/:id/session/check' },
  { id: 'account.reauth', owner: 'account', transport: 'http', route: 'POST /accounts/:id/reauth' },
  { id: 'work.scan', owner: 'scan', transport: 'http', route: 'POST /works/scan' },
  { id: 'chapter.remote.sync', owner: 'chapter', transport: 'http', route: 'POST /chapters/remote/sync' },
  { id: 'publish.chapter', owner: 'publish', transport: 'http', route: 'POST /publish/chapter' },
  { id: 'publish.tomato', owner: 'publish', transport: 'http', route: 'POST /publish/tomato' },
  { id: 'publish.database.chapter', owner: 'publish', transport: 'http', route: 'POST /publish/database-chapter' },
  { id: 'publish.database.chapter.validate', owner: 'publish', transport: 'http', route: 'POST /publish/database-chapter/validate' },
  { id: 'publish.next.database.chapter', owner: 'publish', transport: 'http', route: 'POST /publish/next-database-chapter' },
  { id: 'publish.job.get', owner: 'publish', transport: 'http', route: 'GET /publish/jobs/:jobId' },
  { id: 'remote.chapter.get', owner: 'edit', transport: 'http', route: 'GET /remote/chapters/:bookId/:itemId' },
  { id: 'remote.chapter.edit', owner: 'edit', transport: 'http', route: 'POST /edit/chapter' },
  { id: 'database.chapter.edit', owner: 'edit', transport: 'http', route: 'POST /edit/database-chapter' },
  { id: 'database.chapter.compare', owner: 'edit', transport: 'http', route: 'POST /edit/database-chapter/compare' },
  { id: 'reader.book.search', owner: 'reader', transport: 'http', route: 'GET /reader/search' },
  { id: 'reader.book.get', owner: 'reader', transport: 'http', route: 'GET /reader/books/:bookId' },
  { id: 'reader.chapter.get', owner: 'reader', transport: 'http', route: 'GET /reader/chapters/:itemId' },
  { id: 'reader.chapter.export.text', owner: 'reader', transport: 'http', route: 'POST /reader/export/chapter-text' },
  { id: 'reader.book.export.text', owner: 'reader', transport: 'http', route: 'POST /reader/export/book-text' },
  { id: 'database.publication.targets', owner: 'database', transport: 'http', route: 'GET /database/publication-targets' },
  { id: 'database.fanqie.works', owner: 'database', transport: 'http', route: 'GET /database/fanqie-works' },
  { id: 'database.fanqie.works.sync', owner: 'database', transport: 'http', route: 'POST /database/sync-fanqie-works' },
  { id: 'database.publication.target.register', owner: 'database', transport: 'http', route: 'POST /database/register-publication-target' },
  { id: 'database.publish.context', owner: 'database', transport: 'http', route: 'GET /database/publish-context' },
  { id: 'database.publish.chapter', owner: 'database', transport: 'http', route: 'GET /database/publish-chapter' },
];

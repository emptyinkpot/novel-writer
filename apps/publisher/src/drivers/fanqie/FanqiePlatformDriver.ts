import type {
  LoginResult,
  PlatformConfirmationEvidence,
  EditChapterResult,
  EditRemoteChapterInput,
  LoginOptions,
  PublishChapterInput,
  RemoteChapterDetail,
  RemoteChapterSnapshot,
  RemoteWorkSnapshot,
  ScanWorksInput,
  SessionCheckResult,
  SyncRemoteChaptersInput,
} from '../../sdk/types.js';
import { driverNotConfigured } from '../../sdk/errors.js';

export interface FanqiePlatformDriver {
  readonly configured: boolean;
  readonly name: string;
  login(accountId: string, options?: LoginOptions): Promise<LoginResult>;
  loginDiscovered(): Promise<LoginResult>;
  checkSession(accountId: string): Promise<SessionCheckResult>;
  scanWorks(input: ScanWorksInput): Promise<RemoteWorkSnapshot[]>;
  syncRemoteChapters(input: SyncRemoteChaptersInput): Promise<RemoteChapterSnapshot[]>;
  publishChapter(input: PublishChapterInput): Promise<PlatformConfirmationEvidence>;
  getRemoteChapter(input: { accountId: string; bookId: string; itemId: string }): Promise<RemoteChapterDetail>;
  editRemoteChapter(input: EditRemoteChapterInput): Promise<EditChapterResult>;
}

export class NotConfiguredFanqiePlatformDriver implements FanqiePlatformDriver {
  readonly configured = false;
  readonly name = 'not-configured';

  login(): Promise<LoginResult> {
    throw driverNotConfigured('login');
  }

  loginDiscovered(): Promise<LoginResult> {
    throw driverNotConfigured('account.login.discover');
  }

  checkSession(): Promise<SessionCheckResult> {
    throw driverNotConfigured('session.check');
  }

  scanWorks(): Promise<RemoteWorkSnapshot[]> {
    throw driverNotConfigured('works.scan');
  }

  syncRemoteChapters(): Promise<RemoteChapterSnapshot[]> {
    throw driverNotConfigured('chapters.remote.sync');
  }

  publishChapter(): Promise<PlatformConfirmationEvidence> {
    throw driverNotConfigured('publish.chapter');
  }

  getRemoteChapter(): Promise<RemoteChapterDetail> {
    throw driverNotConfigured('remote.chapter.get');
  }

  editRemoteChapter(): Promise<EditChapterResult> {
    throw driverNotConfigured('remote.chapter.edit');
  }
}

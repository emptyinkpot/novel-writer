import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FanqieServiceConfig } from '../../config.js';
import type {
  LoginResult,
  LoginOptions,
  PlatformConfirmationEvidence,
  EditChapterResult,
  EditRemoteChapterInput,
  PublishChapterInput,
  RemoteChapterDetail,
  RemoteChapterSnapshot,
  RemoteWorkSnapshot,
  ScanWorksInput,
  SessionCheckResult,
  SyncRemoteChaptersInput,
} from '../../sdk/types.js';
import { FanqieServiceError } from '../../sdk/errors.js';
import type { FanqiePlatformDriver } from './FanqiePlatformDriver.js';

export class ScriptFanqiePlatformDriver implements FanqiePlatformDriver {
  readonly configured = true;
  readonly name = 'script-playwright';
  private readonly runtimeDir: string;

  constructor(private readonly config: FanqieServiceConfig) {
    this.runtimeDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../runtime/browser');
  }

  async login(accountId: string, options: LoginOptions = {}): Promise<LoginResult> {
    const payload = await this.runScriptObject('fanqie-session-check.mjs', [
      accountId,
      '--login',
      ...(options.waitForCompletion ? ['--wait'] : []),
    ]);
    return {
      accountId: String(payload.accountId || accountId),
      status: payload.status === 'completed' ? 'completed' : 'started',
      headed: true,
      evidence: sanitizeEvidence(payload),
    };
  }

  async loginDiscovered(): Promise<LoginResult> {
    const payload = await this.runScriptObject('fanqie-account-login.mjs', []);
    return {
      accountId: String(payload.accountId || ''),
      status: payload.status === 'completed' ? 'completed' : 'failed',
      headed: true,
      evidence: sanitizeEvidence(payload),
    };
  }

  async checkSession(accountId: string): Promise<SessionCheckResult> {
    const payload = await this.runScriptJson('fanqie-session-check.mjs', [accountId]);
    const results = Array.isArray(payload) ? payload : [];
    const usable = results.find((item) => item && item.skipped !== true && Number(item.workCount || 0) > 0)
      || results.find((item) => item && item.skipped !== true && /book-manage/.test(String(item.url || '')));
    const checkedAt = new Date().toISOString();
    return {
      accountId,
      valid: Boolean(usable),
      status: usable ? 'valid' : 'unknown',
      checkedAt,
      evidence: {
        checkedAt,
        results: results.map(sanitizeEvidence),
      },
    };
  }

  async scanWorks(input: ScanWorksInput): Promise<RemoteWorkSnapshot[]> {
    const payload = await this.runRuntimeCommand('works-live', input.accountId, input.headed ? ['--headed'] : []);
    const data = Array.isArray(payload.data) ? payload.data : [];
    const scannedAt = new Date().toISOString();
    return data.map((item) => ({
      accountId: String(input.accountId || item.accountId || ''),
      platform: 'fanqie' as const,
      bookId: String(item.id || item.bookId || ''),
      title: String(item.title || ''),
      chapterCount: numberOrUndefined(item.chapterCount),
      latestChapterNumber: numberOrUndefined(item.latestChapterNumber || item.latestChapter),
      scannedAt,
      raw: sanitizeEvidence(item),
    })).filter((item) => item.bookId && item.title);
  }

  async syncRemoteChapters(input: SyncRemoteChaptersInput): Promise<RemoteChapterSnapshot[]> {
    const payload = await this.runRuntimeCommand('remote-chapters', input.accountId, ['--book-id', input.bookId]);
    const data = Array.isArray(payload.data) ? payload.data : [];
    const syncedAt = new Date().toISOString();
    return data.map((item) => ({
      accountId: input.accountId,
      platform: 'fanqie' as const,
      bookId: input.bookId,
      itemId: item.itemId ? String(item.itemId) : undefined,
      chapterNumber: Number(item.chapterNumber || 0),
      title: item.title ? String(item.title) : undefined,
      wordCount: numberOrUndefined(item.wordCount),
      publishedAt: item.publishedAt ? String(item.publishedAt) : null,
      syncedAt,
      raw: sanitizeEvidence(item),
    })).filter((item) => item.itemId && item.chapterNumber > 0);
  }

  async publishChapter(input: PublishChapterInput): Promise<PlatformConfirmationEvidence> {
    const payload = await this.runScriptObject('fanqie-publish-chapter.mjs', ['--payload-stdin'], input);
    const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    return {
      platform: 'fanqie',
      accountId: input.accountId,
      bookId: String(data.bookId || input.bookId),
      chapterNumber: Number(input.chapterNumber),
      confirmed: data.confirmed === true || data.success === true,
      confirmedAt: new Date().toISOString(),
      evidence: sanitizeEvidence(data),
    };
  }

  async getRemoteChapter(input: { accountId: string; bookId: string; itemId: string }): Promise<RemoteChapterDetail> {
    const payload = await this.runEditCommand('remote-chapter-detail', input.accountId, [
      '--book-id', input.bookId,
      '--item-id', input.itemId,
    ]);
    const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    return {
      accountId: input.accountId,
      bookId: String(data.bookId || input.bookId),
      itemId: String(data.itemId || input.itemId),
      editUrl: data.editUrl ? String(data.editUrl) : undefined,
      chapterNumber: numberOrUndefined(data.chapterNumber),
      title: data.title == null ? '' : String(data.title),
      contentHtml: data.contentHtml ? String(data.contentHtml) : undefined,
      contentText: data.contentText == null ? '' : String(data.contentText),
      wordCount: numberOrUndefined(data.wordCount),
      responseCode: data.responseCode == null ? undefined : Number(data.responseCode),
      responseMessage: data.responseMessage ? String(data.responseMessage) : undefined,
      evidence: sanitizeEvidence(data),
    };
  }

  async editRemoteChapter(input: EditRemoteChapterInput): Promise<EditChapterResult> {
    const payload = await this.runEditCommand('remote-chapter-update', input.accountId, [
      '--book-id', input.bookId,
      '--item-id', input.itemId,
      '--payload-stdin',
    ], {
      title: input.title,
      contentText: input.contentText,
      headless: input.headless,
    });
    const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    return {
      success: data.success === true,
      accountId: input.accountId,
      bookId: String(data.bookId || input.bookId),
      itemId: String(data.itemId || input.itemId),
      before: objectOrUndefined(data.before),
      after: objectOrUndefined(data.after),
      listEntry: objectOrNull(data.listEntry),
      verification: objectOrUndefined(data.verification),
      evidence: sanitizeEvidence(data),
    };
  }

  private runRuntimeCommand(command: string, accountId?: string, extraArgs: string[] = []) {
    return this.runScriptObject('fanqie-publish-chapter.mjs', [
      '--command',
      command,
      ...(accountId ? ['--account', accountId] : []),
      ...extraArgs,
    ]);
  }

  private runEditCommand(command: string, accountId: string, extraArgs: string[] = [], stdinPayload?: unknown) {
    return this.runScriptObject('fanqie-remote-edit.mjs', [
      '--command',
      command,
      '--account',
      accountId,
      ...extraArgs,
    ], stdinPayload);
  }

  private async runScriptObject(scriptName: string, args: string[], stdinPayload?: unknown) {
    const payload = await this.runScriptJson(scriptName, args, stdinPayload);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new FanqieServiceError('invalid_driver_output', `${scriptName} returned invalid output`, 502, payload);
    }
    if (payload.success === false) {
      throw new FanqieServiceError('fanqie_driver_failed', String(payload.error || `${scriptName} failed`), 502, payload);
    }
    return payload as Record<string, any>;
  }

  private runScriptJson(scriptName: string, args: string[], stdinPayload?: unknown): Promise<any> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, [resolve(this.runtimeDir, scriptName), ...args.filter(Boolean)], {
        cwd: this.config.rootDir,
        env: {
          ...process.env,
          FANQIE_SERVICE_DATA_DIR: this.config.dataDir,
          FANQIE_SERVICE_ROOT: this.config.rootDir,
          FANQIE_CONTENTBASE_ROOT: this.config.contentBaseRoot || process.env.FANQIE_CONTENTBASE_ROOT || '',
        },
        windowsHide: true,
      });
      if (stdinPayload !== undefined) {
        child.stdin.end(JSON.stringify(stdinPayload));
      } else {
        child.stdin.end();
      }
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => {
        const parsed = parseJson(stdout) || parseJson(stderr);
        if (code !== 0) {
          reject(new FanqieServiceError(
            'fanqie_driver_failed',
            extractDriverError(parsed, stderr || stdout),
            502,
            { scriptName, code, output: parsed || truncate(`${stdout}\n${stderr}`) },
          ));
          return;
        }
        if (parsed === null) {
          reject(new FanqieServiceError('invalid_driver_output', `${scriptName} did not return JSON`, 502, truncate(stdout || stderr)));
          return;
        }
        resolvePromise(parsed);
      });
    });
  }
}

function parseJson(raw: string) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  const candidates = [
    arrayStart >= 0 && arrayEnd > arrayStart ? text.slice(arrayStart, arrayEnd + 1) : '',
    objectStart >= 0 && objectEnd > objectStart ? text.slice(objectStart, objectEnd + 1) : '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

function extractDriverError(parsed: any, raw: string) {
  if (parsed?.error) return String(parsed.error);
  return truncate(raw || 'Fanqie driver failed');
}

function truncate(value: unknown, max = 2000) {
  return String(value || '').slice(0, max);
}

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function sanitizeEvidence(value: any): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const copy: Record<string, unknown> = { ...value };
  for (const key of ['cookies', 'contentHtml', 'contentText']) {
    if (key in copy) copy[key] = '[redacted]';
  }
  return copy;
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

import { BadGatewayException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { FANQIE_SERVICE_URL } from '../env';
import { UserEntity } from '../user/user.entity';
import { PlatformAccountLinkEntity } from './platform-account-link.entity';

type FanqieWork = {
  accountId: string; bookId: string; title: string; drafts: Array<{ itemId: string }>; draftCount?: number
  draftScanStatus?: string; draftScanError?: string | null
};
type FanqieAccount = {
  accountId: string;
  name: string;
  scanStatus: string;
  scannedAt?: string;
  scanErrors?: Array<{ bookId: string; title: string; error: string }>;
  works: FanqieWork[];
  workCount?: number;
};
type CachedResult<T> = { items?: T[]; detail?: T; cachedAt: string | null; refreshing: boolean };

@Injectable()
export class FanqieService {
  constructor(@InjectRepository(PlatformAccountLinkEntity) private readonly links: Repository<PlatformAccountLinkEntity>) {}

  async listAccounts(userId: number) {
    const [rawAccounts, allLinks] = await Promise.all([
      this.publisherRequest<FanqieAccount[]>('/catalog/accounts'),
      this.links.find({ where: { platform: 'fanqie' }, relations: { user: true } }),
    ]);
    const accounts = rawAccounts.map((account) => this.normalizeAccount(account));
    const linkByAccount = new Map(allLinks.map((link) => [link.platformAccountId, link]));
    return accounts
      .filter((account) => !linkByAccount.has(account.accountId) || linkByAccount.get(account.accountId)?.user?.id === userId)
      .map((account) => {
        const link = linkByAccount.get(account.accountId);
        return this.clientAccount(account, link?.user?.id === userId ? link.displayName || account.name : account.name, link?.user?.id === userId);
      });
  }

  async linkAccount(userId: number, accountId: string, displayName?: string) {
    let account = await this.getPublisherAccount(accountId);
    const existing = await this.links.findOne({
      where: { platform: 'fanqie', platformAccountId: accountId },
      relations: { user: true },
    });
    if (existing && existing.user.id !== userId) throw new ConflictException('该番茄账号已关联到其他用户');
    const link = existing ?? this.links.create({
      id: randomUUID(), platform: 'fanqie', platformAccountId: accountId,
      user: { id: userId } as UserEntity,
    });
    if (displayName?.trim()) link.displayName = displayName.trim();
    await this.links.save(link);
    if (displayName?.trim()) {
      account = await this.publisherRequest<FanqieAccount>(`/accounts/${encodeURIComponent(accountId)}/display-name`, {
        method: 'POST', body: { displayName: displayName.trim() },
      });
    }
    return this.clientAccount(account, link.displayName || account.name, true);
  }

  async discoverAccount(userId: number) {
    const discovered = await this.publisherRequest<{ accountId: string }>('/accounts/login/discover', { method: 'POST' });
    const account = await this.linkAccount(userId, discovered.accountId);
    return account;
  }

  async scanAccount(userId: number, accountId: string) {
    await this.requireLink(userId, accountId);
    const account = await this.publisherRequest<FanqieAccount>(`/catalog/accounts/${encodeURIComponent(accountId)}/scan`, { method: 'POST' });
    return this.clientAccount(account, account.name, true);
  }

  async listChapters(userId: number, accountId: string, bookId: string) {
    await this.requireWork(userId, accountId, bookId);
    return this.publisherRequest<CachedResult<Record<string, unknown>>>('/chapters/remote/sync', {
      method: 'POST', body: { accountId, bookId, refresh: false, persist: false },
    });
  }

  async getChapter(userId: number, accountId: string, bookId: string, itemId: string) {
    await this.requireWork(userId, accountId, bookId);
    const result = await this.publisherRequest<CachedResult<Record<string, unknown>>>(`/remote/chapters/${encodeURIComponent(bookId)}/${encodeURIComponent(itemId)}?accountId=${encodeURIComponent(accountId)}`);
    const chapter = result.detail;
    if (!chapter) throw new NotFoundException('该作品下找不到所选章节');
    if (String(chapter.bookId) !== bookId || String(chapter.itemId) !== itemId) throw new NotFoundException('该作品下找不到所选章节');
    return result;
  }

  async updateChapter(userId: number, accountId: string, bookId: string, itemId: string, data: { title?: string; contentText?: string }) {
    await this.requireWork(userId, accountId, bookId);
    const result = await this.publisherRequest<CachedResult<Record<string, unknown>>>(`/remote/chapters/${encodeURIComponent(bookId)}/${encodeURIComponent(itemId)}?accountId=${encodeURIComponent(accountId)}`);
    const chapter = result.detail;
    if (!chapter || String(chapter.bookId) !== bookId || String(chapter.itemId) !== itemId) throw new NotFoundException('该作品下找不到所选章节');
    return this.publisherRequest('/edit/chapter', {
      method: 'POST', body: { ...data, accountId, bookId, itemId },
    });
  }

  async getDraft(userId: number, accountId: string, bookId: string, itemId: string) {
    await this.requireDraft(userId, accountId, bookId, itemId);
    return this.publisherRequest<CachedResult<Record<string, unknown>>>(`/drafts/${encodeURIComponent(bookId)}/${encodeURIComponent(itemId)}?accountId=${encodeURIComponent(accountId)}`);
  }

  async updateDraft(userId: number, accountId: string, bookId: string, itemId: string, data: { title?: string; content?: string }) {
    await this.requireDraft(userId, accountId, bookId, itemId);
    return this.publisherRequest(`/drafts/${encodeURIComponent(bookId)}/${encodeURIComponent(itemId)}`, {
      method: 'POST', body: { ...data, accountId },
    });
  }

  async publishDraft(userId: number, accountId: string, bookId: string, itemId: string, chapterNumber: number) {
    await this.requireDraft(userId, accountId, bookId, itemId);
    return this.publisherRequest(`/drafts/${encodeURIComponent(bookId)}/${encodeURIComponent(itemId)}/publish`, {
      method: 'POST', body: { accountId, chapterNumber, dryRun: false },
    });
  }

  private async requireDraft(userId: number, accountId: string, bookId: string, itemId: string) {
    const work = await this.requireWork(userId, accountId, bookId);
    if (!work) throw new NotFoundException('该账号下找不到所选作品，请先刷新作品目录');
    if (!work.drafts.some((draft) => draft.itemId === itemId)) throw new NotFoundException('该作品草稿箱中找不到所选草稿，请先刷新作品目录');
  }

  private async requireWork(userId: number, accountId: string, bookId: string) {
    await this.requireLink(userId, accountId);
    const account = await this.getPublisherAccount(accountId);
    const work = account.works.find((candidate) => candidate.bookId === bookId);
    if (!work) throw new NotFoundException('该账号下找不到所选作品，请先刷新作品目录');
    return work;
  }

  private async requireLink(userId: number, accountId: string) {
    const link = await this.links.findOne({
      where: { platform: 'fanqie', platformAccountId: accountId },
      relations: { user: true },
    });
    if (!link || link.user.id !== userId) throw new NotFoundException('番茄账号未关联到当前用户');
  }

  private async getPublisherAccount(accountId: string) {
    const account = await this.publisherRequest<FanqieAccount>(`/catalog/accounts/${encodeURIComponent(accountId)}`);
    return this.normalizeAccount(account);
  }

  private clientAccount(account: FanqieAccount, name: string, linked: boolean) {
    const normalized = this.normalizeAccount(account);
    return { ...normalized, name, linked };
  }

  private normalizeAccount(account: FanqieAccount): FanqieAccount {
    return {
      ...account,
      workCount: account.works?.length ?? 0,
      works: (account.works ?? []).map((work) => ({
        ...work,
        draftCount: work.drafts?.length ?? 0,
        draftScanStatus: work.draftScanStatus ?? 'complete',
        drafts: work.drafts ?? [],
      })),
    };
  }

  private async publisherRequest<T = any>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    let response: Response;
    try {
      const url = `${FANQIE_SERVICE_URL}${path}`;
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ServiceUnavailableException('番茄发布服务暂不可用');
    }
    const payload = await response.json().catch(() => null) as { data?: T; error?: string; success?: boolean } | null;
    if (!response.ok) {
      const status = response.status === 404 ? 404 : response.status === 409 ? 409 : response.status === 401 ? 401 : 502;
      if (status === 404) throw new NotFoundException(payload?.error || '番茄对象不存在');
      if (status === 409) throw new ConflictException(payload?.error || '番茄对象状态冲突');
      if (status === 401) throw new BadGatewayException(payload?.error || '番茄账号登录状态需要更新');
      throw new BadGatewayException(payload?.error || '番茄发布服务请求失败');
    }
    return (payload && payload.success === true && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload) as T;
  }
}

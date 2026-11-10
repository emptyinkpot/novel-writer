import { Injectable, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { UserEntity } from '../user/user.entity';
import { llmConfig } from '../env';
import { UserService } from '../user/user.service';

export const FREE_DAILY_CHARS = 3000;

export type QuotaSource =
  | { kind: 'unlimited' }
  | { kind: 'package'; index: number; remaining: number }
  | { kind: 'free_daily'; remaining: number };

/** 北京时间的 YYYY-MM-DD。 */
export function beijingDate(now = Date.now()): string {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 从 OpenAI 兼容的 SSE 片段里取出生成的正文，用于按字数计费。 */
export function extractSseContent(buffer: string): { text: string; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  let text = '';
  for (const line of lines) {
    const data = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : '';
    if (!data || data === '[DONE]') continue;
    try {
      const json = JSON.parse(data);
      text += json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? '';
    } catch {
      /* 不完整或非 JSON 的行忽略 */
    }
  }
  return { text, rest };
}

/** 计费字数：去掉空白后的字符数。 */
export function countChars(text: string): number {
  return text.replace(/\s+/g, '').length;
}

const SYSTEM_PROMPT = [
  '你是一个专业的小说写作助手。',
  '请用以下 YAML 格式回复：',
  '```yaml',
  'new: |',
  '  你的回复内容',
  '```',
].join('\n');

@Injectable()
export class ChatService {
  constructor(private readonly userService: UserService) {}

  /**
   * 判定本次对话从哪一份额度扣字数。
   * 顺序：未过期的无限会员 → 有余量的字数包 → 每日免费额度（按北京时间自然日重置）。
   */
  checkQuota(user: UserEntity): QuotaSource {
    const plan = user.memberPlan || {};
    const today = beijingDate();
    const planActive = !plan.expireAt || String(plan.expireAt) >= today;
    const packages: any[] = Array.isArray(plan.wordPackages) ? plan.wordPackages : [];
    if (planActive) {
      if (packages.some((p) => p.type === 'unlimited' || Number(p.remaining) === -1)) return { kind: 'unlimited' };
      const index = packages.findIndex((p) => Number(p.remaining) > 0);
      if (index >= 0) return { kind: 'package', index, remaining: Number(packages[index].remaining) };
    }
    const used = plan.freeDaily?.date === today ? Number(plan.freeDaily.used) || 0 : 0;
    const remaining = FREE_DAILY_CHARS - used;
    if (remaining <= 0) throw new ForbiddenException('今日免费字数已用完');
    return { kind: 'free_daily', remaining };
  }

  /** 扣减并写回数据库。重新读取用户，避免用过期的内存对象覆盖其他请求的更新。 */
  async deductQuota(userId: number, source: QuotaSource, chars: number): Promise<void> {
    if (chars <= 0 || source.kind === 'unlimited') return;
    const user = await this.userService.findById(userId);
    if (!user) return;
    const plan: Record<string, any> = { ...(user.memberPlan || {}) };
    if (source.kind === 'package') {
      const packages = [...(plan.wordPackages || [])];
      const pkg = packages[source.index];
      if (pkg) packages[source.index] = { ...pkg, remaining: Math.max(0, Number(pkg.remaining || 0) - chars) };
      plan.wordPackages = packages;
    } else {
      const today = beijingDate();
      const used = plan.freeDaily?.date === today ? Number(plan.freeDaily.used) || 0 : 0;
      plan.freeDaily = { date: today, used: used + chars };
    }
    user.memberPlan = plan;
    await this.userService.save(user);
  }

  buildMessages(body: any) {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(body.messages || []),
    ];
    return messages;
  }

  async streamChat(body: any): Promise<Response> {
    const llm = llmConfig();
    if (!llm) throw new ServiceUnavailableException('未配置模型接口：请在 .env 中设置 LLM_BASE_URL 和 LLM_API_KEY');
    const messages = this.buildMessages(body);
    const upstream = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model: body.model || 'gpt-4o',
        messages,
        max_tokens: body.max_tokens || 2048,
        stream: true,
      }),
    });
    return upstream as unknown as Response;
  }
}

import { Injectable, ForbiddenException } from '@nestjs/common';
import { UserEntity } from '../user/user.entity';

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
  private readonly sub2apiUrl = process.env.SUB2API_URL || 'https://llm.example.invalid/v1';
  private readonly sub2apiKey = process.env.SUB2API_KEY || '';

  checkQuota(user: UserEntity) {
    const plan = user.memberPlan;
    if (!plan) {
      // Free tier: 3000 chars daily (no memberPlan needed)
      return { remaining: 3000, type: 'free_daily' };
    }
    const packages = plan.wordPackages as any[];
    if (!packages || !packages.length) {
      return { remaining: 3000, type: 'free_daily' };
    }
    const available = packages.find((p: any) => p.remaining > 0);
    if (!available) throw new ForbiddenException('quota exhausted');
    return available;
  }

  deductQuota(pkg: any, tokensUsed: number) {
    pkg.remaining = Math.max(0, (pkg.remaining || 0) - tokensUsed);
  }

  buildMessages(body: any) {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(body.messages || []),
    ];
    return messages;
  }

  async streamChat(body: any): Promise<Response> {
    const messages = this.buildMessages(body);
    const upstream = await fetch(`${this.sub2apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.sub2apiKey}`,
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

import { Injectable, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { UserEntity } from '../user/user.entity';
import { llmConfig } from '../env';

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

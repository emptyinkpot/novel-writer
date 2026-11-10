import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeAgentPromptDebugSnapshot(agentName: string, prompt: string): void {
  // 显式开启后只保存诊断输入，帮助定位 provider/request-shape 问题；不参与正文生成或修订。
  if (String(process.env.CONTENTBASE_DEBUG_AGENT_PROMPTS || '').trim() !== '1') return;
  const dir = String(process.env.CONTENTBASE_DEBUG_AGENT_PROMPTS_DIR || '').trim() || '/tmp/contentbase-agent-prompts';
  try {
    mkdirSync(dir, { recursive: true });
    const safeName = agentName.replace(/[^a-z0-9_-]+/gi, '_');
    writeFileSync(join(dir, `${safeName}.prompt.txt`), prompt, 'utf8');
    writeFileSync(join(dir, `${safeName}.meta.json`), JSON.stringify({
      agentName,
      chars: prompt.length,
      writtenAt: new Date().toISOString(),
    }, null, 2), 'utf8');
  } catch {
    // 调试快照是 sensor，写失败不能影响生成链路。
  }
}

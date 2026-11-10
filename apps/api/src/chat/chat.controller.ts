import { Controller, Post, Body, UseGuards, Req, Res } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ChatService, countChars, extractSseContent } from './chat.service';
import { Request, Response } from 'express';
import { Readable } from 'stream';

@Controller('api/v1/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('chat/v2')
  @UseGuards(JwtAuthGuard)
  async chatV2(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    const user = req.user as any;
    const quota = this.chatService.checkQuota(user);

    let upstream: globalThis.Response;
    try {
      upstream = await this.chatService.streamChat(body);
    } catch (error: any) {
      const status = typeof error?.getStatus === 'function' ? error.getStatus() : 502;
      res.status(status).json({ statusCode: status, message: error?.message || 'upstream model request failed' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    if (!upstream.ok) {
      res.write(`data: ${JSON.stringify({ error: upstream.statusText })}\n\n`);
      res.end();
      return;
    }

    const reader = (upstream.body as any).getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let generated = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
        const parsed = extractSseContent(pending + chunk);
        pending = parsed.rest;
        generated += parsed.text;
      }
      generated += extractSseContent(pending + '\n').text;
    } catch {
      /* 上游中断：已生成的部分照常计费 */
    } finally {
      res.end();
      await this.chatService.deductQuota(user.id, quota, countChars(generated)).catch((error) => {
        console.error('[chat] 扣减字数失败', error);
      });
    }
  }

  @Post('model-success-rates')
  @UseGuards(JwtAuthGuard)
  async modelSuccessRates() {
    return {
      code: 0,
      data: [
        { model: 'gpt-4o', rate: 0.98 },
        { model: 'claude-sonnet-4-20250514', rate: 0.97 },
      ],
    };
  }

}

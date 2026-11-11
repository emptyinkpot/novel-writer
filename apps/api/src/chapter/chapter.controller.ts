import { Controller, Get, Post, Body, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ChapterService } from './chapter.service';
import { Request } from 'express';

@Controller('api/v1/chapter')
@UseGuards(JwtAuthGuard)
export class ChapterController {
  constructor(private readonly chapterService: ChapterService) {}

  @Get('list')
  async list(@Req() req: Request, @Query('workId') workId: string) {
    const user = req.user as { id: number };
    const data = await this.chapterService.list(Number(workId), user.id);
    return { code: 0, data };
  }

  @Post('save')
  async save(@Req() req: Request, @Body() body: any) {
    const user = req.user as { id: number };
    const data = await this.chapterService.save(body, user.id);
    return { code: 0, data };
  }

  @Post('delete')
  async delete(@Req() req: Request, @Body() body: { id: number }) {
    const user = req.user as { id: number };
    const data = await this.chapterService.delete(body.id, user.id);
    return { code: 0, data };
  }
}

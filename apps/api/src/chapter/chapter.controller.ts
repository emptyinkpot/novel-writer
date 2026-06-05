import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ChapterService } from './chapter.service';

@Controller('api/v1/chapter')
@UseGuards(JwtAuthGuard)
export class ChapterController {
  constructor(private readonly chapterService: ChapterService) {}

  @Get('list')
  async list(@Query('workId') workId: string) {
    const data = await this.chapterService.list(Number(workId));
    return { code: 0, data };
  }

  @Post('save')
  async save(@Body() body: any) {
    const data = await this.chapterService.save(body);
    return { code: 0, data };
  }

  @Post('delete')
  async delete(@Body() body: { id: number }) {
    const data = await this.chapterService.delete(body.id);
    return { code: 0, data };
  }
}

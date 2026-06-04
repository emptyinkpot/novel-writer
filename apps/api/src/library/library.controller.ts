import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LibraryService } from './library.service';
import { Request } from 'express';

@Controller('api/v1/library')
@UseGuards(JwtAuthGuard)
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  @Get('work-list')
  async list(@Req() req: Request) {
    const user = req.user as any;
    const data = await this.libraryService.listByUser(user.id);
    return { code: 0, data };
  }

  @Post('create-work')
  async create(@Req() req: Request, @Body() body: any) {
    const user = req.user as any;
    const data = await this.libraryService.create(user.id, body);
    return { code: 0, data };
  }

  @Post('delete-work')
  async delete(@Req() req: Request, @Body() body: { id: number }) {
    const user = req.user as any;
    const data = await this.libraryService.delete(user.id, body.id);
    return { code: 0, data };
  }
}

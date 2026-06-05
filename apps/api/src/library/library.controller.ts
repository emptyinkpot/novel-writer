import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LibraryService } from './library.service';

@Controller('api/v1/library')
@UseGuards(JwtAuthGuard)
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  @Get('work-list')
  async list() {
    const data = await this.libraryService.list();
    return { code: 0, data };
  }

  @Post('create-work')
  async create(@Body() body: any) {
    const data = await this.libraryService.create(body);
    return { code: 0, data };
  }

  @Post('delete-work')
  async delete(@Body() body: { id: number }) {
    const data = await this.libraryService.delete(body.id);
    return { code: 0, data };
  }
}

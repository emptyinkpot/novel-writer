import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SessionService } from './session.service';
import { Request } from 'express';

@Controller('api/v1/session')
@UseGuards(JwtAuthGuard)
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post('create-session')
  async create(@Req() req: Request, @Body() body: any) {
    const user = req.user as any;
    const data = await this.sessionService.create(user.id, body);
    return { code: 0, data };
  }

  @Get('list')
  async list(@Req() req: Request) {
    const user = req.user as any;
    const data = await this.sessionService.listByUser(user.id);
    return { code: 0, data };
  }
}

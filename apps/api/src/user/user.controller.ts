import { Controller, Get, Post, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UserService } from './user.service';
import { Request } from 'express';

@Controller('api/v1/user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('info')
  async getInfo(@Req() req: Request) {
    const user = req.user as any;
    return { code: 0, data: user };
  }

  @Post('daily-check-in')
  async dailyCheckIn(@Req() req: Request) {
    return { code: 0, data: { checked: true } };
  }
}

import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LOCAL_ADMIN_ENABLED, LOCAL_ADMIN_NAME } from '../env';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Get('local/config')
  localConfig() {
    return { enabled: LOCAL_ADMIN_ENABLED, name: LOCAL_ADMIN_ENABLED ? LOCAL_ADMIN_NAME : null };
  }

  @Post('local/bootstrap')
  async localBootstrap() {
    return this.authService.localBootstrap();
  }

  @Post('register')
  async register(@Body() body: { email: string; password: string; fullName?: string }) {
    return this.authService.register(body.email, body.password, body.fullName);
  }

  @Get('wechat/url')
  getWechatUrl(@Query('state') state?: string) {
    const url = this.authService.getWechatAuthUrl(state);
    return { url };
  }

  @Post('wechat/callback')
  async wechatCallback(@Body() body: { code: string }) {
    return this.authService.wechatLogin(body.code);
  }
}

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { WechatService } from './wechat.service';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly wechatService: WechatService,
  ) {}

  private hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  async login(email: string, password: string) {
    const user = await this.userService.findByEmail(email);
    if (!user || !user.passwordHash) throw new UnauthorizedException('invalid credentials');
    const hash = this.hashPassword(password);
    if (hash !== user.passwordHash) throw new UnauthorizedException('invalid credentials');
    user.lastSignInAt = new Date();
    await this.userService.save(user);
    const token = this.generateToken({ id: user.id, email: user.email });
    return { access_token: token };
  }

  async register(email: string, password: string, fullName?: string) {
    const existing = await this.userService.findByEmail(email);
    if (existing) throw new UnauthorizedException('email already registered');
    const hash = this.hashPassword(password);
    const user = await this.userService.create({ email, passwordHash: hash, fullName });
    const token = this.generateToken({ id: user.id, email: user.email });
    return { access_token: token };
  }

  generateToken(payload: { id: number; email: string }) {
    return this.jwtService.sign(payload);
  }

  getWechatAuthUrl(state?: string): string {
    return this.wechatService.getAuthUrl(state);
  }

  async wechatLogin(code: string) {
    const tokenData = await this.wechatService.exchangeCodeForToken(code);
    const userInfo = await this.wechatService.fetchUserInfo(tokenData.access_token, tokenData.openid);
    const placeholderEmail = `${tokenData.openid}@wechat.placeholder`;
    let user = await this.userService.findByEmail(placeholderEmail);
    if (!user) {
      user = await this.userService.create({
        email: placeholderEmail,
        fullName: userInfo.nickname,
        avatarUrl: userInfo.headimgurl,
        provider: 'wechat',
      });
    } else {
      user.fullName = userInfo.nickname;
      user.avatarUrl = userInfo.headimgurl;
      user.lastSignInAt = new Date();
      await this.userService.save(user);
    }
    const token = this.generateToken({ id: user.id, email: user.email });
    return { access_token: token };
  }
}

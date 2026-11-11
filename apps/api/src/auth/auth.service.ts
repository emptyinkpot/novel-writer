import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { WechatService } from './wechat.service';
import * as crypto from 'crypto';
import { LOCAL_ADMIN_EMAIL, LOCAL_ADMIN_ENABLED, LOCAL_ADMIN_NAME } from '../env';

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

  async ensureConfiguredLocalAdmin() {
    if (!LOCAL_ADMIN_ENABLED) return null;
    let user = await this.userService.findByEmail(LOCAL_ADMIN_EMAIL);
    if (user && user.provider !== 'local-admin') {
      throw new ConflictException(`本地管理员邮箱已被普通账号占用：${LOCAL_ADMIN_EMAIL}`);
    }
    if (!user) {
        user = await this.userService.create({
        email: LOCAL_ADMIN_EMAIL,
        fullName: LOCAL_ADMIN_NAME,
        provider: 'local-admin',
        userType: 'free',
        status: 'active',
      });
    } else if (user.fullName !== LOCAL_ADMIN_NAME) {
      user.fullName = LOCAL_ADMIN_NAME;
      user.status = 'active';
      await this.userService.save(user);
    }
    return user;
  }

  async localBootstrap() {
    if (!LOCAL_ADMIN_ENABLED) throw new UnauthorizedException('本地管理员登录未启用');
    const user = await this.ensureConfiguredLocalAdmin();
    if (!user) throw new UnauthorizedException('本地管理员登录未启用');
    user.lastSignInAt = new Date();
    await this.userService.save(user);
    return {
      access_token: this.generateToken({ id: user.id, email: user.email }),
      user: { id: user.id, email: user.email, name: user.fullName || LOCAL_ADMIN_NAME, provider: user.provider },
    };
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

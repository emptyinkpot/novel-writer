import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { WechatService } from './wechat.service';
import { UserModule } from '../user/user.module';
import { requiredEnv } from '../env';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: requiredEnv('JWT_SECRET'),
      signOptions: { expiresIn: '7d' },
    }),
    UserModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, WechatService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}

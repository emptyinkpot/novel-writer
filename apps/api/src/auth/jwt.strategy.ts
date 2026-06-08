import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserService } from '../user/user.service';
import { requiredEnv } from '../env';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly userService: UserService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requiredEnv('JWT_SECRET'),
    });
  }

  async validate(payload: { id: number }) {
    const user = await this.userService.findById(payload.id);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}

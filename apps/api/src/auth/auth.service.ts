import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async login(email: string, password: string) {
    return { access_token: '' };
  }

  generateToken(payload: { id: number; email: string }) {
    return this.jwtService.sign(payload);
  }
}

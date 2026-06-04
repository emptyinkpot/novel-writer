import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionEntity } from './session.entity';

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(SessionEntity)
    private readonly sessionRepo: Repository<SessionEntity>,
  ) {}

  create(userId: number, data: Partial<SessionEntity>) {
    const session = this.sessionRepo.create({ ...data, userId });
    return this.sessionRepo.save(session);
  }

  listByUser(userId: number) {
    return this.sessionRepo.find({ where: { userId }, order: { updatedAt: 'DESC' } });
  }
}

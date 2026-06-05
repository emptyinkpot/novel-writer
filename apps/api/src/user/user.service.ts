import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  findById(id: number) {
    return this.userRepo.findOneBy({ id });
  }

  findByEmail(email: string) {
    return this.userRepo.findOneBy({ email });
  }

  save(user: UserEntity) {
    return this.userRepo.save(user);
  }

  create(data: Partial<UserEntity>) {
    const user = this.userRepo.create(data);
    return this.userRepo.save(user);
  }
}

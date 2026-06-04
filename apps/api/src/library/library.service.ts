import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkEntity } from './work.entity';

@Injectable()
export class LibraryService {
  constructor(
    @InjectRepository(WorkEntity)
    private readonly workRepo: Repository<WorkEntity>,
  ) {}

  listByUser(userId: number) {
    return this.workRepo.find({ where: { userId }, order: { updatedAt: 'DESC' } });
  }

  create(userId: number, data: Partial<WorkEntity>) {
    const work = this.workRepo.create({ ...data, userId });
    return this.workRepo.save(work);
  }

  async delete(userId: number, workId: number) {
    await this.workRepo.delete({ id: workId, userId });
    return { id: workId };
  }
}

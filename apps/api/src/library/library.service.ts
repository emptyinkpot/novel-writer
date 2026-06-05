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

  list() {
    return this.workRepo.find({ order: { updatedAt: 'DESC' } });
  }

  create(data: Partial<WorkEntity>) {
    const work = this.workRepo.create(data);
    return this.workRepo.save(work);
  }

  async delete(workId: number) {
    await this.workRepo.delete({ id: workId });
    return { id: workId };
  }
}

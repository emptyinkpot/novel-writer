import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkEntity } from './work.entity';
import { UserEntity } from '../user/user.entity';
import { NotFoundException } from '@nestjs/common';

@Injectable()
export class LibraryService {
  constructor(
    @InjectRepository(WorkEntity)
    private readonly workRepo: Repository<WorkEntity>,
  ) {}

  list(userId: number) {
    return this.workRepo.find({ where: { owner: { id: userId } }, order: { updatedAt: 'DESC' } });
  }

  create(userId: number, data: Partial<WorkEntity>) {
    const work = this.workRepo.create({
      title: data.title,
      alternativeTitles: data.alternativeTitles,
      description: data.description,
      tags: data.tags,
      style: data.style,
      targetChapters: data.targetChapters,
      status: data.status,
      platform: data.platform,
      owner: { id: userId } as UserEntity,
    });
    return this.workRepo.save(work);
  }

  async delete(workId: number, userId: number) {
    const result = await this.workRepo.delete({ id: workId, owner: { id: userId } });
    if (!result.affected) throw new NotFoundException('work not found');
    return { id: workId };
  }
}

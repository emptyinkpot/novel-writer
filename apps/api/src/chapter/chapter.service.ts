import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChapterEntity } from './chapter.entity';
import { WorkEntity } from '../library/work.entity';

@Injectable()
export class ChapterService {
  constructor(
    @InjectRepository(ChapterEntity)
    private readonly repo: Repository<ChapterEntity>,
    @InjectRepository(WorkEntity)
    private readonly workRepo: Repository<WorkEntity>,
  ) {}

  private async requireOwnedWork(workId: number, userId: number) {
    const work = await this.workRepo.findOne({ where: { id: workId, owner: { id: userId } } });
    if (!work) throw new NotFoundException('work not found');
    return work;
  }

  async list(workId: number, userId: number) {
    await this.requireOwnedWork(workId, userId);
    return this.repo.find({
      where: { workId },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
  }

  async save(data: Partial<ChapterEntity> & { workId: number }, userId: number) {
    if (data.id) {
      const existing = await this.repo.findOneBy({ id: data.id });
      if (!existing) throw new NotFoundException('chapter not found');
      await this.requireOwnedWork(existing.workId, userId);
      if (data.workId !== existing.workId) throw new BadRequestException('chapter work cannot be changed');
      await this.repo.update({ id: data.id, workId: existing.workId }, {
        title: data.title,
        content: data.content,
        sortOrder: data.sortOrder,
      });
      return this.repo.findOneBy({ id: data.id, workId: existing.workId });
    }
    await this.requireOwnedWork(data.workId, userId);
    const maxOrder = await this.repo
      .createQueryBuilder('c')
      .select('MAX(c.sort_order)', 'max')
      .where('c.work_id = :workId', { workId: data.workId })
      .getRawOne();
    const entity = this.repo.create({
      ...data,
      sortOrder: data.sortOrder ?? (maxOrder?.max ?? -1) + 1,
    });
    return this.repo.save(entity);
  }

  async delete(id: number, userId: number) {
    const chapter = await this.repo.findOneBy({ id });
    if (!chapter) throw new NotFoundException('chapter not found');
    await this.requireOwnedWork(chapter.workId, userId);
    await this.repo.delete({ id, workId: chapter.workId });
    return { id };
  }
}

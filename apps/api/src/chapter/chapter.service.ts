import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChapterEntity } from './chapter.entity';

@Injectable()
export class ChapterService {
  constructor(
    @InjectRepository(ChapterEntity)
    private readonly repo: Repository<ChapterEntity>,
  ) {}

  list(workId: number) {
    return this.repo.find({
      where: { workId },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
  }

  async save(data: Partial<ChapterEntity> & { workId: number }) {
    if (data.id) {
      await this.repo.update(data.id, {
        title: data.title,
        content: data.content,
        sortOrder: data.sortOrder,
      });
      return this.repo.findOneBy({ id: data.id });
    }
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

  async delete(id: number) {
    await this.repo.delete(id);
    return { id };
  }
}

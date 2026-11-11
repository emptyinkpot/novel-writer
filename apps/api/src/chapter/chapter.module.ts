import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChapterEntity } from './chapter.entity';
import { WorkEntity } from '../library/work.entity';
import { ChapterService } from './chapter.service';
import { ChapterController } from './chapter.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ChapterEntity, WorkEntity])],
  controllers: [ChapterController],
  providers: [ChapterService],
})
export class ChapterModule {}

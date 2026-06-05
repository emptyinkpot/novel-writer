import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('nw_chapters')
export class ChapterEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'work_id' })
  workId: number;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'longtext', nullable: true })
  content: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}

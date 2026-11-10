import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { columnTypes } from '../env';

@Entity('works')
export class WorkEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 200 })
  title: string;

  @Column({ name: 'alternative_titles', type: 'text', nullable: true })
  alternativeTitles: string;

  @Column({ type: columnTypes.longText, nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  tags: string;

  @Column({ type: 'text', nullable: true })
  style: string;

  @Column({ name: 'target_chapters', type: 'int', nullable: true })
  targetChapters: number;

  @Column({ name: 'current_chapters', type: 'int', default: 0 })
  currentChapters: number;

  @Column({ length: 50, nullable: true })
  status: string;

  @Column({ length: 100, nullable: true })
  platform: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}

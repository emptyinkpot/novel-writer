import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { columnTypes } from '../env';

@Entity('nw_sessions')
export class SessionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ length: 255, nullable: true })
  title: string;

  @Column({ length: 64, default: 'gpt-4o' })
  model: string;

  @Column({ type: columnTypes.json, nullable: true })
  messages: any[];

  @Column({ name: 'work_id', type: 'int', nullable: true })
  workId: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}

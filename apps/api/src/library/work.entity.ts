import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, RelationId, Index } from 'typeorm';
import { columnTypes } from '../env';
import { UserEntity } from '../user/user.entity';

@Entity('works')
@Index('idx_works_owner_updated', ['owner', 'updatedAt'])
export class WorkEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 200 })
  title: string;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_user_id' })
  owner: UserEntity | null;

  @RelationId((work: WorkEntity) => work.owner)
  ownerUserId: number | null;

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
